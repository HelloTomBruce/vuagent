import type { SessionRepository } from "../storage/repositories/session.repository.js";
import type { CheckpointEntity, TurnEntity } from "../storage/interfaces.js";
import type { CostRecorder } from "./pricing-table.js";
import { TelemetryLedger, clipTrajectoryEvent } from "./telemetry.js";
import type { OpsReporter } from "./ops-reporter.js";

/**
 * 轮次持久化助手（TASK-057 自 agent-loop.ts 拆出）：
 * 收走 runTurn 体内五段落库逻辑——running 行即时落库、每 step 增量 updateTurn、
 * 终态 upsert（done/error 幂等替换 running 行）、落库二次失败告警、成本记账闭包。
 *
 * 全部路径保持 best-effort / fail-open 口径：落库失败不阻断主链路。
 */
export interface TurnPersistenceOptions {
  sessionRepo: SessionRepository;
  costRecorder?: CostRecorder;
  ops: OpsReporter;
  telemetry: TelemetryLedger;
  sessionId: string;
  turnId: string;
}

/** 每 step 增量落盘所需的累积态快照（由调用方从循环局部变量装配） */
export interface TurnProgressState {
  content: string;
  thought: string;
  cards: Array<{ id: string; type: string; data: any }>;
  stepCount: number;
  checkpoints: CheckpointEntity[];
  /** 本 turn 最后一步的真实上下文占用（最后一步 prompt + completion） */
  contextTokens: number;
}

/** 终态实体装配所需的累积态快照（done / error 两段 upsert 共用） */
export interface TurnFinalState {
  prompt: string;
  content: string;
  thought: string;
  cards: Array<{ id: string; type: string; data: any }>;
  /** R8：中止成因（协议 reason 枚举），落库持久化供历史恢复呈现徽标 */
  abortedReason?: "user" | "timeout" | "preempt" | "token_budget";
  /** 轮次收尾形态：explicit（finish_task 显式宣告）/ natural（自然停机）/ truncated（步数耗尽） */
  finishReason?: "explicit" | "natural" | "truncated";
  stepCount: number;
  checkpoints: CheckpointEntity[];
  startAt: number;
  /** done 实体 telemetry 用：整轮耗时与末步真实上下文占用 */
  durationMs?: number;
  contextTokens?: number;
}

export class TurnPersistence {
  constructor(private opts: TurnPersistenceOptions) {}

  /**
   * TASK-049 即时落库：轮次开始即落 running 行（中途崩溃留痕），
   * 每 step 增量更新，终态 appendTurn upsert 兜底（幂等替换，不产生重复行）。
   * 初始落库失败不阻断执行；终态 appendTurn 仍会兜底落库。
   */
  async appendRunningRow(input: { prompt: string; startAt: number }): Promise<void> {
    try {
      await this.opts.sessionRepo.appendTurn(this.opts.sessionId, {
        id: this.opts.turnId,
        sessionId: this.opts.sessionId,
        prompt: input.prompt,
        status: "running",
        stepCount: 0,
        checkpoints: [],
        cards: [],
        createdAt: input.startAt,
      });
    } catch {
      // 初始落库失败不阻断执行；终态 appendTurn 仍会兜底落库
    }
  }

  /**
   * 每 step 结束后的增量进度落盘（best-effort，失败不影响主链路）：
   * 先发 TASK-051 step 级运维事件，再 updateTurn（含本步 checkpoint，崩溃时已完成步骤留痕）。
   */
  async persistProgress(state: TurnProgressState, startAt: number): Promise<void> {
    // TASK-051：step 级运维事件
    this.opts.ops.stepFinish({
      step: state.stepCount,
      durationMs: Date.now() - startAt,
    });
    try {
      await this.opts.sessionRepo.updateTurn(this.opts.sessionId, this.opts.turnId, {
        status: "running",
        content: state.content,
        thought: state.thought,
        cards: state.cards,
        stepCount: state.stepCount,
        checkpoints: state.checkpoints,
        telemetry: {
          durationMs: Date.now() - startAt,
          ttftMs: this.opts.telemetry.exportSummary().ttftMs,
          totalTokens: this.opts.telemetry.exportSummary().tokens.totalTokens,
          promptTokens: this.opts.telemetry.exportSummary().tokens.promptTokens,
          completionTokens: this.opts.telemetry.exportSummary().tokens.completionTokens,
          contextTokens: state.contextTokens,
          laneEventsCount: this.opts.telemetry.getEvents().length,
          events: this.opts.telemetry.getEvents().map(clipTrajectoryEvent),
        },
      });
    } catch {
      // 增量落盘失败静默：终态收尾仍会兜底
    }
  }

