/**
 * 安全与工具策略可配置（TASK-026）
 * 覆盖：
 * - security 命名空间：env 锁定 PATCH 拒绝（allowByoProvider）；BYO 走配置中心放行；
 *   createWebFetchTool 由 resolver 驱动私网放行
 * - per-tool 覆盖：bash_run timeoutMs 覆盖生效；bashTimeoutCeilingMs 全局封顶；
 *   requiresApproval 覆盖 deny-wins（low→需审批生效 / high→免审批无效）
 * - PATCH /api/tools/:name 扩展 { enabled?, timeoutMs?, requiresApproval? }
 */
import { describe, it, expect, afterEach } from "vitest";
import { Type } from "@sinclair/typebox";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { HarnessConfigRepository } from "../src/storage/repositories/harness-config.repository.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ConfigResolver } from "../src/core/config-resolver.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import { BashRunTool } from "../src/tools/system/bash-tool.js";
import { createWebFetchTool } from "../src/tools/web/web-tools.js";
import { createHarnessServer } from "../src/server.js";
import type { HarnessStreamEvent, HarnessTool } from "../src/core/types.js";

afterEach(() => {
  delete process.env.VUAGENT_ALLOW_BYO_PROVIDER;
  delete process.env.VUAGENT_ALLOW_PRIVATE_FETCH;
});

/** 低风险仿真工具（默认推导不需审批） */
const LowRiskTool: HarnessTool = {
  name: "low_risk_echo",
  description: "低风险回显工具",
  parameters: Type.Object({}),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async () => ({ ok: true }),
};

type Script = Parameters<MockDriver["setScript"]>[0];

async function makeLoop(opts?: {
  script?: Script;
  toolsNsPatch?: Record<string, unknown>;
  toolPatches?: Record<string, { enabled?: boolean; timeoutMs?: number; requiresApproval?: boolean }>;
}) {
  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const settingsRepo = new SettingsRepository(driver);
  const toolConfigRepo = new ToolConfigRepository(driver);
  const harnessConfigRepo = new HarnessConfigRepository(driver);
  const configResolver = new ConfigResolver(harnessConfigRepo);
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(BashRunTool);
  toolRegistry.register(LowRiskTool);
  const actionHub = new ActionHub();

  const ws = await workspaceRepo.create({
    name: "t",
    rootPath: "/tmp",
    permission: "read-write",
  });
  const session = await sessionRepo.create({ workspaceId: ws.id, title: "t" });
  await settingsRepo.createProfile({
    id: "m1",
    name: "M",
    provider: "openai",
    model: "mock",
    isDefault: true,
  });

  if (opts?.toolsNsPatch) await harnessConfigRepo.patchNamespace("tools", opts.toolsNsPatch);
  for (const [name, patch] of Object.entries(opts?.toolPatches ?? {})) {
    await toolConfigRepo.update(name, patch);
  }

  const mock = new MockDriver();
  mock.setScript(
    opts?.script ?? {
      steps: [
        [{ type: "tool_call", id: "c1", name: "low_risk_echo", arguments: {} }],
        [{ type: "text", text: "done" }],
      ],
    }
  );

  const loop = new AgentLoop({
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolConfigRepo,
    configResolver,
    toolRegistry,
    actionHub,
    modelDriver: mock,
  });

  async function run(
    permission: "auto" | "review" = "auto"
  ): Promise<HarnessStreamEvent[]> {
    const events: HarnessStreamEvent[] = [];
    for await (const evt of loop.runTurn({
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "t",
      permission,
    })) {
      events.push(evt);
      // HITL 挂起即批准收口，避免悬挂计时器拖住测试进程
      if (evt.type === "suspended") {
        actionHub.resolveAction(evt.actionId, { approved: true });
      }
    }
    return events;
  }
  return { run };
}

