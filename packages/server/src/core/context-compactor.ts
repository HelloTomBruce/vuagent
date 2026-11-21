import { encode } from "gpt-tokenizer";

/**
 * 多模态内容块（能力运行时 P2 视觉通道）。内部规范形态取 OpenAI 风格
 * （与 ChatMessage 其余字段的 OpenAI 语义一致），Anthropic 原生驱动负责转换。
 * 纯文本消息保持 content: string 不变——parts 只在携带图片时出现。
 */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * 单张图片的上下文预算估值（token）。视觉 token 依分辨率与端点实现差异极大，
 * 取常见端点中等分辨率图的保守中位；真实用量以 usage 事件的 promptTokens 为准
 * （该值来自端点，含真实图片 token），估值只用于压缩触发与仪表分段。
 */
export const IMAGE_TOKEN_ESTIMATE = 1024;

/**
 * 消息正文的纯文本视图：string 原样返回；parts 消息取 text 块拼接、
 * 图片块降级为 `[图片]` 占位（压缩折叠后的文本形态，原始 parts 仍留在检查点）。
 * 仅用于「是否为空」与摘要标记探测等文本判断，不用于请求构造。
 */
export function contentAsText(msg: { content?: string | ChatContentPart[] }): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part) => (part.type === "text" ? part.text : "[图片]"))
      .join("\n");
  }
  return "";
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** 纯文本，或多模态内容块数组（仅携带图片的 user 消息会出现数组形态） */
  content?: string | ChatContentPart[];
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

/** 上下文仪表分段类型：系统提示词 / 对话历史 / 工具结果（与 @vuagent/ui ContextPart.kind 子集同形） */
export type ContextPartKind = "system" | "history" | "tools";

/** usage 事件下发的分段估算结构（复用 ui 库 ContextPart 形状：id/label/tokens/kind） */
export interface ContextPartEstimate {
  id: string;
  /** 悬停 tooltip 的分段名称，如 "系统提示" */
  label: string;
  tokens: number;
  kind: ContextPartKind;
}

/** 手动压缩摘要占位消息的固定起始标记，二次压缩时据此识别旧摘要块 */
export const COMPACT_SUMMARY_MARKER = "[上下文压缩摘要]";

export interface ManualCompactOptions {
  /**
   * 摘要化折叠后完整保留的最近历史 token 量（行业口径 keep.tokens，缺省 15000）。
   * 按 token 而非轮次保留：轮次的 token 差异可达两个数量级，按轮数保留不可控。
   */
  keepTokens?: number;
  /** 此前已累计折叠的轮次数（二次压缩时衔接累计口径） */
  previousCompactedTurns?: number;
}

export interface ManualCompactResult {
  /** 压缩后的消息序列（已 sanitize，tool_calls↔tool 配对合法） */
  messages: ChatMessage[];
  /** 注入的摘要占位文本 */
  summary: string;
  /** 本次实际新折叠的轮次数（不含此前累计；0 表示历史不足无需折叠） */
  foldedTurnCount: number;
  /** 累计折叠轮次数（写入 session.compaction.compactedTurnCount） */
  totalCompactedTurns: number;
}

export interface CompactorOptions {
  maxContextTokens?: number; // 默认 16k
  maxToolResultChars?: number; // 单条工具执行结果超过此长度时截断
  /** 手动压缩保留窗口（keep.tokens 口径），缺省 15000 */
  keepTokens?: number;
  /** 自动裁剪尾部保留轮次数，缺省 4 */
  preserveRecentTurns?: number;
  /**
   * 消息保护钩子：返回 true 的消息在自动压缩（compact）中获得双重豁免——
   * 1. 滑动窗口轮次块裁剪不会删除其所在的轮次块（内容与位置原样保留）；
   * 2. 单条工具结果截断（maxToolResultChars）跳过该消息，正文逐字保留。
   * index 为消息在入参数组中的下标，total 为入参消息总条数。
   * 未传时行为与旧版完全一致。仅作用于自动 compact 路径；
   * manualCompact（显式摘要压缩）语义独立，不消费该钩子。
   */
  isProtectedMessage?: (msg: ChatMessage, index: number, total: number) => boolean;
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
  private keepTokens: number;
  private preserveRecent: number;
  private isProtectedMessage?: (msg: ChatMessage, index: number, total: number) => boolean;

