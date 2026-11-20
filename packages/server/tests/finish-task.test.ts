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
import { MockDriver } from "./helpers/mock-driver.js";
import { FinishTaskTool } from "../src/tools/system/finish-task-tool.js";
import type { HarnessStreamEvent } from "../src/core/types.js";
import type { IModelDriver, ModelDriverRequest } from "../src/adapters/model-driver.js";
import type { DeliverableAssertion } from "../src/core/finish-task.js";

/**
 * 显式终态协议（finish_task + 交付断言）loop 级回归：
 * - 可见性：off 模式 finish_task 对模型不可见 / enforced 模式可见（hideTools 过滤）；
 * - enforced：finish_task 显式宣告（驳回→继续→通过）、自然停机空跑拦截；
 * - 可插拔交付断言注入生效。
 */

/** 包装驱动：捕获每次模型请求（可见性断言用），透传给内层驱动 */
function captureDriver(inner: IModelDriver) {
  const captured: ModelDriverRequest[] = [];
  const wrapper: IModelDriver = {
    async *generateStream(req: ModelDriverRequest) {
      captured.push(req);
      yield* inner.generateStream(req);
    },
  };
  return { captured, wrapper };
}

async function setup(opts: {
  finishTaskMode: "off" | "enforced";
  driver: IModelDriver;
  deliverableAssertion?: DeliverableAssertion;
  overrides?: Record<string, unknown>;
}) {
  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const settingsRepo = new SettingsRepository(driver);
  const harnessConfigRepo = new HarnessConfigRepository(driver);
  await harnessConfigRepo.patchNamespace(
    "execution",
    { finishTaskMode: opts.finishTaskMode, ...(opts.overrides ?? {}) }
  );

  const ws = await workspaceRepo.create({ name: "WS", rootPath: "/tmp", permission: "read-write" });
  const session = await sessionRepo.create({ workspaceId: ws.id, title: "S" });
  await settingsRepo.createProfile({ id: "p", name: "P", provider: "openai", model: "m", isDefault: true });

  const registry = new ToolRegistry();
  registry.register({
    name: "probe",
    description: "探针",
    parameters: Type.Object({}),
    execute: async () => ({ ok: true }),
  });
  // 生产由 server.ts 注册；测试同构（可见性与拦截均依赖 registry 含 finish_task）
  registry.register(FinishTaskTool);

  const { captured, wrapper } = captureDriver(opts.driver);

  const loop = new AgentLoop({
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolConfigRepo: new ToolConfigRepository(driver),
    toolRegistry: registry,
    actionHub: new ActionHub(),
    configResolver: new ConfigResolver(harnessConfigRepo),
    deliverableAssertion: opts.deliverableAssertion,
    driverFactory: () => wrapper,
  });

  return { ws, session, loop, sessionRepo, captured };
}

async function drain(loop: AgentLoop, ws: string, session: string): Promise<HarnessStreamEvent[]> {
  const events: HarnessStreamEvent[] = [];
  for await (const ev of loop.runTurn({ sessionId: session, workspaceId: ws, prompt: "hi" })) {
    events.push(ev);
  }
  return events;
}

function toolCallStep(id: string, args: Record<string, unknown>) {
  return [{ type: "tool_call" as const, id, name: "finish_task", arguments: args }];
}

describe("finish_task 模型可见性（hideTools）", () => {
  it("off 模式：finish_task 不进入模型可见 definitions", async () => {
    const { ws, session, loop, captured } = await setup({
      finishTaskMode: "off",
      driver: new MockDriver({ steps: [[{ type: "text", text: "ok" }]] }),
    });
    await drain(loop, ws.id, session.id);
    expect(captured.length).toBeGreaterThan(0);
    const names = captured[0].tools?.map((t) => t.function.name) ?? [];
    expect(names).not.toContain("finish_task");
    expect(names).toContain("probe");
  });

  it("enforced 模式：finish_task 进入模型可见 definitions", async () => {
    const { ws, session, loop, captured } = await setup({
      finishTaskMode: "enforced",
      driver: new MockDriver({ steps: [[{ type: "text", text: "ok" }]] }),
    });
    await drain(loop, ws.id, session.id);
    const names = captured[0].tools?.map((t) => t.function.name) ?? [];
    expect(names).toContain("finish_task");
  });
});

