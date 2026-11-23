/**
 * @vuagent/protocol
 * Harness 标准事件流 (HarnessStreamEvent) —— 全链路单一事实来源
 * server (SSE 推送) 与 Web 前端 (流式消费) 共用此契约。
 * 旧 UIStreamEvent (events.ts) 仍为 @vuagent/ui runtime 兼容保留，新增消费请使用本契约。
 *
 * TASK-053：事件类型改为由 stream-schema.ts 的 TypeBox Schema Static<> 推导
 * （schema = 唯一事实来源），本文件保留事件域的守卫函数与载荷形状。
 */

import type { HarnessStreamEvent } from "./stream-schema.js";
import type { VuagentToolName } from "./tools.js";

// 类型从 schema 模块透出（同一声明，index 双路径导出无歧义）
export type {
  HarnessStreamEvent,
  HarnessStreamEventType,
  UsageContextPart,
  StreamEventValidationError,
} from "./stream-schema.js";
export {
  HarnessStreamEventSchemas,
  HarnessStreamEventSchema,
  validateHarnessStreamEvent,
  getHarnessStreamEventErrors,
} from "./stream-schema.js";

/**
 * UI 工具（protocol-tools.ts）执行结果的统一载荷：
 * 模型调用 ui_* 工具后，server 通过 tool_call_result.data 传出，
 * 前端据 component 名分发到对应 Va* 卡片渲染。
 * TASK-055：component 收口为 VuagentToolName 联合类型（ui 子集，
 * 系统工具名不在此列——它们不产 UI 卡片）。
 */
export interface UiComponentRenderResult {
  rendered?: boolean;
  component?: VuagentToolName | (string & {});
  props?: Record<string, unknown>;
}

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