  /** 终态 upsert：done / error 实体整体落库（幂等替换 running 行） */
  async finalizeTurn(entity: TurnEntity): Promise<void> {
    await this.opts.sessionRepo.appendTurn(this.opts.sessionId, entity);
  }

  /**
   * 终态 upsert（done 段）：实体装配 + 落库。
   * R8：优雅中止（loop-top break）以 done 落库但仍标记中止成因。
   * 落库失败向调用方抛出（由外层错误收尾兜底）。
   */
  async finalizeDone(state: TurnFinalState): Promise<void> {
    const turnEntity: TurnEntity = {
      id: this.opts.turnId,
      sessionId: this.opts.sessionId,
      prompt: state.prompt,
      content: state.content,
      thought: state.thought,
      cards: state.cards,
      status: "done",
      // R8：优雅中止（loop-top break）以 done 落库但仍标记中止成因
      ...(state.abortedReason ? { abortedReason: state.abortedReason } : {}),
      ...(state.finishReason ? { finishReason: state.finishReason } : {}),
      stepCount: state.stepCount,
      checkpoints: state.checkpoints,
      telemetry: {
        durationMs: state.durationMs ?? 0,
        ttftMs: this.opts.telemetry.exportSummary().ttftMs,
        totalTokens: this.opts.telemetry.exportSummary().tokens.totalTokens,
        promptTokens: this.opts.telemetry.exportSummary().tokens.promptTokens,
        completionTokens: this.opts.telemetry.exportSummary().tokens.completionTokens,
        contextTokens: state.contextTokens,
        laneEventsCount: this.opts.telemetry.getEvents().length,
        // 轨迹事件明细落库（detail/result 截断），历史会话的 turn 内联轨迹由此恢复
        events: this.opts.telemetry.getEvents().map(clipTrajectoryEvent),
      },
      createdAt: state.startAt,
      completedAt: Date.now(),
    };
    await this.finalizeTurn(turnEntity);
  }

  /**
   * 终态 upsert（error 段）：实体装配 + 落库 + 成本记账。
   * R8：异常中止（catch 路径）同样标记中止成因。
   * 落库二次失败显式告警（不再完全静默），不向调用方抛出。
   */
  async finalizeError(state: TurnFinalState & { errorMessage: string }, model: string): Promise<void> {
    try {
      const errorTurn: TurnEntity = {
        id: this.opts.turnId,
        sessionId: this.opts.sessionId,
        prompt: state.prompt,
        content: state.content || `⚠️ 执行过程中发生错误: ${state.errorMessage}`,
        thought: state.thought,
        cards: state.cards,
        status: "error",
        errorMessage: state.errorMessage,
        // R8：异常中止（catch 路径）同样标记中止成因
        ...(state.abortedReason ? { abortedReason: state.abortedReason } : {}),
        stepCount: state.stepCount,
        checkpoints: state.checkpoints,
        createdAt: state.startAt,
        completedAt: Date.now(),
      };
      await this.finalizeTurn(errorTurn);
      this.recordCost(model);
    } catch (persistErr: unknown) {
      // TASK-051：落库二次失败显式告警（不再完全静默）
      this.reportPersistFailure(persistErr);
    }
  }

  /** 终态落库二次失败显式告警（不再完全静默） */
  reportPersistFailure(err: unknown): void {
    this.opts.ops.persistFailed(err);
  }

  /**
   * TASK-052 成本记账（fire-and-forget fail-open）：
   * done/error/abort 收尾均记，口径=telemetry 累计。
   */
  recordCost(model: string): void {
    const rec = this.opts.costRecorder;
    if (!rec) return;
    const summary = this.opts.telemetry.exportSummary();
    if (summary.tokens.totalTokens <= 0) return;
    rec({
      turnId: this.opts.turnId,
      sessionId: this.opts.sessionId,
      model,
      promptTokens: summary.tokens.promptTokens,
      completionTokens: summary.tokens.completionTokens,
      finishedAt: Date.now(),
    }).catch(() => {
      this.opts.ops.costRecordFailed();
    });
  }
}
