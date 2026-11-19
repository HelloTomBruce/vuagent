/**
 * 配置中心基座单测（TASK-024）
 * 覆盖：HarnessConfigRepository merge/reset 语义、resolveNamespaceValues 读路径容错
 * （回落/钳制/截断/未知 key 忽略/envLock 覆盖）、validateNamespacePatch 写路径严格校验、
 * HTTP GET/PATCH/reset 路由与「PATCH 后立刻读到新值」的无缓存口径
 */
import { describe, it, expect, afterEach } from "vitest";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { HarnessConfigRepository } from "../src/storage/repositories/harness-config.repository.js";
import {
  CONFIG_SCHEMA,
  defaultNamespaceValues,
  getNamespaceSchema,
} from "../src/core/config-schema.js";
import {
  ConfigResolver,
  resolveNamespaceValues,
  validateNamespacePatch,
} from "../src/core/config-resolver.js";
import { createHarnessServer } from "../src/server.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ActionHub } from "../src/core/action-hub.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import { FsReadTool } from "../src/tools/system/fs-tools.js";
import { BashRunTool } from "../src/tools/system/bash-tool.js";
import { ContextCompactor, type ChatMessage } from "../src/core/context-compactor.js";
import type { HarnessStreamEvent } from "../src/core/types.js";

const execution = getNamespaceSchema("execution")!;
const security = getNamespaceSchema("security")!;

afterEach(() => {
  delete process.env.VUAGENT_ALLOW_PRIVATE_FETCH;
});

describe("CONFIG_SCHEMA 描述表", () => {
  it("包含 execution/security/tools/prompt/finops 五个命名空间，字段 key 在命名空间内唯一", () => {
    expect(CONFIG_SCHEMA.map((ns) => ns.id)).toEqual([
      "execution",
      "security",
      "tools",
      "prompt",
      "finops",
    ]);
    for (const ns of CONFIG_SCHEMA) {
      const keys = ns.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(ns.title.trim()).not.toBe("");
      for (const f of ns.fields) {
        expect(f.title.trim()).not.toBe("");
        expect(f.description.trim()).not.toBe("");
      }
    }
  });

  it("默认值与现行硬编码行为等价（执行层既有旋钮）", () => {
    const d = defaultNamespaceValues(execution);
    expect(d).toMatchObject({
      maxSteps: 15,
      approvalTimeoutMs: 180_000,
      contextBudgetRatio: 0.85,
      preserveRecentTurns: 4,
      maxToolResultChars: 2_000,
    });
  });
});

describe("HarnessConfigRepository（merge/reset，缺记录=全默认）", () => {
  it("全新仓库 → getNamespace 返回 null；patch 后可读回", async () => {
    const repo = new HarnessConfigRepository(new MemoryStorageDriver());
    expect(await repo.getNamespace("execution")).toBeNull();

    const saved = await repo.patchNamespace("execution", { maxSteps: 2 });
    expect(saved.scope).toBe("global");
    expect(saved.values.maxSteps).toBe(2);
    expect(saved.updatedAt).toBeGreaterThan(0);
  });

  it("patch 为 merge 语义：二次 patch 只覆盖指定 key，既有项保留", async () => {
    const repo = new HarnessConfigRepository(new MemoryStorageDriver());
    await repo.patchNamespace("execution", { maxSteps: 2 });
    const after = await repo.patchNamespace("execution", { approvalTimeoutMs: 60_000 });

    expect(after.values).toEqual({ maxSteps: 2, approvalTimeoutMs: 60_000 });
  });

  it("reset 删除记录恢复默认；同一 driver 跨实例可见（持久化往返）", async () => {
    const driver = new MemoryStorageDriver();
    const repo = new HarnessConfigRepository(driver);
    await repo.patchNamespace("prompt", { includeEnvironmentBlock: false });

    // 同一 driver 新实例读回（等价于重启后读取）
    const repo2 = new HarnessConfigRepository(driver);
    expect((await repo2.getNamespace("prompt"))?.values.includeEnvironmentBlock).toBe(false);

    expect(await repo2.resetNamespace("prompt")).toBe(true);
    expect(await repo2.getNamespace("prompt")).toBeNull();
    // 再 reset 无记录 → false（幂等语义明确）
    expect(await repo2.resetNamespace("prompt")).toBe(false);
  });
});

