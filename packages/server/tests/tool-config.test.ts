/**
 * 工具启停配置单测（TASK-019）
 * 覆盖：ToolConfigRepository 默认语义/启停往返、ToolRegistry definitions 过滤、
 * AgentLoop 端到端（禁用后模型不可见 + 调用被结构化拒绝）、HTTP GET/PATCH 路由
 */
import { describe, it, expect } from "vitest";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import type { ModelDriverRequest } from "../src/adapters/model-driver.js";
import { FsReadTool, FsWriteTool } from "../src/tools/system/fs-tools.js";
import { createHarnessServer } from "../src/server.js";
import type { ModelStreamChunk } from "../src/adapters/model-driver.js";
import type { HarnessStreamEvent } from "../src/core/types.js";

describe("ToolConfigRepository（全局启用配置，缺记录=启用）", () => {
  it("全新仓库 → 无禁用工具（默认全启）", async () => {
    const repo = new ToolConfigRepository(new MemoryStorageDriver());
    expect((await repo.disabledNames()).size).toBe(0);
    expect(await repo.get("bash_run")).toBeNull();
  });

  it("setEnabled(false) → 进入禁用集；setEnabled(true) → 恢复启用", async () => {
    const driver = new MemoryStorageDriver();
    const repo = new ToolConfigRepository(driver);

    await repo.setEnabled("bash_run", false);
    expect((await repo.disabledNames()).has("bash_run")).toBe(true);
    expect((await repo.get("bash_run"))?.enabled).toBe(false);

    await repo.setEnabled("bash_run", true);
    expect((await repo.disabledNames()).has("bash_run")).toBe(false);
    expect((await repo.get("bash_run"))?.enabled).toBe(true);

    // 同一 driver 实例持久化往返
    const repo2 = new ToolConfigRepository(driver);
    await repo2.setEnabled("web_fetch", false);
    expect((await new ToolConfigRepository(driver).disabledNames()).has("web_fetch")).toBe(true);
  });
});

describe("ToolRegistry definitions 过滤", () => {
  it("disabledNames 中的工具不进入模型可见定义", () => {
    const registry = new ToolRegistry();
    registry.register(FsReadTool).register(FsWriteTool);

    expect(registry.toModelToolDefinitions()).toHaveLength(2);
    const filtered = registry.toModelToolDefinitions({
      disabledNames: new Set(["fs_write"]),
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].function.name).toBe("fs_read");
  });
});

/**
 * 录制型仿真驱动：继承 MockDriver（agent-loop 以 instanceof 判定 mock 形态，
 * 组合包装会被判定为真驱动而走 OpenAICompatible 分支），额外捕获模型请求。
 */
class RecordingMockDriver extends MockDriver {
  lastRequest?: ModelDriverRequest;
  override async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    this.lastRequest = req;
    yield* super.generateStream(req);
  }
}

describe("AgentLoop 端到端：禁用工具的可见性与调用兜底", () => {
  async function makeLoop(disableFsRead: boolean) {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const toolConfigRepo = new ToolConfigRepository(driver);
    const toolRegistry = new ToolRegistry();
    toolRegistry.register(FsReadTool);

    const ws = await workspaceRepo.create({ name: "t", rootPath: "/tmp/vuagent-toolcfg", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "t" });
    await settingsRepo.createProfile({ id: "m1", name: "M", provider: "openai", model: "mock", isDefault: true });

    if (disableFsRead) await toolConfigRepo.setEnabled("fs_read", false);

    const mock = new RecordingMockDriver();
    mock.setScript({
      steps: [
        [{ type: "tool_call", id: "c1", name: "fs_read", arguments: { filePath: "a.txt" } }],
        [{ type: "text", text: "done" }],
      ],
    });
    const recording = mock;

    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo,
      toolRegistry,
      actionHub: new ActionHub(),
      modelDriver: recording,
    });

    async function run(): Promise<{ events: HarnessStreamEvent[] }> {
      const events: HarnessStreamEvent[] = [];
      for await (const evt of loop.runTurn({ workspaceId: ws.id, sessionId: session.id, prompt: "读文件", permission: "auto" })) {
        events.push(evt);
      }
      return { events };
    }
    return { run, recording, toolConfigRepo };
  }

  it("禁用 fs_read → 模型定义不含该工具，强行调用得到结构化禁用错误", async () => {
    const { run, recording } = await makeLoop(true);
    const { events } = await run();

    // definitions 已下发前模型拿到的 tools 不含 fs_read
    const toolNames = (recording.lastRequest?.tools ?? []).map((t) => t.function.name);
    expect(toolNames).not.toContain("fs_read");

    // 上下文残留旧定义时的调用兜底：结构化禁用错误
    const result = events.find((e) => e.type === "tool_call_result") as
      | Extract<HarnessStreamEvent, { type: "tool_call_result" }>
      | undefined;
    expect(result?.status).toBe("error");
    expect(result?.error).toContain("已被禁用");
    expect(result?.error).toContain("fs_read");
  });

  it("未禁用 → 定义可见、调用正常执行", async () => {
    const { run, recording } = await makeLoop(false);
    const { events } = await run();

    const toolNames = (recording.lastRequest?.tools ?? []).map((t) => t.function.name);
    expect(toolNames).toContain("fs_read");

    const result = events.find((e) => e.type === "tool_call_result") as
      | Extract<HarnessStreamEvent, { type: "tool_call_result" }>
      | undefined;
    // 文件不存在也是 registry 正常执行通道（非禁用错误）
    expect(result?.error ?? "").not.toContain("已被禁用");
  });
});

describe("工具配置 HTTP 路由", () => {
  it("GET /api/tools 返回全部内置工具与默认启用状态", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/tools");
    expect(res.status).toBe(200);
    const tools = (await res.json()) as Array<{ name: string; enabled: boolean; source: string }>;
    const names = tools.map((t) => t.name);
    expect(names).toContain("bash_run");
    expect(names).toContain("fs_edit");
    expect(names).toContain("web_fetch");
    for (const t of tools) {
      expect(t.enabled).toBe(true);
      expect(t.source).toBe("builtin");
    }
  });

  it("PATCH 启停往返：禁用后 GET 反映状态，未知工具 404，非法 body 400", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });

    const disable = await app.request("/api/tools/bash_run", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);
    expect((await disable.json()).enabled).toBe(false);

    const list = await app.request("/api/tools");
    const tools = (await list.json()) as Array<{ name: string; enabled: boolean }>;
    expect(tools.find((t) => t.name === "bash_run")?.enabled).toBe(false);

    const reEnable = await app.request("/api/tools/bash_run", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect((await reEnable.json()).enabled).toBe(true);

    const unknown = await app.request("/api/tools/nope", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(unknown.status).toBe(404);

    const badBody = await app.request("/api/tools/bash_run", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    });
    expect(badBody.status).toBe(400);
  });
});