describe("per-tool timeoutMs 覆盖（bash_run）", () => {
  const SLEEP_SCRIPT: Script = {
    steps: [
      [
        {
          type: "tool_call",
          id: "c1",
          name: "bash_run",
          arguments: { command: "sleep 2", timeoutMs: 5_000 },
        },
      ],
      [{ type: "text", text: "done" }],
    ],
  };

  function bashResult(events: HarnessStreamEvent[]) {
    const r = events.find((e) => e.type === "tool_call_result") as
      | Extract<HarnessStreamEvent, { type: "tool_call_result" }>
      | undefined;
    return r?.data as { timedOut?: boolean; exitCode?: number } | undefined;
  }

  it("无覆盖：模型请求 timeoutMs=5000 生效，sleep 2 正常完成", async () => {
    const { run } = await makeLoop({ script: SLEEP_SCRIPT });
    const result = bashResult(await run());
    expect(result?.timedOut).toBeUndefined();
    expect(result?.exitCode).toBe(0);
  }, 15_000);

  it("per-tool timeoutMs=100 覆盖模型请求的 5000 → 命令超时被杀（timedOut:true）", async () => {
    const { run } = await makeLoop({
      script: SLEEP_SCRIPT,
      toolPatches: { bash_run: { timeoutMs: 100 } },
    });
    expect(bashResult(await run())?.timedOut).toBe(true);
  }, 15_000);

  it("tools.bashTimeoutCeilingMs=150 封顶：模型请求 5000 被钳到 150 → timedOut:true", async () => {
    const { run } = await makeLoop({
      script: SLEEP_SCRIPT,
      toolsNsPatch: { bashTimeoutCeilingMs: 150 },
    });
    expect(bashResult(await run())?.timedOut).toBe(true);
  }, 15_000);

  it("per-tool 覆盖同样受封顶钳制：override 5000 + ceiling 200 → timedOut:true", async () => {
    const { run } = await makeLoop({
      script: SLEEP_SCRIPT,
      toolsNsPatch: { bashTimeoutCeilingMs: 200 },
      toolPatches: { bash_run: { timeoutMs: 5_000 } },
    });
    expect(bashResult(await run())?.timedOut).toBe(true);
  }, 15_000);
});

describe("per-tool requiresApproval 覆盖（deny-wins：只能升不能降）", () => {
  it("low 风险工具 override=true → review 模式触发 HITL 挂起（提升生效）", async () => {
    const { run } = await makeLoop({
      toolPatches: { low_risk_echo: { requiresApproval: true } },
    });
    const events = await run("review");
    expect(events.some((e) => e.type === "suspended")).toBe(true);
    // 批准后正常执行收尾
    expect(events.some((e) => e.type === "tool_call_result")).toBe(true);
  });

  it("low 风险工具无覆盖 → review 模式不挂起（基线对照）", async () => {
    const { run } = await makeLoop();
    const events = await run("review");
    expect(events.some((e) => e.type === "suspended")).toBe(false);
  });

  it("bash_run(high) override=false → review 模式仍挂起（免审批无效，deny-wins）", async () => {
    const { run } = await makeLoop({
      script: {
        steps: [
          [{ type: "tool_call", id: "c1", name: "bash_run", arguments: { command: "echo ok" } }],
          [{ type: "text", text: "done" }],
        ],
      },
      toolPatches: { bash_run: { requiresApproval: false } },
    });
    const events = await run("review");
    expect(events.some((e) => e.type === "suspended")).toBe(true);
    // 批准后命令真实执行
    const result = events.find((e) => e.type === "tool_call_result") as
      | Extract<HarnessStreamEvent, { type: "tool_call_result" }>
      | undefined;
    expect((result?.data as { exitCode?: number })?.exitCode).toBe(0);
  });
});

describe("createWebFetchTool 私网放行由 resolver 驱动", () => {
  it("resolver=false 拒绝私网；resolver=true 放行（配置中心口径）", async () => {
    const deny = createWebFetchTool(() => false);
    const allow = createWebFetchTool(() => true);
    const ctx = {
      toolCallId: "t1",
      args: { url: "http://127.0.0.1:9/x" },
      workspace: {
        id: "w",
        name: "w",
        rootPath: "/tmp",
        permission: "read-write" as const,
        createdAt: 0,
        updatedAt: 0,
      },
      actionHub: new ActionHub(),
      abortSignal: new AbortController().signal,
    };
    // 拒绝在 URL 校验阶段（fetch 之前）抛出
    await expect(deny.execute(ctx)).rejects.toThrow(/SSRF/);
    // 放行后越过 SSRF 校验，进入 fetch（本地 :9 不可达 → 网络错误而非 Security Violation）
    await expect(allow.execute(ctx)).rejects.toThrow(/^(?![\s\S]*SSRF)[\s\S]*$/);
  });
});

describe("配置中心 env 锁定（security 命名空间）", () => {
  it("VUAGENT_ALLOW_BYO_PROVIDER 显式设置时 PATCH 拒绝并提示锁定", async () => {
    process.env.VUAGENT_ALLOW_BYO_PROVIDER = "1";
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/config/security", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowByoProvider: false }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("VUAGENT_ALLOW_BYO_PROVIDER");
  });
});

