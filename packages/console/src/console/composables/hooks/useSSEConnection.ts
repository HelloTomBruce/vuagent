/**
 * SSE 连接消费器（TASK-114 双轨归一）：实现收口至 @vuagent/ui runtime/sse
 * （库 useAgentChat 与宿主流式数据域同一实现），本文件仅保留宿主侧导入面。
 * 语义：fetch Response → 事件流（reader / 半包 / [DONE] / AbortError 分类）。
 */
export { consumeSSEStream } from "@vuagent/ui";
export type { SSEConsumeOptions, SSEConsumeResult } from "@vuagent/ui";
