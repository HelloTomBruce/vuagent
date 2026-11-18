/**
 * @vuagent/protocol
 * Harness 标准事件流 (HarnessStreamEvent) —— 全链路单一事实来源
 * server (SSE 推送) 与 Web 前端 (流式消费) 共用此契约。
 * 旧 UIStreamEvent (events.ts) 仍为 @vuagent/ui runtime 兼容保留，新增消费请使用本契约。
 */

/**
 * UI 工具（protocol-tools.ts）执行结果的统一载荷：
 * 模型调用 ui_* 工具后，server 通过 tool_call_result.data 传出，
 * 前端据 component 名分发到对应 Va* 卡片渲染
 */
export interface UiComponentRenderResult {
  rendered?: boolean;
  /** VuagentToolName：ui_approval_card / ui_code_diff / ui_metric_chart / ui_agent_plan / ui_file_tree / ui_trajectory */
  component?: string;
  props?: Record<string, unknown>;
}

/**
 * usage 事件的上下文分段估算（复用 ui 库 ContextPart 形状：id/label/tokens/kind）。
 * kind 限定为服务端 ContextCompactor.estimateParts 可产出的三段；
 * 对 @vuagent/ui 的 ContextPart（kind 含 file）结构兼容，前端可直接消费。
 */
export interface UsageContextPart {
  id: string;
  /** 悬停 tooltip 的分段名称，如 "系统提示" */
  label: string;
  tokens: number;
  kind: "system" | "history" | "tools";
}

export type HarnessStreamEvent =
  | {
      type: "thought_delta";
      messageId?: string;
      delta: string;
    }
  | {
      type: "text_delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "ui_agent_plan";
      title: string;
      steps: Array<{
        id: string;
        title: string;
        status: "pending" | "running" | "done" | "error";
        duration?: number;
        startedAt?: number;
      }>;
    }
  | {
      type: "ui_code_diff";
      file: string;
      oldCode: string;
      newCode: string;
      additions?: number;
      deletions?: number;
    }
  | {
      type: "ui_terminal_log";
      title?: string;
      lines: Array<{
        text: string;
        kind?: "cmd" | "stdout" | "stderr" | "ok" | "warn";
      }>;
    }
  | {
      type: "ui_metric_chart";
      title?: string;
      points: Array<{
        time: string;
        value: number;
      }>;
    }
  | {
      type: "tool_call_start";
      messageId: string;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_call_args_delta";
      toolCallId: string;
      partialArgs: Record<string, unknown>;
    }
  | {
      type: "tool_call_executing";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_call_result";
      toolCallId: string;
      toolName: string;
      status: "done" | "error";
      data?: unknown;
      error?: string;
    }
  | {
      type: "usage";
      /** 本步发送的全部上下文（含重发历史）——窗口占用口径，非跨步累加的计费口径 */
      promptTokens: number;
      /** 本步模型输出 token */
      completionTokens: number;
      /** promptTokens + completionTokens（本步完成后的上下文占用） */
      totalTokens: number;
      /** 生效模型配置声明的上下文窗口（若有） */
      contextWindow?: number;
      /** 协议级分段估算（system/history/tools），前端仪表据此渲染分段格子；旧版本服务端可缺省 */
      parts?: UsageContextPart[];
    }
  | {
      type: "suspended";
      actionId: string;
      toolName: string;
      args: Record<string, unknown>;
      timeoutMs: number;
    }
  | {
      type: "traj";
      /** 单条轨迹事件（对齐 dsh 三泳道台账），实时追加到当前 assistant turn */
      event: {
        id: string;
        at: number;
        endAt?: number;
        lane: "input" | "model" | "tool";
        role: "user" | "assistant" | "tool" | "system" | "context";
        title: string;
        detail?: string;
        result?: string;
        turn: number;
        durationMs?: number;
      };
    }
  | {
      type: "resumed";
      actionId: string;
      payload: unknown;
    }
  | {
      type: "turn_end";
      stepCount: number;
      durationMs: number;
    }
  | {
      type: "error";
      message: string;
      code?: string;
    };

/** 常见事件类型守卫 */
export function isUsageEvent(
  event: HarnessStreamEvent
): event is Extract<HarnessStreamEvent, { type: "usage" }> {
  return event.type === "usage";
}

export function isToolCallEvent(
  event: HarnessStreamEvent
): event is Extract<
  HarnessStreamEvent,
  {
    type:
      | "tool_call_start"
      | "tool_call_args_delta"
      | "tool_call_executing"
      | "tool_call_result";
  }
> {
  return (
    event.type === "tool_call_start" ||
    event.type === "tool_call_args_delta" ||
    event.type === "tool_call_executing" ||
    event.type === "tool_call_result"
  );
}
