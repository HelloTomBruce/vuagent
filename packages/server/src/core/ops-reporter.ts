import type { HarnessEventSink, HarnessOpsCode, HarnessOpsEvent } from "./event-sink.js";
import type { ProviderErrorClass } from "../adapters/resilience.js";

/**
 * 每轮构造的运维事件发射器（TASK-057 自 agent-loop.ts 拆出）：
 * 预绑 sessionId/turnId，消灭 runTurn 体内 10 处 emitOps 重复字面量；
 * sink 故障静默不阻断主链路（与原 AgentLoop.emitOps 口径一致）。
 *
 * 本模块只做「运维事件怎么发」，不持有任何轮次业务状态。
 */
export class OpsReporter {
  constructor(
    private sink: HarnessEventSink,
    private ids: { sessionId: string; turnId: string }
  ) {}

  private emit(event: HarnessOpsEvent): void {
    try {
      this.sink.emit(event);
    } catch {
      // sink 故障静默
    }
  }

  /** 轮次开始 */
  turnStart(input: { at: number; model?: string; permission?: string }): void {
    this.emit({
      type: "turn_start",
      at: input.at,
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      model: input.model,
      permission: input.permission,
    });
  }

  /** step 级运维事件 */
  stepFinish(input: { step: number; durationMs: number }): void {
    this.emit({
      type: "step_finish",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      step: input.step,
      durationMs: input.durationMs,
    });
  }

  /** 工具结果运维事件（含禁用/驳回/执行失败三类非 ok 路径） */
  toolResult(input: { tool: string; ok: boolean; durationMs: number; error?: string }): void {
    this.emit({
      type: "tool_result",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      tool: input.tool,
      ok: input.ok,
      durationMs: input.durationMs,
      code: input.ok ? undefined : "TOOL_EXECUTION_FAILED",
      error: input.ok ? undefined : input.error,
    });
  }

  /** 韧性层重试遥测接缝 → model_retry 运维事件 */
  modelRetry(info: {
    attempt: number;
    errorClass: ProviderErrorClass;
    delayMs: number;
    reason: string;
  }): void {
    this.emit({
      type: "model_retry",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      attempt: info.attempt,
      errorClass: info.errorClass,
      delayMs: info.delayMs,
      reason: info.reason,
    });
  }

  /** 模型降级链遥测：档案 A 失败切换档案 B（流开始前） */
  modelFallback(info: {
    from: string;
    to: string;
    errorClass: ProviderErrorClass;
    reason: string;
  }): void {
    this.emit({
      type: "model_fallback",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      from: info.from,
      to: info.to,
      errorClass: info.errorClass,
      reason: info.reason,
    });
  }

  /** 中止（user=手动停止 / new_task=顶替 / watchdog=看门狗超时 / token_budget=单轮预算熔断 / lease_lost=跨副本租约丢失） */
  abort(input: {
    reason: "user" | "new_task" | "watchdog" | "token_budget" | "lease_lost";
    code: HarnessOpsCode;
  }): void {
    this.emit({
      type: "abort",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      reason: input.reason,
      code: input.code,
    });
  }

  /** 成本记账失败（fail-open，不影响主链路） */
  costRecordFailed(): void {
    this.emit({
      type: "warn",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      code: "COST_RECORD_FAILED",
      detail: "成本记账失败（fail-open，不影响主链路）",
    });
  }

  /** 落库二次失败显式告警（不再完全静默） */
  persistFailed(err: unknown): void {
    this.emit({
      type: "error",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      code: "TURN_PERSIST_FAILED",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  /** TASK-101：partial JSON 静默修复可观测化——修复发生即发事件，不再无声吞掉模型格式错误 */
  partialRepair(toolName: string): void {
    this.emit({
      type: "warn",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      code: "MODEL_PARTIAL_REPAIR",
      detail: `工具 ${toolName} 的入参 JSON 未闭合，容错修补后放行（模型输出格式疑似异常）`,
    });
  }

  /** TASK-101 实验原型：mid-turn resume 归因（VUAGENT_EXPERIMENT_RESUME 门控，不进默认路径） */
  turnResumed(checkpointId: string): void {
    this.emit({
      type: "info",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      code: "TURN_RESUMED",
      detail: `从 checkpoint ${checkpointId} 快照续跑（实验原型，诚实归因 resumed）`,
    });
  }

  /** 轮次收尾（done/error；turnFinishCode 存在时代表被中止/超时后收尾） */
  turnFinish(input: {
    status: "done" | "error";
    stepCount: number;
    durationMs: number;
    totalTokens: number;
    code?: HarnessOpsCode;
    message?: string;
    /** 轮次收尾形态：explicit / natural / truncated；中止时缺省 */
    finishReason?: "explicit" | "natural" | "truncated";
  }): void {
    this.emit({
      type: "turn_finish",
      at: Date.now(),
      sessionId: this.ids.sessionId,
      turnId: this.ids.turnId,
      status: input.status,
      stepCount: input.stepCount,
      durationMs: input.durationMs,
      totalTokens: input.totalTokens,
      code: input.code,
      message: input.message,
      finishReason: input.finishReason,
    });
  }
}