describe("resolveNamespaceValues（读路径容错，永不抛异常）", () => {
  it("无存储 → 全默认；存储覆盖 → 覆盖生效；未知 key 忽略", () => {
    expect(resolveNamespaceValues(execution, null).maxSteps).toBe(15);
    expect(resolveNamespaceValues(execution, { maxSteps: 3 }).maxSteps).toBe(3);
    const out = resolveNamespaceValues(execution, { legacyKey: "x", maxSteps: 7 });
    expect(out.maxSteps).toBe(7);
    expect("legacyKey" in out).toBe(false);
  });

  it("类型不符回落默认；number 越界钳制；select 非法回落；text 超长截断", () => {
    expect(resolveNamespaceValues(execution, { maxSteps: "many" }).maxSteps).toBe(15);
    expect(resolveNamespaceValues(execution, { maxSteps: 999 }).maxSteps).toBe(100);
    expect(resolveNamespaceValues(execution, { maxSteps: 0 }).maxSteps).toBe(1);
    expect(resolveNamespaceValues(security, { defaultPermissionMode: "yolo" }).defaultPermissionMode).toBe("review");

    const prompt = getNamespaceSchema("prompt")!;
    const longText = resolveNamespaceValues(prompt, { customInstructions: "x".repeat(5000) });
    expect((longText.customInstructions as string).length).toBe(4000);
  });

  it("envLock：env 显式设置时优先生效；不可解析回落默认；env 清除后回落存储值", () => {
    // env 未设置：读存储值
    expect(resolveNamespaceValues(security, { allowPrivateFetch: true }).allowPrivateFetch).toBe(true);

    process.env.VUAGENT_ALLOW_PRIVATE_FETCH = "1";
    // env 覆盖存储（部署级强制锁）
    expect(resolveNamespaceValues(security, { allowPrivateFetch: false }).allowPrivateFetch).toBe(true);

    // 不可解析的 env 值回落默认（false）
    process.env.VUAGENT_ALLOW_PRIVATE_FETCH = "yes";
    expect(resolveNamespaceValues(security, { allowPrivateFetch: true }).allowPrivateFetch).toBe(false);

    delete process.env.VUAGENT_ALLOW_PRIVATE_FETCH;
    expect(resolveNamespaceValues(security, { allowPrivateFetch: true }).allowPrivateFetch).toBe(true);
  });
});

describe("validateNamespacePatch（写路径严格校验）", () => {
  it("合法 patch 通过；number 越界钳制后作为待落库值", () => {
    const ok = validateNamespacePatch(execution, { maxSteps: 500 });
    expect(ok).toEqual({ ok: true, values: { maxSteps: 100 } });
  });

  it("未知 key / 类型不符 / select 非法 / 非对象 body 一律拒绝", () => {
    expect(validateNamespacePatch(execution, { nope: 1 }).ok).toBe(false);
    expect(validateNamespacePatch(execution, { maxSteps: "2" }).ok).toBe(false);
    expect(validateNamespacePatch(security, { defaultPermissionMode: "yolo" }).ok).toBe(false);
    expect(validateNamespacePatch(execution, [1, 2]).ok).toBe(false);
    expect(validateNamespacePatch(execution, null).ok).toBe(false);
  });

  it("env 锁定项 PATCH 拒绝；env 清除后放行", () => {
    process.env.VUAGENT_ALLOW_PRIVATE_FETCH = "1";
    const locked = validateNamespacePatch(security, { allowPrivateFetch: true });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toContain("VUAGENT_ALLOW_PRIVATE_FETCH");

    delete process.env.VUAGENT_ALLOW_PRIVATE_FETCH;
    expect(validateNamespacePatch(security, { allowPrivateFetch: true }).ok).toBe(true);
  });
});