describe("BYO 供应商开关走配置中心（运行中生效）", () => {
  const JSON_HEADERS = { "Content-Type": "application/json" };
  const BYO_BODY = {
    prompt: "hi",
    providerConfig: { baseUrl: "http://attacker.example.com/v1", apiKey: "leak" },
  };

  function scriptedServer() {
    const mockDriver = new MockDriver();
    mockDriver.setScript({ steps: [[{ type: "text", text: "ok" }]] });
    return createHarnessServer({ dbPath: ":memory:", modelDriver: mockDriver });
  }

  it("默认拒绝（403）；PATCH 配置开启后同一请求放行；reset 后恢复拒绝", async () => {
    const { app } = scriptedServer();

    const denied = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(BYO_BODY),
    });
    expect(denied.status).toBe(403);

    const patch = await app.request("/api/config/security", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ allowByoProvider: true }),
    });
    expect(patch.status).toBe(200);

    const allowed = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(BYO_BODY),
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toContain("text/event-stream");

    const reset = await app.request("/api/config/security/reset", { method: "POST" });
    expect(reset.status).toBe(200);

    const deniedAgain = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(BYO_BODY),
    });
    expect(deniedAgain.status).toBe(403);
  });

  it("env 显式设置时锁定为 env 值（=0 锁死，配置 PATCH 被拒绝）", async () => {
    process.env.VUAGENT_ALLOW_BYO_PROVIDER = "0";
    const { app } = scriptedServer();
    const patch = await app.request("/api/config/security", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ allowByoProvider: true }),
    });
    expect(patch.status).toBe(400);
    const denied = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(BYO_BODY),
    });
    expect(denied.status).toBe(403);
  });
});

describe("PATCH /api/tools/:name 扩展（per-tool 覆盖）", () => {
  const JSON_HEADERS = { "Content-Type": "application/json" };

  it("timeoutMs/requiresApproval 落库并在 GET 反映（requiresApproval 为生效值）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });

    const res = await app.request("/api/tools/fs_read", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ timeoutMs: 5_000, requiresApproval: true }),
    });
    expect(res.status).toBe(200);
    const entity = await res.json();
    expect(entity).toMatchObject({ name: "fs_read", enabled: true, timeoutMs: 5_000, requiresApproval: true });

    const list = await (await app.request("/api/tools")).json();
    const fsRead = list.find((t: { name: string }) => t.name === "fs_read");
    expect(fsRead.timeoutMs).toBe(5_000);
    expect(fsRead.requiresApproval).toBe(true); // low 推导 false ∪ override true → 生效 true
    expect(fsRead.enabled).toBe(true);
  });

  it("requiresApproval=false 不放宽 high 推导（GET 生效值仍为 true，deny-wins）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/tools/bash_run", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ requiresApproval: false }),
    });
    expect(res.status).toBe(200);

    const list = await (await app.request("/api/tools")).json();
    const bash = list.find((t: { name: string }) => t.name === "bash_run");
    expect(bash.requiresApproval).toBe(true);
  });

  it("合并语义：后续 PATCH 只覆盖指定字段，既有覆盖保留", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    await app.request("/api/tools/bash_run", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ timeoutMs: 45_000 }),
    });
    const res = await app.request("/api/tools/bash_run", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled: false }),
    });
    const entity = await res.json();
    expect(entity).toMatchObject({ enabled: false, timeoutMs: 45_000 });
  });

  it("校验：未知字段 / timeoutMs 过小 / 类型不符 / 空 body → 400；未知工具 404", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const patch = (name: string, body: unknown) =>
      app.request(`/api/tools/${name}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });

    expect((await patch("fs_read", { bogus: 1 })).status).toBe(400);
    expect((await patch("fs_read", { timeoutMs: 500 })).status).toBe(400);
    expect((await patch("fs_read", { timeoutMs: "fast" })).status).toBe(400);
    expect((await patch("fs_read", { requiresApproval: "yes" })).status).toBe(400);
    expect((await patch("fs_read", {})).status).toBe(400);
    expect((await patch("no_such_tool", { enabled: true })).status).toBe(404);
  });

  it("enabled 单字段 PATCH 保持向后兼容（TASK-019 调用形态）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/tools/grep", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const entity = await res.json();
    expect(entity).toMatchObject({ name: "grep", enabled: false });
  });
});
