/**
 * TASK-091：turn 内进度落盘防抖批处理
 *
 * - scheduleProgress：窗口内多次 step 合并（永远写最新态），updateTurn 次数 ≪ step 数；
 * - step 运维事件每步照发（观测轨不合并）；
 * - flushProgress：HITL 挂起前强制落盘（beforeSuspend 钩子经 executeToolCallStep 验证）；
 * - finalizeDone：丢弃缓冲（终态 upsert 整体替换 running 行，缓冲再写是浪费）；
 * - 崩溃窗口诚实语义：running 行即时落库（appendRunningRow），窗口内崩溃丢的只是增量。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnPersistence } from "../src/core/turn-persistence.js";
import { createOtlpTraceSink } from "../src/core/otlp-trace-sink.js";
import { executeToolCallStep } from "../src/core/tool-step-executor.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { BashRunTool } from "../src/tools/system/bash-tool.js";
import { TelemetryLedger } from "../src/core/telemetry.js";
import { OpsReporter } from "../src/core/ops-reporter.js";
import { createNoopSink } from "../src/core/event-sink.js";
import type { SessionRepository as SessionRepo } from "../src/storage/repositories/session.repository.js";

/* ==========================================================================
   TurnPersistence 单元（stub 仓储计数 updateTurn）
   ========================================================================== */

function makePersistence() {
  const updateTurnCalls: Array<Record<string, unknown>> = [];
  const appendTurnCalls: unknown[] = [];
  const stepFinishCalls: number[] = [];
  const sessionRepo = {
    appendTurn: async (_sid: string, entity: unknown) => {
      appendTurnCalls.push(entity);
    },
    updateTurn: async (_sid: string, _tid: string, patch: Record<string, unknown>) => {
      updateTurnCalls.push(patch);
      return ({} as unknown);
    },
  } as unknown as SessionRepo;

  const persistence = new TurnPersistence({
    sessionRepo,
    ops: {
      stepFinish: (arg: { step: number }) => stepFinishCalls.push(arg.step),
    } as unknown as OpsReporter,
    telemetry: new TelemetryLedger("turn-1"),
    sessionId: "sess-1",
    turnId: "turn-1",
  });
  return { persistence, updateTurnCalls, appendTurnCalls, stepFinishCalls, sessionRepo };
}

const progressState = (step: number, content: string) => ({
  content,
  thought: "",
  cards: [],
  stepCount: step,
  checkpoints: [],
  contextTokens: 10,
});

describe("TurnPersistence 防抖批处理（TASK-091）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("窗口内 N 步合并：updateTurn 1 次、写的是最新态、stepFinish 每步照发", async () => {
    const { persistence, updateTurnCalls, stepFinishCalls } = makePersistence();
    for (let step = 1; step <= 5; step++) {
      persistence.scheduleProgress(progressState(step, `content-${step}`), 0);
    }
    expect(updateTurnCalls).toHaveLength(0); // 窗口未到，零写
    expect(stepFinishCalls).toEqual([1, 2, 3, 4, 5]); // 观测轨不合并

    await vi.advanceTimersByTimeAsync(TurnPersistence.PROGRESS_WINDOW_MS + 10);
    expect(updateTurnCalls).toHaveLength(1); // ⌈N/窗口⌉ 合并为 1 次
    expect(updateTurnCalls[0].content).toBe("content-5"); // 永远最新态
    expect(updateTurnCalls[0].stepCount).toBe(5);
  });

  it("flushProgress 强制立即落盘并清空缓冲；二次 flush 幂等", async () => {
    const { persistence, updateTurnCalls } = makePersistence();
    persistence.scheduleProgress(progressState(1, "flush-me"), 0);
    await persistence.flushProgress();
    expect(updateTurnCalls).toHaveLength(1);
    expect(updateTurnCalls[0].content).toBe("flush-me");

    await persistence.flushProgress();
    expect(updateTurnCalls).toHaveLength(1); // 幂等：无缓冲不写

    // 定时器已清：后续不再触发
    await vi.advanceTimersByTimeAsync(TurnPersistence.PROGRESS_WINDOW_MS + 100);
    expect(updateTurnCalls).toHaveLength(1);
  });

  it("finalizeDone 丢弃缓冲：appendTurn 落终态，updateTurn 不发生", async () => {
    const { persistence, updateTurnCalls, appendTurnCalls } = makePersistence();
    persistence.scheduleProgress(progressState(2, "pending"), 0);
    await persistence.finalizeDone({
      prompt: "p",
      content: "final",
      thought: "",
      cards: [],
      stepCount: 2,
      checkpoints: [],
      startAt: 0,
      durationMs: 10,
      contextTokens: 10,
    });
    expect(updateTurnCalls).toHaveLength(0); // 缓冲被丢弃而非落盘
    expect(appendTurnCalls).toHaveLength(1);
    expect((appendTurnCalls[0] as { status: string }).status).toBe("done");
    expect((appendTurnCalls[0] as { content: string }).content).toBe("final");
  });

  it("appendRunningRow 即时落库（崩溃留痕不受防抖影响）", async () => {
    const { persistence, appendTurnCalls } = makePersistence();
    await persistence.appendRunningRow({ prompt: "p", startAt: 123 });
    expect(appendTurnCalls).toHaveLength(1);
    expect((appendTurnCalls[0] as { status: string }).status).toBe("running");
  });
});

