import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { HarnessConfigRepository } from "../src/storage/repositories/harness-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ConfigResolver } from "../src/core/config-resolver.js";
import type { HarnessEventSink, HarnessOpsEvent } from "../src/core/event-sink.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { IModelDriver } from "../src/adapters/model-driver.js";
import { ClassifiedModelError } from "../src/adapters/resilience.js";
import type { ModelStreamChunk } from "../src/adapters/model-driver.js";
import type { HarnessStreamEvent } from "../src/core/types.js";

/**
 * 执行核心增强回归：模型降级链（loop 级装配 + 轨迹/运维事件）
 * + 单轮 token 预算熔断（aborted reason=token_budget + 持久化徽标）。
 * 驱动构造经 driverFactory 注入缝替身，不触网。
 */

function memorySink(): HarnessEventSink & { events: HarnessOpsEvent[] } {
  const events: HarnessOpsEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

async function setup(opts: {
  executionOverrides?: Record<string, unknown>;
  profiles: Array<{ id: string; name: string; model?: string }>;
  driverFactory: (profileId: string) => IModelDriver;
}) {
  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const settingsRepo = new SettingsRepository(driver);
  const harnessConfigRepo = new HarnessConfigRepository(driver);
  const sink = memorySink();

  if (opts.executionOverrides) {
    await harnessConfigRepo.patchNamespace("execution", opts.executionOverrides);
  }

  const ws = await workspaceRepo.create({
    name: "WS",
    rootPath: "/tmp",
    permission: "read-write",
  });
  const session = await sessionRepo.create({ workspaceId: ws.id, title: "S" });

  for (const p of opts.profiles) {
    await settingsRepo.createProfile({
      id: p.id,
      name: p.name,
      provider: "openai",
      model: p.model ?? `${p.id}-model`,
      isDefault: p.id === opts.profiles[0].id,
    });
  }

  const loop = new AgentLoop({
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolConfigRepo: new ToolConfigRepository(driver),
    toolRegistry: new ToolRegistry(),
    actionHub: new ActionHub(),
    configResolver: new ConfigResolver(harnessConfigRepo),
    driverFactory: (profile) => opts.driverFactory(profile.id),
    eventSink: sink,
  });

  return { ws, session, loop, sessionRepo, sink };
}

async function drain(loop: AgentLoop, ws: string, session: string): Promise<HarnessStreamEvent[]> {
  const events: HarnessStreamEvent[] = [];
  for await (const ev of loop.runTurn({ sessionId: session, workspaceId: ws, prompt: "hi" })) {
    events.push(ev);
  }
  return events;
}

describe("模型降级链（loop 级装配）", () => {
  it("主档案流开始前限流失败 → 自动切换备用档案完成轮次，轨迹与运维事件齐全", async () => {
    const failing: IModelDriver = {
      async *generateStream(): AsyncIterable<ModelStreamChunk> {
        throw new ClassifiedModelError("rate limited (429)", "rate_limit", 429);
      },
    };
    const backup = new MockDriver({ steps: [[{ type: "text", text: "备用档案回复" }]] });

    const { ws, session, loop, sink } = await setup({
      executionOverrides: { modelFallbackIds: "p-backup" },
      profiles: [
        { id: "p-main", name: "Main" },
        { id: "p-backup", name: "Backup" },
      ],
      driverFactory: (id) => (id === "p-main" ? failing : backup),
    });

    const events = await drain(loop, ws.id, session.id);
    const types = events.map((e) => e.type);
    expect(types).toContain("text_delta");
    expect(types[types.length - 1]).toBe("turn_end");

    // 轨迹可见降级切换
    const traj = events.find(
      (e) => e.type === "traj" && (e.event as { title?: string }).title?.includes("模型降级")
    ) as { event: { title: string; detail: string } } | undefined;
    expect(traj).toBeDefined();
    expect(traj!.event.title).toContain("Main");
    expect(traj!.event.title).toContain("Backup");

    // 运维事件 model_fallback
    const opFallback = sink.events.find((e) => e.type === "model_fallback") as
      | Extract<HarnessOpsEvent, { type: "model_fallback" }>
      | undefined;
    expect(opFallback).toBeDefined();
    expect(opFallback!.from).toBe("Main");
    expect(opFallback!.to).toBe("Backup");
    expect(opFallback!.errorClass).toBe("rate_limit");
  });

  it("配置中不存在的档案 id / 主档案自身 id 被安全跳过", async () => {
    const primary = new MockDriver({ steps: [[{ type: "text", text: "ok" }]] });
    const { ws, session, loop } = await setup({
      executionOverrides: { modelFallbackIds: "p-main, ghost-profile" },
      profiles: [{ id: "p-main", name: "Main" }],
      driverFactory: () => primary,
    });
    const events = await drain(loop, ws.id, session.id);
    expect(events[events.length - 1].type).toBe("turn_end");
  });

  it("备用档案链只在多档案时装配（单档案直连，无降级事件）", async () => {
    const primary = new MockDriver({ steps: [[{ type: "text", text: "solo" }]] });
    const { ws, session, loop, sink } = await setup({
      profiles: [{ id: "p-main", name: "Main" }],
      driverFactory: () => primary,
    });
    await drain(loop, ws.id, session.id);
    expect(sink.events.find((e) => e.type === "model_fallback")).toBeUndefined();
  });
});

describe("单轮 token 预算熔断（maxRunTokens）", () => {
  it("超限触发中止：aborted reason=token_budget + ops 码 + 落库徽标", async () => {
    // 独立装配（需要注册探针工具后再跑）
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const harnessConfigRepo = new HarnessConfigRepository(driver);
    const sink = memorySink();
    await harnessConfigRepo.patchNamespace("execution", { maxRunTokens: 5 });

    const ws = await workspaceRepo.create({ name: "WS", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "S" });
    await settingsRepo.createProfile({ id: "p-main", name: "Main", provider: "openai", model: "m", isDefault: true });

    const registry = new ToolRegistry();
    registry.register({
      name: "probe",
      description: "探针",
      parameters: Type.Object({}),
      execute: async () => ({ ok: true }),
    });

    const mock = new MockDriver({
      steps: [
        [{ type: "tool_call", id: "c1", name: "probe", arguments: {} }],
        [{ type: "text", text: "第二步（不应到达）" }],
      ],
    });

    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: registry,
      actionHub: new ActionHub(),
      configResolver: new ConfigResolver(harnessConfigRepo),
      driverFactory: () => mock,
      eventSink: sink,
    });

    const events = await drain(loop, ws.id, session.id);
    const types = events.map((e) => e.type);
    expect(types).toContain("aborted");
    const aborted = events.find((e) => e.type === "aborted") as { reason: string };
    expect(aborted.reason).toBe("token_budget");
    const errEvent = events.find((e) => e.type === "error") as { code?: string; message: string };
    expect(errEvent.code).toBe("RUN_TOKEN_BUDGET_EXCEEDED");
    expect(errEvent.message).toContain("预算上限");

    // 落库徽标：R8 口径——loop-top 优雅中止以 done 落库，abortedReason 标记成因
    const stored = await sessionRepo.get(session.id);
    const turn = stored!.turns.at(-1)!;
    expect(turn.abortedReason).toBe("token_budget");
    expect(turn.status).toBe("done");

    // ops turn_finish 携带预算熔断分类码
    const opFinish = sink.events.find((e) => e.type === "turn_finish") as
      | Extract<HarnessOpsEvent, { type: "turn_finish" }>
      | undefined;
    expect(opFinish!.code).toBe("RUN_TOKEN_BUDGET_EXCEEDED");

    // ops abort 事件带 RUN_TOKEN_BUDGET_EXCEEDED
    const opAbort = sink.events.find(
      (e) => e.type === "abort" && (e as { reason: string }).reason === "token_budget"
    ) as Extract<HarnessOpsEvent, { type: "abort" }> | undefined;
    expect(opAbort).toBeDefined();
    expect(opAbort!.code).toBe("RUN_TOKEN_BUDGET_EXCEEDED");
  });

  it("预算不限（0）时不熔断", async () => {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);

    const ws = await workspaceRepo.create({ name: "WS", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "S" });
    await settingsRepo.createProfile({ id: "p-main", name: "Main", provider: "openai", model: "m", isDefault: true });

    const mock = new MockDriver({ steps: [[{ type: "text", text: "正常完成" }]] });
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      driverFactory: () => mock,
    });

    const events = await drain(loop, ws.id, session.id);
    expect(events[events.length - 1].type).toBe("turn_end");
    expect(events.find((e) => e.type === "aborted")).toBeUndefined();
  });
});
