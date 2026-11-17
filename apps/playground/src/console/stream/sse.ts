/**
 * SSE 文本流解析器（纯函数，可单测）
 * 输入增量 chunk + 上一次残余 buffer，输出本次完整取出的 data 载荷与新的残余 buffer。
 * 相比旧实现（Console.vue split("\n\n")）增强：
 * 1. 兼容 \r\n / \r 换行
 * 2. 按 SSE 规范合并同一事件块内的多行 data 字段
 */
export interface SSEParseResult {
  /** 本次完整取出的 data 载荷（JSON 字符串或 "[DONE]"） */
  payloads: string[];
  /** 未凑齐事件的残余 buffer，需带回下一次调用 */
  buffer: string;
}

export function extractSSEEvents(chunk: string, buffer: string): SSEParseResult {
  const normalized = (buffer + chunk).replace(/\r\n|\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";

  const payloads: string[] = [];
  for (const block of parts) {
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.replace(/^data:\s*/, ""));
      }
    }
    if (dataLines.length === 0) continue;
    payloads.push(dataLines.join("\n"));
  }

  return { payloads, buffer: rest };
}