/* ==========================================================================
   executeToolCallStep beforeSuspend 钩子（HITL 挂起前强制落盘）
   ========================================================================== */

describe("executeToolCallStep beforeSuspend（TASK-091）", () => {
  it("review 模式 bash_run 挂起前调用 beforeSuspend，恢复后正常执行", async () => {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const toolConfigRepo = new ToolConfigRepository(driver);
    const ws = await workspaceRepo.create({
      name: "w",
      rootPath: process.cwd(),
      permission: "read-write",
    });
    const session = await sessionRepo.create({ workspaceId: ws.id, permission: "review" });
    const registry = new ToolRegistry();
    registry.register(BashRunTool);
    const actionHub = new ActionHub();

    const beforeSuspend = vi.fn(async () => {});
    const ops = new OpsReporter(createNoopSink(), { sessionId: session.id, turnId: "turn-test" });
    const deps = { toolConfigRepo, sessionRepo, toolRegistry: registry, actionHub, ops };
    const input = {
      calls: [{ id: "call-1", name: "bash_run", argumentsStr: JSON.stringify({ command: "echo hi" }) }],
      runSignal: new AbortController().signal,
      workspace: ws,
      sessionId: session.id,
      effectiveMode: "review" as const,
      sessionPermissionAtStart: session.permission,
      approvalTimeoutMs: 1_000,
      bashTimeoutCeilingMs: 5_000,
      getContentLength: () => 0,
      accumulatedCards: [],
      messages: [],
      telemetry: new TelemetryLedger("turn-test"),
      beforeSuspend,
    };

    const gen = executeToolCallStep(deps, input);
    const events: string[] = [];
    // 消费到 suspended 后，异步 resolve 审批放行
    const pump = (async () => {
      for await (const evt of gen) {
        events.push(evt.type);
        if (evt.type === "suspended") {
          // 挂起已发生：此前的 beforeSuspend 必须已被调用（生成器按序执行）
          setTimeout(() => {
            void actionHub.resolveAction("call-1", { approved: true, source: "test" } as never);
          }, 10);
        }
      }
    })();
    await Promise.race([pump, new Promise((r) => setTimeout(r, 5_000))]);
    expect(events).toContain("suspended");
    expect(events).toContain("resumed");
    expect(beforeSuspend).toHaveBeenCalledTimes(1);
  });
});

/* ==========================================================================
   OtlpTraceSink flush 并发信号量（存储域审查 O2）
   注：本文件是本次审查修复允许触碰的两个测试文件之一，故 OTLP 用例暂驻于此。
   ========================================================================== */

/** 等若干宏任务 tick，让 fire-and-forget 的 promise 链收敛 */
const settle = async (ticks = 10): Promise<void> => {
  for (let i = 0; i < ticks; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("OtlpTraceSink flush 并发信号量（存储域审查 O2）", () => {
  it("在途推送不超上限（默认 8），满则排队，全部最终送达", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { active: 0, maxActive: 0, total: 0 };
    // 计数 fetch stub：请求被门闩挂住，直到 release 才放行
    const gatedFetch: typeof fetch = async () => {
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      state.total++;
      await gate;
      state.active--;
      return new Response(null, { status: 200 });
    };
    const sink = createOtlpTraceSink({
      endpoint: "http://collector.test/v1/traces",
      fetchImpl: gatedFetch,
      maxInFlightFlushes: 8,
    });

    for (let i = 0; i < 20; i++) {
      sink.emit({ type: "turn_start", at: i, sessionId: "s", turnId: `t${i}` });
      sink.emit({
        type: "turn_finish",
        at: i + 1,
        sessionId: "s",
        turnId: `t${i}`,
        status: "done",
        stepCount: 1,
        durationMs: 1,
      });
    }
    // 20 棵树关树 → 20 次 flush：在途恰为上限 8，其余排队（修复前：20 全部并发）
    expect(state.total).toBe(8);
    expect(state.active).toBe(8);
    expect(state.maxActive).toBe(8);

    release();
    await settle();
    expect(state.total).toBe(20); // 排队者全部送达
    expect(state.active).toBe(0);
  });

  it("fail-open 保持：推送失败收敛到 onError，排队者继续推进", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const errors: unknown[] = [];
    let launched = 0;
    const failingFetch: typeof fetch = async () => {
      launched++;
      await gate;
      throw new Error("collector down");
    };
    const sink = createOtlpTraceSink({
      endpoint: "http://collector.test/v1/traces",
      fetchImpl: failingFetch,
      onError: (e) => errors.push(e),
      maxInFlightFlushes: 2,
    });

    for (let i = 0; i < 5; i++) {
      sink.emit({ type: "turn_start", at: i, sessionId: "s", turnId: `t${i}` });
      sink.emit({
        type: "turn_finish",
        at: i + 1,
        sessionId: "s",
        turnId: `t${i}`,
        status: "done",
        stepCount: 1,
        durationMs: 1,
      });
    }
    expect(launched).toBe(2); // 信号量满，其余排队

    release();
    await settle();
    expect(launched).toBe(5);
    expect(errors).toHaveLength(5); // 全部 fail-open 收敛到 onError，未打断 emit
  });
});
