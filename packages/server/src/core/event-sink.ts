import type { ProviderErrorClass } from "../adapters/resilience.js";

/**
 * 运维级结构化事件出口（TASK-051，对标 harness-core TelemetrySink）：
 * 把 server 各层原先的散文式 console 输出升级为类型化事件流，
 * 供日志采集器（Datadog/Loki）结构化摄取与 grep 定位。
 *
 * 与 UI 层轨迹（core/telemetry.ts TrajectoryLedger，落库供前端回放）正交：
 * 本模块面向运维，不落库、随 ServerOptions.eventSink 注入，缺省 NDJSON console。
 */

/** 错误/警示分类码（可 grep 枚举） */
export type HarnessOpsCode =
  // 模型面（来自 ClassifiedModelError.errorClass 映射）
  | "MODEL_AUTH"
  | "MODEL_RATE_LIMIT"
  | "MODEL_SERVER"
  | "MODEL_NETWORK"
  | "MODEL_BAD_REQUEST"
  | "MODEL_CONTEXT_OVERFLOW"
  | "MODEL_CONTEXT_OVERFLOW_AUTO_HEAL"
  | "MODEL_UNKNOWN"
  // 模型降级链（按序切换备用档案）
  | "MODEL_FALLBACK"
  // 工具面
  | "TOOL_EXECUTION_FAILED"
  // 轮次生命周期
  | "WATCHDOG_TIMEOUT"
  | "RUN_TOKEN_BUDGET_EXCEEDED"
  | "TURN_ABORTED"
  | "TURN_PREEMPTED"
  | "PREEMPT_TIMEOUT"
  | "TURN_EXECUTION_FAILED"
  | "TURN_PERSIST_FAILED"
  // 跨副本租约（Redis 形态）
  | "TURN_LEASE_HEARTBEAT_FAILED"
  | "TURN_LEASE_LOST"
  | "RECOVERED_LEASES"
  // 准入与恢复
  | "SESSION_RUNNING_REJECTED"
  | "CONCURRENCY_REJECTED"
  | "QUOTA_EXCEEDED"
  | "COST_RECORD_FAILED"
  | "RECOVERED_TURNS"
  // TASK-101 实验面
  | "TURN_RESUMED"
  | "MODEL_PARTIAL_REPAIR";

/** ProviderErrorClass → MODEL_* 分类码映射 */
export function opsCodeForErrorClass(errorClass: ProviderErrorClass): HarnessOpsCode {
  switch (errorClass) {
    case "auth":
      return "MODEL_AUTH";
    case "rate_limit":
      return "MODEL_RATE_LIMIT";
    case "server":
      return "MODEL_SERVER";
    case "network":
      return "MODEL_NETWORK";
    case "bad_request":
      return "MODEL_BAD_REQUEST";
    case "context_overflow":
      return "MODEL_CONTEXT_OVERFLOW";
    default:
      return "MODEL_UNKNOWN";
  }
}

/**
 * 中止成因集中映射（R5 修复）：hub 发起中止时的 AbortKind 经
 * AbortController.abort(reason) 传递给 agent-loop，loop 与 hub 共用本函数
 * 保证 ops 台账与 SSE 协议事件对同一次中止的归因一致——
 * 此前 preempt 会被 hub 记 TURN_PREEMPTED、被 loop 误记 TURN_ABORTED。
 */
export interface AbortCauseMapping {
  /** SSE aborted 事件的协议 reason 枚举 */
  protocolReason: "user" | "timeout" | "preempt" | "token_budget";
  /** ops abort 事件的 reason 字段 */
  opsReason: "user" | "new_task" | "watchdog" | "token_budget" | "lease_lost";
  /** ops 分类码 */
  code: HarnessOpsCode;
}

export function mapAbortCause(input: {
  watchdogFired: boolean;
  /** 单轮 token 预算熔断触发（优先级高于看门狗——两者同用 watchdog controller） */
  tokenBudgetFired?: boolean;
  /** runSignal.reason（hub abort(kind) 透传；用户手动停止为 undefined） */
  signalReason?: unknown;
}): AbortCauseMapping {
  if (input.tokenBudgetFired) {
    return {
      protocolReason: "token_budget",
      opsReason: "token_budget",
      code: "RUN_TOKEN_BUDGET_EXCEEDED",
    };
  }
  if (input.watchdogFired) {
    return { protocolReason: "timeout", opsReason: "watchdog", code: "WATCHDOG_TIMEOUT" };
  }
  if (input.signalReason === "new_task") {
    return { protocolReason: "preempt", opsReason: "new_task", code: "TURN_PREEMPTED" };
  }
  if (input.signalReason === "lease_lost") {
    // 跨副本租约丢失：本副本主动停机防双主（协议 reason 取 user 口径，ops 侧可区分）
    return { protocolReason: "user", opsReason: "lease_lost", code: "TURN_LEASE_LOST" };
  }
  return { protocolReason: "user", opsReason: "user", code: "TURN_ABORTED" };
}

