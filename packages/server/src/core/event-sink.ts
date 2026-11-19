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
  | "MODEL_UNKNOWN"
  // 工具面
  | "TOOL_EXECUTION_FAILED"
  // 轮次生命周期
  | "WATCHDOG_TIMEOUT"
  | "TURN_ABORTED"
  | "TURN_PREEMPTED"
  | "PREEMPT_TIMEOUT"
  | "TURN_EXECUTION_FAILED"
  | "TURN_PERSIST_FAILED"
  // 准入与恢复
  | "SESSION_RUNNING_REJECTED"
  | "CONCURRENCY_REJECTED"
  | "QUOTA_EXCEEDED"
  | "COST_RECORD_FAILED"
  | "RECOVERED_TURNS";

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
      type: "abort";
      at: number;
      sessionId: string;
      turnId: string;
      /** 中止成因：user=手动停止 / new_task=顶替 / watchdog=看门狗超时 */
      reason: "user" | "new_task" | "watchdog";
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
    };

export interface HarnessEventSink {
  emit(event: HarnessOpsEvent): void;
}

/** 缺省 sink：单行 JSON。error 级走 stderr，其余 stdout——保留可 grep 性，行可被采集器摄取。 */
export function createConsoleNdjsonSink(): HarnessEventSink {
  return {
    emit(event) {
      const line = JSON.stringify(event);
      if (event.type === "error") {
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
