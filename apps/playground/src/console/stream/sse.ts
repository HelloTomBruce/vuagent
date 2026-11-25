/**
 * SSE 文本流块解析（TASK-114 双轨归一）：实现收口至 @vuagent/ui runtime/sse，
 * 本文件保留 extractSSEEvents 旧名导出（reducer/console 调用方与既有 spec 零改动）。
 */
export { parseSSEChunk as extractSSEEvents } from "@vuagent/ui";
export type { SSEParseResult } from "@vuagent/ui";