  constructor(options: CompactorOptions = {}) {
    this.maxTokens = options.maxContextTokens ?? 16_000;
    this.maxToolChars = options.maxToolResultChars ?? 2_000;
    this.keepTokens = options.keepTokens ?? 15_000;
    this.preserveRecent = options.preserveRecentTurns ?? 4;
    this.isProtectedMessage = options.isProtectedMessage;
  }

  /**
   * 运行时更新配置（TASK-025）：配置中心每轮生效，无需重建实例。
   * 仅更新显式传入的项；本实例为全局单例（agent-loop 与手动压缩路由共用），
   * 值来源同为全局配置，并发写等价（last-write-wins 收敛到同一全局值）。
   * isProtectedMessage 同样仅显式传入时更新（undefined 不覆盖，无法经 configure 置空）。
   */
  configure(options: CompactorOptions): void {
    if (options.maxContextTokens !== undefined) this.maxTokens = options.maxContextTokens;
    if (options.maxToolResultChars !== undefined) this.maxToolChars = options.maxToolResultChars;
    if (options.keepTokens !== undefined) this.keepTokens = options.keepTokens;
    if (options.preserveRecentTurns !== undefined) this.preserveRecent = options.preserveRecentTurns;
    if (options.isProtectedMessage !== undefined) this.isProtectedMessage = options.isProtectedMessage;
  }

  /**
   * 精确统计消息序列的 Token 数量（gpt-tokenizer / o200k_base BPE 分词）。
   * 计数范围与 OpenAI Chat Completions 计费口径对齐：每条消息含约 4 token 的
   * 消息级包裹开销（role 标记、定界符），tool_calls 的函数名与 JSON 参数逐字计数，
   * 序列整体含 2 token 的对话边界开销。
   */
  estimateTokens(messages: ChatMessage[]): number {
    let total = 2; // 对话首尾定界
    for (const msg of messages) {
      total += this.#messageTokens(msg);
    }
    return total;
  }

