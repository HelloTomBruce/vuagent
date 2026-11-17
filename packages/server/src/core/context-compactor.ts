export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface CompactorOptions {
  maxContextTokens?: number; // 默认 16k
  maxToolResultChars?: number; // 单条工具执行结果超过此长度时截断
  preserveRecentTurns?: number; // 保留最近完整轮次
}

/**
 * 上下文压缩与滑动窗口调度器 (ContextCompactor)
 * 动态修剪历史超长工具输出与老化上下文，防止超出大模型上下文硬限制
 */
export class ContextCompactor {
  private maxTokens: number;
  private maxToolChars: number;
  private preserveRecent: number;

  constructor(options: CompactorOptions = {}) {
    this.maxTokens = options.maxContextTokens ?? 16_000;
    this.maxToolChars = options.maxToolResultChars ?? 2_000;
    this.preserveRecent = options.preserveRecentTurns ?? 4;
  }

  /**
   * 粗略预估消息的 Token 数量 (英文约 4 字符 1 Token，中文字符约 1-2 Token)
   */
  estimateTokens(messages: ChatMessage[]): number {
    let chars = 0;
    for (const msg of messages) {
      if (msg.content) chars += msg.content.length;
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          chars += tc.function.name.length + tc.function.arguments.length;
        }
      }
    }
    return Math.ceil(chars / 3.2);
  }

  /**
   * 执行上下文修剪与压缩
   */
  compact(messages: ChatMessage[]): ChatMessage[] {
    if (messages.length <= 2) return messages;

    const result: ChatMessage[] = [];
    const totalCount = messages.length;

    for (let i = 0; i < totalCount; i++) {
      const msg = messages[i];
      const isSystem = msg.role === "system";
      const isRecent = i >= totalCount - this.preserveRecent * 2;

      // 系统提示词或最近几轮消息：完全保留
      if (isSystem || isRecent) {
        result.push(msg);
        continue;
      }

      // 对早期较旧的历史消息进行精简：超大 tool 结果截断
      if (msg.role === "tool" && msg.content && msg.content.length > this.maxToolChars) {
        const head = msg.content.slice(0, 800);
        const tail = msg.content.slice(-400);
        result.push({
          ...msg,
          content: `${head}\n\n... [Harness 自动截断超长历史输出 (原长度 ${msg.content.length} 字符)] ...\n\n${tail}`,
        });
      } else {
        result.push(msg);
      }
    }

    // 若依然超出最大 Token 限制，丢弃中间较早轮次的非系统消息
    while (this.estimateTokens(result) > this.maxTokens && result.length > 3) {
      // 找到第一个非系统提示词的早期消息移除
      const pruneIndex = result.findIndex((m) => m.role !== "system");
      if (pruneIndex >= 0 && pruneIndex < result.length - 2) {
        result.splice(pruneIndex, 1);
      } else {
        break;
      }
    }

    return result;
  }
}
