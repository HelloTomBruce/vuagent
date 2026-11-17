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
 * 动态修剪历史超长工具输出与老化上下文，防止超出大模型上下文硬限制。
 *
 * 合法性约束（部分供应商如 GLM 对此严格校验，违例报 400/1214 "messages 参数非法"）：
 * 1. assistant.tool_calls 与 tool 响应必须一一配对，不允许孤儿或缺失；
 * 2. user/assistant/tool 的 content 不得为空字符串。
 * 因此 compact 输出前统一经过 sanitize 兜底修复。
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
   * 粗略预估消息的 Token 数量。
   * ASCII 约 4 字符 1 Token；CJK 等非 ASCII 约 1.5 字符 1 Token（混合文本加权求和）。
   */
  estimateTokens(messages: ChatMessage[]): number {
    let asciiChars = 0;
    let cjkChars = 0;
    const countChars = (s: string) => {
      for (const ch of s) {
        if (ch.charCodeAt(0) > 0x7f) cjkChars++;
        else asciiChars++;
      }
    };
    for (const msg of messages) {
      if (msg.content) countChars(msg.content);
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          countChars(tc.function.name + tc.function.arguments);
        }
      }
    }
    return Math.ceil(asciiChars / 4 + cjkChars / 1.5);
  }

  /**
   * 补齐"半截工具调用"：执行中止/步数耗尽时，最后一条 assistant.tool_calls
   * 可能缺少部分 tool 响应，原地补占位结果，保证历史对模型 API 始终合法。
   * （原地修改，供 agent-loop 在保存 checkpoint 前调用）
   */
  patchUnansweredToolCalls(messages: ChatMessage[]): void {
    // 找最后一条带 tool_calls 的 assistant
    let anchor = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        anchor = i;
        break;
      }
    }
    if (anchor < 0) return;

    const answered = new Set<string>();
    for (let i = anchor + 1; i < messages.length; i++) {
      const m = messages[i];
      if (m.role === "tool" && m.tool_call_id) answered.add(m.tool_call_id);
    }
    for (const call of messages[anchor].tool_calls!) {
      if (!answered.has(call.id)) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: "[执行中止] 未获取到该工具的执行结果",
        });
      }
    }
  }

  /**
   * 合法性兜底修复：
   * - 丢弃孤儿 tool 消息（其 tool_call_id 没有对应的 assistant.tool_calls 声明）
   * - 剥离没有响应的 tool_calls 声明；剥空且无正文的 assistant 消息整条移除
   * - 空 content 一律填占位符（user/assistant/tool 均不接受空字符串）
   */
  sanitize(messages: ChatMessage[]): ChatMessage[] {
    const declared = new Set<string>();
    for (const m of messages) {
      if (m.role === "assistant" && m.tool_calls) {
        for (const tc of m.tool_calls) declared.add(tc.id);
      }
    }
    const answered = new Set<string>();
    for (const m of messages) {
      if (m.role === "tool" && m.tool_call_id && declared.has(m.tool_call_id)) {
        answered.add(m.tool_call_id);
      }
    }

    const result: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role === "tool") {
        // 孤儿响应：直接丢弃
        if (!m.tool_call_id || !declared.has(m.tool_call_id)) continue;
        result.push({ ...m, content: m.content || "[空工具结果]" });
        continue;
      }
      if (m.role === "assistant") {
        const calls = m.tool_calls?.filter((tc) => answered.has(tc.id));
        const content = m.content || "";
        if (calls && calls.length > 0) {
          result.push({ ...m, tool_calls: calls, content: content || undefined });
        } else if (content.trim()) {
          result.push({ role: "assistant", content });
        }
        // 无有效调用且无正文：整条丢弃
        continue;
      }
      // user / system：空内容占位
      if (!(m.content || "").trim()) {
        result.push({ ...m, content: m.content || "(empty)" });
        continue;
      }
      result.push(m);
    }
    return result;
  }

  /**
   * 执行上下文修剪与压缩。
   * @param opts.maxTokens 覆盖默认裁剪阈值——调用方应传模型真实窗口的约 85%，
   *   避免过早裁剪造成"上下文占用每轮跳水"（默认 16k 仅适用于未知窗口的兜底）。
   */
  compact(messages: ChatMessage[], opts?: { maxTokens?: number }): ChatMessage[] {
    if (messages.length <= 2) return this.sanitize(messages);

    const maxTokens = opts?.maxTokens ?? this.maxTokens;
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

    // 若依然超出最大 Token 限制，按"轮次块"从最老块开始整块删除。
    // 块 = 一条 user 消息起到下一条 user 之前（含其间 assistant/tool_calls/tool），
    // 绝不逐条删除——那会拆散 tool_calls ↔ tool 配对，触发供应商 400（如 GLM 1214）。
    while (this.estimateTokens(result) > maxTokens && result.length > 3) {
      const start = result.findIndex((m) => m.role !== "system");
      if (start < 0) break;
      let end = start + 1;
      while (end < result.length && result[end].role !== "user") end++;
      if (end >= result.length) {
        // 只剩最后一个块：删除会清空对话上下文，放弃裁剪
        break;
      }
      result.splice(start, end - start);
    }

    return this.sanitize(result);
  }
}