export type HarnessOpsEvent =
  | {
      type: "turn_start";
      at: number;
      sessionId: string;
      turnId: string;
      /** 生效模型名（脱敏用途之外的运维画像字段） */
      model?: string;
      permission?: string;
    }
  | {
      type: "turn_finish";
      at: number;
      sessionId: string;
      turnId: string;
      status: "done" | "error";
      stepCount: number;
      durationMs: number;
      /** 计费口径累计（跨步总和） */
      totalTokens?: number;
      /** 非正常收尾时的分类码 */
      code?: HarnessOpsCode;
      message?: string;
      /** 轮次收尾形态：explicit（finish_task 显式宣告）/ natural（自然停机）/ truncated（步数耗尽）；中止时缺省 */
      finishReason?: "explicit" | "natural" | "truncated";
    }
  | {
      type: "step_finish";
      at: number;
      sessionId: string;
      turnId: string;
      /** 第 N 个生成步（1 起） */
      step: number;
      durationMs?: number;
    }
  | {
      type: "tool_result";
      at: number;
      sessionId: string;
      turnId: string;
      tool: string;
      ok: boolean;
      durationMs: number;
      /** 失败时的分类码（TOOL_EXECUTION_FAILED） */
      code?: HarnessOpsCode;
      error?: string;
    }
  | {
      type: "model_retry";
      at: number;
      sessionId?: string;
      turnId?: string;
      /** 第 N 次重试（1 起） */
      attempt: number;
      errorClass: ProviderErrorClass;
      delayMs: number;
      reason: string;
    }
  | {
      type: "model_fallback";
      at: number;
      sessionId?: string;
      turnId?: string;
      /** 触发降级的档案名 */
      from: string;
      /** 切换到的档案名 */
      to: string;
      errorClass: ProviderErrorClass;
      reason: string;
    }
  | {
      type: "abort";
      at: number;
      sessionId: string;
      turnId: string;
      /** 中止成因：user=手动停止 / new_task=顶替 / watchdog=看门狗超时 / token_budget=单轮预算熔断 / lease_lost=跨副本租约丢失 */
      reason: "user" | "new_task" | "watchdog" | "token_budget" | "lease_lost";
      code: HarnessOpsCode;
    }
  | {
      type: "warn";
      at: number;
      code: HarnessOpsCode;
      detail?: string;
      sessionId?: string;
      turnId?: string;
    }
  | {
      type: "error";
      at: number;
      code: HarnessOpsCode;
      detail?: string;
      sessionId?: string;
      turnId?: string;
    }
  | {
      /** TASK-101：信息面事件（TURN_RESUMED 实验归因等）——不告警、可 grep、进 NDJSON 流 */
      type: "info";
      at: number;
      code: HarnessOpsCode;
      detail?: string;
      sessionId?: string;
      turnId?: string;
    };

export interface HarnessEventSink {
  emit(event: HarnessOpsEvent): void;
}

/* ---------------------------------- LOG_LEVEL 门控（TASK-096） --------------------------------- */

/** 日志级别（LOG_LEVEL 环境变量取值；console sink 门控与请求日志共用同一口径） */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * 解析 LOG_LEVEL 原始值：未设 / 空白 / 非法值一律回落 info（fail-safe——
 * 管理员的拼写错误只会恢复默认可见度，绝不会静默吞掉 error 级事件）。
 */
export function resolveLogLevel(raw: string | undefined | null): LogLevel {
  switch (typeof raw === "string" ? raw.trim().toLowerCase() : "") {
    case "debug":
      return "debug";
    case "warn":
      return "warn";
    case "error":
      return "error";
    default:
      return "info";
  }
}

/**
 * 运维事件 → 日志级别映射（TASK-096）：
 * - error：`error` 事件、`abort`（中止即异常收尾）、`turn_finish` status=error；
 * - warn：`warn` 事件、模型重试/降级（韧性层动作是故障信号）、失败工具结果、
 *   带 code 但正常收尾的 `turn_finish`（如中止后的 done+TURN_ABORTED）；
 * - info：其余生命周期事件（turn_start / step_finish / 正常 turn_finish / 成功工具结果）。
 */
export function levelForEvent(event: HarnessOpsEvent): LogLevel {
  switch (event.type) {
    case "error":
    case "abort":
      return "error";
    case "warn":
    case "model_retry":
    case "model_fallback":
      return "warn";
    case "turn_finish":
      return event.status === "error" ? "error" : event.code ? "warn" : "info";
    case "tool_result":
      return event.ok ? "info" : "warn";
    default:
      return "info";
  }
}

/**
 * 级别门控：事件/日志级别 ≥ 配置级别才输出。缺省（未设 LOG_LEVEL）= info，
 * 即 info 及以上可见、debug 静默——与历史行为一致（当前没有任何 debug 级事件）。
 * 每次调用即时读取 LOG_LEVEL（而非构造时快照）：server.ts 的请求日志可直接复用
 * `shouldLog("info")`；测试可经 vi.stubEnv 动态替换，运维改环境变量后无需重建 sink。
 */
export function shouldLog(
  level: LogLevel,
  raw: string | undefined = process.env.LOG_LEVEL
): boolean {
  return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[resolveLogLevel(raw)];
}

/** 缺省 sink：单行 JSON。error 级走 stderr，其余 stdout——保留可 grep 性，行可被采集器摄取。 */
export function createConsoleNdjsonSink(): HarnessEventSink {
  return {
    emit(event) {
      const level = levelForEvent(event);
      if (!shouldLog(level)) return; // LOG_LEVEL 门控；缺省 info 不改变既有输出可见度
      const line = JSON.stringify(event);
      if (level === "error") {
        console.error(line);
      } else {
        console.log(line);
      }
    },
  };
}

/** 组合 sink：同一事件广播到多个下游；单个下游故障不影响其余与主链路 */
export function compositeSink(...sinks: HarnessEventSink[]): HarnessEventSink {
  return {
    emit(event) {
      for (const s of sinks) {
        try {
          s.emit(event);
        } catch {
          // 单个下游故障不拖垮其余
        }
      }
    },
  };
}

/** 无操作 sink（缺省兜底，测试与未注入场景） */
export function createNoopSink(): HarnessEventSink {
  return { emit() {} };
}