describe("ConfigResolver（无缓存门面）", () => {
  it("resolve 逐次读库：patch 后立刻读到新值；未知命名空间返回 null", async () => {
    const repo = new HarnessConfigRepository(new MemoryStorageDriver());
    const resolver = new ConfigResolver(repo);

    expect((await resolver.resolve("execution"))?.maxSteps).toBe(15);
    expect(await resolver.isDefault("execution")).toBe(true);

    await repo.patchNamespace("execution", { maxSteps: 2 });
    // 不经任何缓存，立即生效
    expect((await resolver.resolve("execution"))?.maxSteps).toBe(2);
    expect(await resolver.isDefault("execution")).toBe(false);

    expect(await resolver.resolve("nope")).toBeNull();
  });
});

describe("配置中心 HTTP 路由", () => {
  it("GET /api/config 返回 schema + 生效值 + isDefault 标记", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      namespaces: Array<{
        id: string;
        fields: Array<{ key: string; default: unknown }>;
        values: Record<string, unknown>;
        isDefault: boolean;
      }>;
    };
    expect(body.namespaces.map((ns) => ns.id)).toEqual([
      "execution",
      "security",
      "tools",
      "prompt",
      "finops",
    ]);

    const exec = body.namespaces.find((ns) => ns.id === "execution")!;
    expect(exec.values.maxSteps).toBe(15);
    expect(exec.isDefault).toBe(true);
    // schema 下发给前端做表驱动渲染
    expect(exec.fields.find((f) => f.key === "maxSteps")?.default).toBe(15);

    // envLock 元数据随 schema 下发（供 UI 展示锁标记）
    const sec = body.namespaces.find((ns) => ns.id === "security")!;
    const fetchField = sec.fields.find((f) => f.key === "allowPrivateFetch") as
      | { envLock?: string }
      | undefined;
    expect(fetchField?.envLock).toBe("VUAGENT_ALLOW_PRIVATE_FETCH");
  });

  it("PATCH → GET 立即反映（无缓存脏读）；reset 恢复默认", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });

    const patched = await app.request("/api/config/execution", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxSteps: 2 }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).values.maxSteps).toBe(2);

    const after = await app.request("/api/config");
    const execNs = ((await after.json()) as any).namespaces.find((ns: any) => ns.id === "execution");
    expect(execNs.values.maxSteps).toBe(2);
    expect(execNs.isDefault).toBe(false);

    const reset = await app.request("/api/config/execution/reset", { method: "POST" });
    expect(reset.status).toBe(200);
    expect((await reset.json()).values.maxSteps).toBe(15);
  });

  it("PATCH 错误分支：未知命名空间 404；未知 key / 类型不符 400；越界钳制", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const patch = (ns: string, body: unknown) =>
      app.request(`/api/config/${ns}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await patch("nope", { maxSteps: 2 })).status).toBe(404);
    expect((await patch("execution", { nope: 1 })).status).toBe(400);
    expect((await patch("execution", { maxSteps: "many" })).status).toBe(400);

    const clamped = await patch("execution", { maxSteps: 500 });
    expect(clamped.status).toBe(200);
    expect((await clamped.json()).values.maxSteps).toBe(100);

    expect((await app.request("/api/config/nope/reset", { method: "POST" })).status).toBe(404);
  });

  it("env 锁定项：PATCH 400；GET 生效值为 env 覆盖结果", async () => {
    process.env.VUAGENT_ALLOW_PRIVATE_FETCH = "1";
    try {
      const { app } = createHarnessServer({ dbPath: ":memory:" });

      const locked = await app.request("/api/config/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowPrivateFetch: false }),
      });
      expect(locked.status).toBe(400);
      expect((await locked.json()).error).toContain("锁定");

      const res = await app.request("/api/config");
      const sec = ((await res.json()) as any).namespaces.find((ns: any) => ns.id === "security");
      // 存储层无记录，但 env 强制生效
      expect(sec.values.allowPrivateFetch).toBe(true);
      // locked 标记随字段下发（UI 只读判定，TASK-028）
      expect(sec.fields.find((f: any) => f.key === "allowPrivateFetch").locked).toBe(true);
      expect(sec.fields.find((f: any) => f.key === "defaultPermissionMode").locked).toBe(false);
    } finally {
      delete process.env.VUAGENT_ALLOW_PRIVATE_FETCH;
    }
  });
});

/* ==========================================================================
   执行层配置接线（TASK-025）：agent-loop / compactor 消费 execution 命名空间
   ========================================================================== */

describe("ContextCompactor.configure（运行时更新，无需重建实例）", () => {
  function buildMessages(): ChatMessage[] {
    return [
      { role: "system", content: "s" },
      { role: "user", content: "u1" },
      {
        role: "assistant",
        tool_calls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "c1", name: "x", content: "y".repeat(1500) },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ];
  }

  it("默认保留 4 轮（8 条全算最近）不截断；configure 后早期超长工具结果被截断", () => {
    const compactor = new ContextCompactor();
    const untouched = compactor.compact(buildMessages(), { maxTokens: 100_000 });
    expect(untouched.find((m) => m.role === "tool")?.content).toBe("y".repeat(1500));

    compactor.configure({ preserveRecentTurns: 1, maxToolResultChars: 100 });
    const trimmed = compactor.compact(buildMessages(), { maxTokens: 100_000 });
    expect(trimmed.find((m) => m.role === "tool")?.content).toContain("自动截断超长历史输出");
  });
});

describe("AgentLoop 执行层配置接线（TASK-025）", () => {
  type Script = Parameters<MockDriver["setScript"]>[0];

  const FS_SCRIPT: Script = {
    steps: [
      [{ type: "tool_call", id: "c1", name: "fs_read", arguments: { filePath: "a.txt" } }],
      [{ type: "tool_call", id: "c2", name: "fs_read", arguments: { filePath: "b.txt" } }],
      [{ type: "text", text: "done" }],
    ],
  };

  async function makeLoop(patch?: Record<string, unknown>, script: Script = FS_SCRIPT) {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const toolConfigRepo = new ToolConfigRepository(driver);
    const harnessConfigRepo = new HarnessConfigRepository(driver);
    const configResolver = new ConfigResolver(harnessConfigRepo);
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(FsReadTool);
    toolRegistry.register(BashRunTool);
    const actionHub = new ActionHub();

    const ws = await workspaceRepo.create({
      name: "t",
      rootPath: "/tmp/vuagent-execcfg",
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

    if (patch) await harnessConfigRepo.patchNamespace("execution", patch);

    const mock = new MockDriver();
    mock.setScript(script);

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
      permission: "auto" | "review" = "auto",
      maxSteps?: number
    ): Promise<HarnessStreamEvent[]> {
      const events: HarnessStreamEvent[] = [];
      for await (const evt of loop.runTurn({
        workspaceId: ws.id,
        sessionId: session.id,
        prompt: "t",
        permission,
        ...(maxSteps !== undefined ? { maxSteps } : {}),
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

  function stepCountOf(events: HarnessStreamEvent[]): number | undefined {
    const end = events.find((e) => e.type === "turn_end") as
      | Extract<HarnessStreamEvent, { type: "turn_end" }>
      | undefined;
    return end?.stepCount;
  }

  it("resolver 在场但无配置记录 → 默认值等价（3 步脚本完整跑完）", async () => {
    const { run } = await makeLoop();
    expect(stepCountOf(await run())).toBe(3);
  });

  it("配置 maxSteps=1 → 单步即收尾；req.maxSteps 请求级覆盖优先于配置", async () => {
    const limited = await makeLoop({ maxSteps: 1 });
    expect(stepCountOf(await limited.run())).toBe(1);
    // 同一配置下，请求级 maxSteps=2 优先（解析链：请求 > 全局配置 > 默认）
    expect(stepCountOf(await limited.run("auto", 2))).toBe(2);
  });

  it("approvalTimeoutMs 配置接入 HITL 挂起（suspended 事件与等待计时同源）", async () => {
    const { run } = await makeLoop(
      { approvalTimeoutMs: 99_000 },
      {
        steps: [
          [{ type: "tool_call", id: "c1", name: "bash_run", arguments: { command: "echo ok" } }],
          [{ type: "text", text: "done" }],
        ],
      }
    );
    const events = await run("review");

    const suspended = events.find((e) => e.type === "suspended") as
      | Extract<HarnessStreamEvent, { type: "suspended" }>
      | undefined;
    expect(suspended?.timeoutMs).toBe(99_000);
    // 批准（已在 run 内收口）后工具执行、轮次正常结束
    expect(events.some((e) => e.type === "tool_call_result")).toBe(true);
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });
});
