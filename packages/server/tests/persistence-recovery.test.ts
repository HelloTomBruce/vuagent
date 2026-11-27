import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { recoverInterruptedTurns } from "../src/core/recovery.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { CheckpointEntity } from "../src/storage/interfaces.js";
import type { ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";
import type { HarnessTool } from "../src/core/types.js";

/**
 * TASK-049 即时落库 + 进程重启恢复：
 * - 轮次开始即落 running 行，运行中可读到 running turn 与已完成 step 的 checkpoints
 * - done/error 终态幂等（upsert 替换，无重复行）
 * - recoverInterruptedTurns 把遗留 running 行诚实标记 error/process_restart
 */
describe("即时落库与崩溃恢复（TASK-049）", () => {
  /** 慢速桩 driver：每步之间让出事件循环，使「运行中读库」窗口可观测 */
  class SlowTwoStepDriver extends MockDriver {
    override async *generateStream(_req: ModelDriverRequest): AsyncGenerator<ModelStreamChunk> {
      yield { type: "text_delta", text: "step-one" };
      await new Promise((r) => setTimeout(r, 50));
      yield { type: "text_delta", text: "-done" };
    }
  }

  async function setup(modelDriver: MockDriver) {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws = await workspaceRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "s" });
    await settingsRepo.createProfile({
      id: "p1",
      name: "P",
      provider: "openai",
      model: "m",
      apiKey: "sk-test",
      isDefault: true,
    });
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      modelDriver,
    });
    return { loop, sessionRepo, session, ws };
  }

  it("运行中即可读到 running turn（轮次开始即落库）", async () => {
    const { loop, sessionRepo, session, ws } = await setup(new SlowTwoStepDriver());

    // 立即启动消费（生成器是惰性的，必须先驱动才有执行）
    const consumption = (async () => {
      for await (const _ of loop.runTurn(
        { sessionId: session.id, workspaceId: ws.id, prompt: "hi" },
        undefined
      )) {
        // drain
      }
    })();
    // 等首个 running 行出现（driver 中段 sleep 50ms 留出窗口）
    await new Promise((r) => setTimeout(r, 30));
    const midRun = await sessionRepo.get(session.id);
    expect(midRun!.turns.length).toBe(1);
    expect(midRun!.turns[0].status).toBe("running");
    expect(midRun!.turns[0].prompt).toBe("hi");

    await consumption;

    const after = await sessionRepo.get(session.id);
    expect(after!.turns.length).toBe(1); // 幂等：running 行被终态 upsert 替换
    expect(after!.turns[0].status).toBe("done");
  });

  it("多步轮次：每步 checkpoint 落库，终态后 checkpoints 完整且无重复 turn 行", async () => {
    const mock = new MockDriver();
    const tool: HarnessTool = {
      name: "echo_probe",
      description: "假工具",
      parameters: Type.Object({ x: Type.Number() }),
      execute: async () => ({ ok: true }),
    };
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws = await workspaceRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "s" });
    await settingsRepo.createProfile({
      id: "p1",
      name: "P",
      provider: "openai",
      model: "m",
      apiKey: "sk-test",
      isDefault: true,
    });
    const registry = new ToolRegistry();
    registry.register(tool);
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: registry,
      actionHub: new ActionHub(),
      modelDriver: mock,
    });

    mock.setScript({
      steps: [
        [
          { type: "text", text: "先查" },
          { type: "tool_call", id: "c1", name: "echo_probe", arguments: { x: 1 } },
        ],
        [{ type: "text", text: "完成" }],
      ],
    });

    for await (const _ of loop.runTurn(
      { sessionId: session.id, workspaceId: ws.id, prompt: "multi" },
      undefined
    )) {
      // drain
    }

    const after = await sessionRepo.get(session.id);
    expect(after!.turns.length).toBe(1);
    expect(after!.turns[0].status).toBe("done");
    // step1（工具调用后）+ step2（纯文本收尾）各一个 checkpoint
    expect(after!.turns[0].checkpoints.length).toBe(2);
    expect(after!.turns[0].content).toBe("先查完成");
  });

  it("recoverInterruptedTurns：遗留 running 行 → error/process_restart，checkpoint 保留", async () => {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const ws = await workspaceRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const s1 = await sessionRepo.create({ workspaceId: ws.id, title: "crash-1" });
    const s2 = await sessionRepo.create({ workspaceId: ws.id, title: "clean" });

    // 模拟崩溃现场：s1 留一个 running 行（带 2 个已完成 checkpoint），s2 已 done
    await sessionRepo.appendTurn(s1.id, {
      id: "turn-crash",
      sessionId: s1.id,
      prompt: "被中断的一轮",
      status: "running",
      content: "已完成的部分输出",
      stepCount: 2,
      checkpoints: [
        { id: "cp-1", turnId: "turn-crash", stepIndex: 1, messagesSnapshot: [], snapshotAt: 1 },
        { id: "cp-2", turnId: "turn-crash", stepIndex: 2, messagesSnapshot: [], snapshotAt: 2 },
      ] as CheckpointEntity[],
      createdAt: 1,
    });
    await sessionRepo.appendTurn(s2.id, {
      id: "turn-ok",
      sessionId: s2.id,
      prompt: "正常完成",
      status: "done",
      stepCount: 1,
      checkpoints: [],
      createdAt: 1,
      completedAt: 2,
    });

    const recovered = await recoverInterruptedTurns(sessionRepo);
    expect(recovered).toEqual([
      { sessionId: s1.id, turnId: "turn-crash", checkpointCount: 2 },
    ]);

    const after1 = await sessionRepo.get(s1.id);
    expect(after1!.turns[0].status).toBe("error");
    expect(after1!.turns[0].errorMessage).toBe("process_restart");
    expect(after1!.turns[0].content).toBe("已完成的部分输出"); // 进度保留
    expect(after1!.turns[0].checkpoints.length).toBe(2);

    // 幂等：再扫一遍无新恢复
    expect(await recoverInterruptedTurns(sessionRepo)).toEqual([]);
    // done 行不受影响
    const after2 = await sessionRepo.get(s2.id);
    expect(after2!.turns[0].status).toBe("done");
  });

  it("崩溃后恢复的会话可正常续跑（恢复行不阻塞下一轮）", async () => {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws = await workspaceRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "s" });
    await sessionRepo.appendTurn(session.id, {
      id: "turn-old",
      sessionId: session.id,
      prompt: "上一轮被中断",
      status: "running",
      stepCount: 1,
      checkpoints: [],
      createdAt: 1,
    });
    await recoverInterruptedTurns(sessionRepo);

    await settingsRepo.createProfile({
      id: "p1",
      name: "P",
      provider: "openai",
      model: "m",
      apiKey: "sk-test",
      isDefault: true,
    });
    const mock = new MockDriver();
    mock.setScript({ steps: [[{ type: "text", text: "续跑成功" }]] });
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      modelDriver: mock,
    });

    for await (const _ of loop.runTurn(
      { sessionId: session.id, workspaceId: ws.id, prompt: "继续" },
      undefined
    )) {
      // drain
    }

    const after = await sessionRepo.get(session.id);
    expect(after!.turns.length).toBe(2);
    expect(after!.turns[0].status).toBe("error");
    expect(after!.turns[0].errorMessage).toBe("process_restart");
    expect(after!.turns[1].status).toBe("done");
    expect(after!.turns[1].content).toBe("续跑成功");
  });
});
