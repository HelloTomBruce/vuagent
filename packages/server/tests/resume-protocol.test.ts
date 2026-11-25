/**
 * TASK-101：partial JSON 修复可观测 + 协议版本协商 + mid-turn resume 门控原型
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { OpsReporter } from "../src/core/ops-reporter.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { WorkspaceEntity } from "../src/storage/interfaces.js";
import type { HarnessOpsEvent } from "../src/core/event-sink.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const H = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

describe("协议版本协商（TASK-101）", () => {
  it("显式头一致（x-vuagent-protocol-version: 1）→ 正常 SSE", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/sessions/none/stream", {
      headers: { Origin: LOCAL_ORIGIN, "x-vuagent-protocol-version": "1" },
    });
    expect(res.status).toBe(200);
  });

  it("显式头不兼容（v2）→ 426 + supported 清单", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { ...H, "x-vuagent-protocol-version": "2" },
      body: JSON.stringify({ prompt: "hi" }),
    });
    expect(res.status).toBe(426);
    const json = (await res.json()) as { code: string; supported: string[] };
    expect(json.code).toBe("PROTOCOL_VERSION_MISMATCH");
    expect(json.supported).toEqual(["1"]);
  });

  it("未携带头（旧客户端）→ 放行（兼容语义不变）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/chat", { method: "POST", headers: H, body: JSON.stringify({ prompt: "" }) });
    expect(res.status).not.toBe(426);
  });
});

describe("OpsReporter 新事件（TASK-101）", () => {
  function capture(): { ops: OpsReporter; events: HarnessOpsEvent[] } {
    const events: HarnessOpsEvent[] = [];
    const ops = new OpsReporter({ emit: (e) => events.push(e) }, { sessionId: "s", turnId: "t" });
    return { ops, events };
  }

  it("partialRepair 发 warn + MODEL_PARTIAL_REPAIR", () => {
    const { ops, events } = capture();
    ops.partialRepair("fs_edit");
    const ev = events[0] as { type: string; code: string; detail: string };
    expect(ev.type).toBe("warn");
    expect(ev.code).toBe("MODEL_PARTIAL_REPAIR");
    expect(ev.detail).toContain("fs_edit");
  });

  it("turnResumed 发 info + TURN_RESUMED（含 checkpoint id）", () => {
    const { ops, events } = capture();
    ops.turnResumed("cp-42");
    const ev = events[0] as { type: string; code: string; detail: string };
    expect(ev.type).toBe("info");
    expect(ev.code).toBe("TURN_RESUMED");
    expect(ev.detail).toContain("cp-42");
  });
});

describe("mid-turn resume 门控原型（TASK-101）", () => {
  beforeEach(() => {
    delete process.env.VUAGENT_EXPERIMENT_RESUME;
  });
  afterEach(() => {
    delete process.env.VUAGENT_EXPERIMENT_RESUME;
    vi.restoreAllMocks();
  });

  async function setupWithCheckpoint() {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws: WorkspaceEntity = await workspaceRepo.create({
      name: "w",
      rootPath: "/tmp",
      permission: "read-write",
    });
    const session = await sessionRepo.create({ workspaceId: ws.id, permission: "auto" });
    const mockDriver = new MockDriver();
    mockDriver.setScript({ steps: [[{ type: "text", text: "resumed-ok" }]] });
    const captured: HarnessOpsEvent[] = [];
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      modelDriver: mockDriver,
      eventSink: { emit: (e) => captured.push(e) },
    });
    // 注入历史 checkpoint（含快照）
    await sessionRepo.appendTurn(session.id, {
      id: "turn-dead",
      sessionId: session.id,
      prompt: "old",
      content: "中断前的部分输出",
      status: "error",
      errorMessage: "process_restart",
      stepCount: 1,
      checkpoints: [
        {
          id: "cp-resume-target",
          turnId: "turn-dead",
          stepIndex: 1,
          messagesSnapshot: [
            { role: "user", content: "old prompt" },
            { role: "assistant", content: "old partial answer" },
          ],
          snapshotAt: Date.now(),
        },
      ],
      cards: [],
      createdAt: 1,
      completedAt: 2,
    } as never);
    return { loop, sessionRepo, session, ws, captured };
  }

  it("门控开 + 显式 checkpoint → 快照重建续跑 + TURN_RESUMED 归因", async () => {
    process.env.VUAGENT_EXPERIMENT_RESUME = "1";
    const { loop, session, captured } = await setupWithCheckpoint();
    for await (const _evt of loop.runTurn({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      prompt: "继续完成",
      resumeFromCheckpointId: "cp-resume-target",
    })) {
      void _evt;
    }
    const resumed = captured.find((e) => (e as { code?: string }).code === "TURN_RESUMED") as {
      detail?: string;
    } | undefined;
    expect(resumed).toBeTruthy();
    expect(resumed?.detail).toContain("cp-resume-target");
  });

  it("门控关：resumeFromCheckpointId 被完全忽略（常规口径，无 TURN_RESUMED）", async () => {
    const { loop, session, captured } = await setupWithCheckpoint();
    for await (const _evt of loop.runTurn({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      prompt: "继续完成",
      resumeFromCheckpointId: "cp-resume-target",
    })) {
      void _evt;
    }
    expect(captured.find((e) => (e as { code?: string }).code === "TURN_RESUMED")).toBeUndefined();
  });

  it("门控开但 checkpoint 不存在 → 回落常规口径（不报错）", async () => {
    process.env.VUAGENT_EXPERIMENT_RESUME = "1";
    const { loop, session, captured } = await setupWithCheckpoint();
    for await (const _evt of loop.runTurn({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      prompt: "继续完成",
      resumeFromCheckpointId: "cp-not-exist",
    })) {
      void _evt;
    }
    expect(captured.find((e) => (e as { code?: string }).code === "TURN_RESUMED")).toBeUndefined();
  });
});