  /** 单条消息 token 计数：4 token 包裹开销 + 正文 + 工具调用声明；tool 响应 +1 定界 */
  #messageTokens(msg: ChatMessage): number {
    let n = 4;
    if (typeof msg.content === "string") {
      if (msg.content) n += encode(msg.content).length;
    } else if (Array.isArray(msg.content)) {
      // 多模态：文本块按实计量，图片块按固定估值（见 IMAGE_TOKEN_ESTIMATE 注释）
      for (const part of msg.content) {
        if (part.type === "text") n += encode(part.text).length;
        else n += IMAGE_TOKEN_ESTIMATE;
      }
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        n += encode(tc.function.name).length;
        n += encode(tc.function.arguments).length;
        n += 3; // 函数调用包裹开销
      }
    }
    if (msg.role === "tool") n += 1; // tool 响应定界
    return n;
  }

  /**
   * 按消息角色分段统计上下文占用，供前端 Context 仪表渲染分段格子。
   * 逐条消息计数后按段聚合（各段之和 = estimateTokens(messages) − 2 的对话边界开销）。
   * 分段规则：
   * - system：系统提示词（role:system 的 content）
   * - tools：工具结果（role:tool 的 content）
   * - history：user/assistant 正文（assistant.tool_calls 的调用声明也计入本段，
   *   工具结果本体在 role:tool 消息中，归 tools 段）
   * 返回时省略 tokens 为 0 的分段（如纯对话不产出 tools 段）。
   */
  estimateParts(messages: ChatMessage[]): ContextPartEstimate[] {
    const acc: Record<ContextPartKind, number> = { system: 0, history: 0, tools: 0 };
    for (const msg of messages) {
      const n = this.#messageTokens(msg);
      if (msg.role === "system") acc.system += n;
      else if (msg.role === "tool") acc.tools += n;
      else acc.history += n;
    }
    const parts: ContextPartEstimate[] = [
      { id: "system", label: "系统提示", tokens: acc.system, kind: "system" },
      { id: "history", label: "对话历史", tokens: acc.history, kind: "history" },
      { id: "tools", label: "工具结果", tokens: acc.tools, kind: "tools" },
    ];
    return parts.filter((p) => p.tokens > 0);
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
   * 消息克隆（纯投影基元）：浅拷贝消息体，tool_calls 数组连同调用项、函数体一并复制，
   * 保证产出消息与入参对象零共享引用（嵌套字段写入互不可见）。
   * compact / sanitize 的全部产出路径统一经此呈现，调用方修改返回消息不会写穿真实历史。
   */
  #cloneMessage(msg: ChatMessage): ChatMessage {
    const copy: ChatMessage = { ...msg };
    if (msg.tool_calls) {
      copy.tool_calls = msg.tool_calls.map((tc) => ({ ...tc, function: { ...tc.function } }));
    }
    return copy;
  }

  /**
   * 合法性兜底修复（纯投影）：
   * - 丢弃孤儿 tool 消息（其 tool_call_id 没有对应的 assistant.tool_calls 声明）
   * - 剥离没有响应的 tool_calls 声明；剥空且无正文的 assistant 消息整条移除
   * - 空 content 一律填占位符（user/assistant/tool 均不接受空字符串）
   * 返回全新数组：未变更的消息也以克隆呈现（重构前透传分支直接复用入参对象引用，
   * 返回值与入参共享消息对象，下游写返回消息会写穿真实历史——已消除）。
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
        const copy = this.#cloneMessage(m);
        copy.content = m.content || "[空工具结果]";
        result.push(copy);
        continue;
      }
      if (m.role === "assistant") {
        const copy = this.#cloneMessage(m);
        // 剥离无响应声明：过滤基于已克隆的数组，产出与入参零共享
        const calls = copy.tool_calls?.filter((tc) => answered.has(tc.id));
        const content = contentAsText(m);
        if (calls && calls.length > 0) {
          copy.tool_calls = calls;
          // parts 形态的 assistant 消息不存在（多模态只在 user 轮次），此处恒为 string
          copy.content = content || undefined;
          result.push(copy);
        } else if (content.trim()) {
          result.push({ role: "assistant", content });
        }
        // 无有效调用且无正文：整条丢弃
        continue;
      }
      // user / system：空内容占位（parts 消息恒非空——至少有图片块）
      if (!contentAsText(m).trim()) {
        const copy = this.#cloneMessage(m);
        copy.content = "(empty)";
        result.push(copy);
        continue;
      }
      result.push(this.#cloneMessage(m));
    }
    return result;
  }

  /**
   * 手动压缩（TASK-008 显式干预入口，与自动滑动窗口 compact 互补）。
   * 行业通用语义（对齐 OpenCode keep.tokens / Claude Code /compact）：
   * 1. 保留 system 提示词完整原文；
   * 2. 从尾部按 token 预算保留最近原始对话（keepTokens，默认 15k）——
   *    精确细节不丢，按 token 而非轮次（轮次间 token 差异可达两个数量级）；
   * 3. 其余早期历史折叠为一段摘要占位消息（role:user）；
   * 4. 保留区内超长工具结果截断（head+tail），工具输出是占用大头且可随时重取；
   * 5. 输出经 sanitize 兜底，保证 tool_calls↔tool 配对合法。
   *
   * 保留区边界只落在轮次块边界（user 消息起新块），绝不拆散 tool_calls↔tool 配对。
   * 二次压缩时旧摘要块作为普通历史块参与折叠，其要点行继承合并进新摘要。
   */
  manualCompact(messages: ChatMessage[], opts: ManualCompactOptions = {}): ManualCompactResult {
    const keepTokens = Math.max(1, opts.keepTokens ?? this.keepTokens);
    const previousCompacted = opts.previousCompactedTurns ?? 0;

    const systemMessages = messages.filter((m) => m.role === "system");

    // 轮次块划分（user 消息起新块；system 摘离）
    const blocks: ChatMessage[][] = [];
    let current: ChatMessage[] | null = null;
    for (const msg of messages) {
      if (msg.role === "system") continue;
      if (msg.role === "user" || !current) {
        current = [msg];
        blocks.push(current);
      } else {
        current.push(msg);
      }
    }

    const isSummaryBlock = (block: ChatMessage[] | undefined) =>
      Boolean(block?.length && contentAsText(block[0]).startsWith(COMPACT_SUMMARY_MARKER));

    // 2. 从尾部按 token 预算圈定保留区：整块纳入，块级累计超预算即停。
    //    最后一个块（当前对话尾部）无论如何保留，保证压缩后上下文非空。
    //    旧摘要块不占保留预算（它本来就是压缩产物，留在保留区只会白吃预算）。
    const blockTokens = blocks.map((b) => this.estimateTokens(b));
    let keepStart = blocks.length - 1;
    let keptTokens = 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const isLast = i === blocks.length - 1;
      const isOldSummary = isSummaryBlock(blocks[i]);
      if (!isLast && !isOldSummary && keptTokens > 0 && keptTokens + blockTokens[i] > keepTokens) break;
      keptTokens += isOldSummary ? 0 : blockTokens[i];
      keepStart = i;
      if (!isOldSummary && keptTokens >= keepTokens) break;
    }

    const folded = blocks.slice(0, keepStart);
    const kept = blocks.slice(keepStart);

    // 历史不足以折叠（无可折叠块，或只有旧摘要块）：原样透传（仅 sanitize）
    if (folded.length === 0 || (folded.length === 1 && isSummaryBlock(folded[0]))) {
      return {
        messages: this.sanitize(messages),
        summary: isSummaryBlock(blocks[0]) ? contentAsText(blocks[0][0]) : "",
        foldedTurnCount: 0,
        totalCompactedTurns: previousCompacted,
      };
    }

    // 3. 折叠区摘要：旧摘要块的要点行继承合并 + 新折叠块的要点行
    const carriedLines: string[] = [];
    if (isSummaryBlock(folded[0])) {
      carriedLines.push(...contentAsText(folded[0][0]).split("\n").slice(1));
    }

    const digestLines: string[] = [];
    let foldedMessageCount = 0;
    for (const block of folded) {
      if (isSummaryBlock(block)) continue;
      foldedMessageCount += block.length;
      const parts: string[] = [];
      for (const msg of block) {
        if (msg.role === "user" && msg.content) {
          parts.push(`用户:${ContextCompactor.#clipDigest(contentAsText(msg), 120)}`);
        } else if (msg.role === "assistant" && msg.content) {
          parts.push(`助手:${ContextCompactor.#clipDigest(contentAsText(msg), 120)}`);
        } else if (msg.role === "assistant" && msg.tool_calls?.length) {
          const names = Array.from(new Set(msg.tool_calls.map((tc) => tc.function.name))).join("、");
          parts.push(`调用工具 ${names}×${msg.tool_calls.length}`);
        }
      }
      if (parts.length > 0) {
        digestLines.push(`${digestLines.length + 1}. ${parts.join(" → ")}`);
      }
    }

    // 摘要行数封顶：超长会话的要点只保留最近若干条，防止摘要本身膨胀成新的占用大头
    let allLines = [...carriedLines, ...digestLines];
    const MAX_SUMMARY_LINES = 20;
    if (allLines.length > MAX_SUMMARY_LINES) {
      const dropped = allLines.length - MAX_SUMMARY_LINES;
      allLines = [`…(更早 ${dropped} 条要点从略)`, ...allLines.slice(-MAX_SUMMARY_LINES)];
    }

    // 新折叠的轮次数：首个折叠块是旧摘要占位（非真实轮次）时扣减 1
    const newFoldedTurns = folded.length - (isSummaryBlock(folded[0]) ? 1 : 0);
    const totalCompactedTurns = previousCompacted + newFoldedTurns;

    const summary = [
      `${COMPACT_SUMMARY_MARKER} 更早的对话已折叠为要点概述（累计 ${totalCompactedTurns} 轮 / 最近折叠 ${foldedMessageCount} 条消息），近期对话完整保留在下方：`,
      ...(allLines.length > 0 ? allLines : ["（该段历史无可提取的正文要点）"]),
    ].join("\n");

    // 4. 保留区截断：除最后一块（当前对话尾部）外，超长工具结果按 head+tail 截断
    const keptMessages: ChatMessage[] = [];
    kept.forEach((block, blockIndex) => {
      const isLastBlock = blockIndex === kept.length - 1;
      for (const msg of block) {
        if (!isLastBlock && msg.role === "tool" && (msg.content?.length ?? 0) > this.maxToolChars) {
          keptMessages.push({
            ...msg,
            content: `${String(msg.content ?? "").slice(0, 800)}\n\n... [压缩截断超长工具输出 (原长度 ${msg.content!.length} 字符)] ...\n\n${String(msg.content ?? "").slice(-400)}`,
          });
        } else {
          keptMessages.push(msg);
        }
      }
    });

    const compacted: ChatMessage[] = [
      ...systemMessages,
      { role: "user", content: summary },
      ...keptMessages,
    ];

    return {
      messages: this.sanitize(compacted),
      summary,
      foldedTurnCount: newFoldedTurns,
      totalCompactedTurns,
    };
  }

  /** 摘要行裁剪：压平空白并截断超长正文 */
  static #clipDigest(s: string, max: number): string {
    const text = s.replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  /**
   * 执行上下文修剪与压缩（纯投影）。
   *
   * 不可变性契约（本次重构锁定）：
   * - 绝不修改入参数组与任何入参消息对象；
   * - 返回全新数组，且数组内每条消息都是新对象（浅拷贝 + tool_calls 逐项复制），
   *   输出与入参零共享引用——调用方（agent-loop 每步把结果当临时上下文）即便修改
   *   返回消息，也不会写穿到真实会话历史。
   *
   * 重构前的入参改动/写穿风险路径（已消除，留档说明）：
   * 1. 滑动窗口裁剪：`result.splice` 虽作用于本地投影数组（未字面写改入参数组），
   *    但投影数组对"系统提示 / 保留窗 / 未变更消息"直接 `result.push(msg)` 复用入参对象引用；
   * 2. sanitize 透传分支同样 `result.push(m)` 复用入参引用，assistant 分支的
   *    tool_calls 数组元素也与入参共享；
   * 3. 即：返回值与入参共享消息对象，任何下游对临时上下文的字段写入都会污染真实历史。
   *    现统一改为逐条克隆（#cloneMessage）呈现。
   *
   * 保护钩子（isProtectedMessage）：
   * - 早期超长工具结果截断（maxToolResultChars）：受保护消息跳过截断，正文逐字保留；
   * - 滑动窗口轮次块裁剪：受保护消息所在块不可删除——自最老块裁剪、遇保护块即截停
   *   （保护语义优先于窗口预算，绝不为了继续裁剪而删除保护块之后的新块）；
   * - 未传钩子时行为与旧版完全一致。
   *
   * @param opts.maxTokens 覆盖默认裁剪阈值——调用方应传模型真实窗口的约 85%，
   *   避免过早裁剪造成"上下文占用每轮跳水"（默认 16k 仅适用于未知窗口的兜底）。
   */
  compact(messages: ChatMessage[], opts?: { maxTokens?: number }): ChatMessage[] {
    if (messages.length <= 2) return this.sanitize(messages);

    const maxTokens = opts?.maxTokens ?? this.maxTokens;
    const totalCount = messages.length;

    // 保护钩子对入参一次性判定（截断与裁剪共用同一份结果：语义一致且避免重复回调）
    const guard = this.isProtectedMessage;
    const protectedFlags = guard ? messages.map((m, i) => guard(m, i, totalCount)) : null;

    // 第一段投影：逐条克隆入列（与入参零共享引用）。
    // 早期（保留窗外）超长工具结果在此截断（head+tail）；
    // 系统提示 / 保留窗 / 受保护消息豁免截断。
    const result: ChatMessage[] = [];
    // 与 result 平行的保护标记（裁剪阶段据此跳过受保护块；splice 与 result 严格同步）
    const protectedOut: boolean[] = [];

    for (let i = 0; i < totalCount; i++) {
      const msg = messages[i];
      const isProtected = protectedFlags?.[i] ?? false;
      const isSystem = msg.role === "system";
      const isRecent = i >= totalCount - this.preserveRecent * 2;
      const needsClip =
        !isSystem && !isRecent && !isProtected &&
        msg.role === "tool" && !!msg.content && msg.content.length > this.maxToolChars;

      if (needsClip) {
        const head = String(msg.content ?? "").slice(0, 800);
        const tail = String(msg.content ?? "").slice(-400);
        result.push({
          ...this.#cloneMessage(msg),
          content: `${head}\n\n... [Harness 自动截断超长历史输出 (原长度 ${msg.content!.length} 字符)] ...\n\n${tail}`,
        });
      } else {
        result.push(this.#cloneMessage(msg));
      }
      protectedOut.push(isProtected);
    }

    // 若依然超出最大 Token 限制，按"轮次块"从最老块开始整块删除。
    // 块 = 一条 user 消息起到下一条 user 之前（含其间 assistant/tool_calls/tool），
    // 绝不逐条删除——那会拆散 tool_calls ↔ tool 配对，触发供应商 400（如 GLM 1214）。
    // 受保护消息所在块不可删除：保护块截停裁剪，其后的新块照常保留。
    while (this.estimateTokens(result) > maxTokens && result.length > 3) {
      const start = result.findIndex((m) => m.role !== "system");
      if (start < 0) break;
      let end = start + 1;
      while (end < result.length && result[end].role !== "user") end++;
      if (end >= result.length) {
        // 只剩最后一个块：删除会清空对话上下文，放弃裁剪
        break;
      }
      if (protectedOut.slice(start, end).some(Boolean)) break;
      result.splice(start, end - start);
      protectedOut.splice(start, end - start);
    }

    return this.sanitize(result);
  }
}