describe("显式终态协议（enforced）执行语义", () => {
  it("空产出宣告被驳回 → 模型继续产出 → 再次宣告通过：显式完成落库 finishReason=explicit", async () => {
    const script = {
      steps: [
        toolCallStep("f1", { summary: "我完成了" }), // 步 1：无任何实质产出 → 断言驳回
        [
          // 步 2：正文产出 + 再次宣告（同步混排）→ 断言通过 → 显式完成
          { type: "text" as const, text: "这是实质产出内容" },
          { type: "tool_call" as const, id: "f2", name: "finish_task", arguments: { summary: "真正完成", deliverables: [{ kind: "text" }] } },
        ],
      ],
    };
    const { ws, session, loop, sessionRepo } = await setup({
      finishTaskMode: "enforced",
      driver: new MockDriver(script),
    });

    const events = await drain(loop, ws.id, session.id);
    const trajTitles = events
      .filter((e) => e.type === "traj")
      .map((e) => (e.event as { title: string }).title);

    expect(trajTitles).toContain("交付断言未通过（finish_task 驳回）");
    expect(trajTitles).toContain("任务显式完成（finish_task）");
    expect(events[events.length - 1].type).toBe("turn_end");

    const turn = (await sessionRepo.get(session.id))!.turns.at(-1)!;
    expect(turn.finishReason).toBe("explicit");
    expect(turn.status).toBe("done");
  });

  it("自然停机空跑被拦截（纠偏指令注入后产出，自然完成 finishReason=natural）", async () => {
    const script = {
      steps: [
        [], // 步 1：零输出零工具 → 空跑，自然停机被断言拦截
        [{ type: "text" as const, text: "补上的实质产出" }], // 步 2：产出 → 自然停机放行
      ],
    };
    const { ws, session, loop, sessionRepo } = await setup({
      finishTaskMode: "enforced",
      driver: new MockDriver(script),
    });

    const events = await drain(loop, ws.id, session.id);
    const trajTitles = events
      .filter((e) => e.type === "traj")
      .map((e) => (e.event as { title: string }).title);
    expect(trajTitles).toContain("交付断言未通过（自然停机拦截）");
    expect(events[events.length - 1].type).toBe("turn_end");

    const turn = (await sessionRepo.get(session.id))!.turns.at(-1)!;
    expect(turn.finishReason).toBe("natural");
    expect(turn.content).toContain("补上的实质产出");
  });

  it("可插拔交付断言注入生效（自定义断言替换默认非空守卫）", async () => {
    const calls: number[] = [];
    const custom: DeliverableAssertion = (input) => {
      calls.push(input.stepCount);
      return { ok: true }; // 无条件放行（证明默认守卫被替换）
    };
    const { ws, session, loop, sessionRepo } = await setup({
      finishTaskMode: "enforced",
      driver: new MockDriver({ steps: [toolCallStep("f1", { summary: "直接宣告" })] }),
      deliverableAssertion: custom,
    });

    const events = await drain(loop, ws.id, session.id);
    expect(calls).toHaveLength(1); // 空产出但自定义断言放行 → 只调用一次
    expect(events[events.length - 1].type).toBe("turn_end");
    const turn = (await sessionRepo.get(session.id))!.turns.at(-1)!;
    expect(turn.finishReason).toBe("explicit");
  });

  it("off 模式下模型幻觉调用 finish_task：走通用执行链无害透传，不触发显式完成语义", async () => {
    const { ws, session, loop, sessionRepo } = await setup({
      finishTaskMode: "off",
      driver: new MockDriver({
        steps: [
          [{ type: "tool_call" as const, id: "c1", name: "finish_task", arguments: { summary: "幻觉宣告" } }],
          [{ type: "text" as const, text: "继续到自然结束" }],
        ],
      }),
    });

    const events = await drain(loop, ws.id, session.id);
    // 不出现显式完成轨迹；自然收尾
    const trajTitles = events
      .filter((e) => e.type === "traj")
      .map((e) => (e.event as { title: string }).title);
    expect(trajTitles).not.toContain("任务显式完成（finish_task）");
    const turn = (await sessionRepo.get(session.id))!.turns.at(-1)!;
    expect(turn.finishReason).toBe("natural");
  });

  it("enforced 模式下 finish_task 被用户禁用：禁用仲裁先行，不触发显式完成语义", async () => {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const harnessConfigRepo = new HarnessConfigRepository(driver);
    const toolConfigRepo = new ToolConfigRepository(driver);
    await harnessConfigRepo.patchNamespace("execution", { finishTaskMode: "enforced" });
    // 用户在 /api/tools 禁用 finish_task（守卫链之外的用户级启停语义）
    await toolConfigRepo.setEnabled("finish_task", false);

    const ws = await workspaceRepo.create({ name: "WS", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "S" });
    await settingsRepo.createProfile({ id: "p", name: "P", provider: "openai", model: "m", isDefault: true });

    const registry = new ToolRegistry();
    registry.register(FinishTaskTool);

    const mock = new MockDriver({
      steps: [
        [{ type: "tool_call" as const, id: "c1", name: "finish_task", arguments: { summary: "禁用中宣告" } }],
        [{ type: "text" as const, text: "实质产出后自然结束" }],
      ],
    });

    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo,
      toolRegistry: registry,
      actionHub: new ActionHub(),
      configResolver: new ConfigResolver(harnessConfigRepo),
      driverFactory: () => mock,
    });

    const events = await drain(loop, ws.id, session.id);
    const trajTitles = events
      .filter((e) => e.type === "traj")
      .map((e) => (e.event as { title: string }).title);
    expect(trajTitles).not.toContain("任务显式完成（finish_task）");
    // 模型收到「已禁用」结构化错误
    const toolResult = events.find((e) => e.type === "tool_call_result") as {
      toolName: string;
      status: string;
    };
    expect(toolResult.toolName).toBe("finish_task");
    expect(toolResult.status).toBe("error");

    const turn = (await sessionRepo.get(session.id))!.turns.at(-1)!;
    expect(turn.finishReason).toBe("natural");
  });
});
