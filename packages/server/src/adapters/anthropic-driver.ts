import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "./model-driver.js";
import { attributionHeadersForRequest, resolveEndpointHeaders } from "../core/endpoint-headers.js";
import type { ChatMessage } from "../core/context-compactor.js";
import { childTraceparent } from "../core/trace-context.js";
import {
  ClassifiedModelError,
  classifyHttpError,
  classifyModelError,
  createResilientFetch,
  formatModelErrorDetail,
  resolveResiliencePolicy,
} from "./resilience.js";

/** driver 级韧性选项：缺省启用默认策略；`resilience: false` 整体关闭（测试直连用） */
export interface AnthropicDriverOptions {
  /** fetch 注入点（测试 mock SSE 流用）；缺省全局 fetch */
  fetchImpl?: typeof fetch;
  /** 是否启用韧性层（指数退避重试 + Retry-After 尊重 + 响应头前超时），缺省 true */
  resilience?: boolean;
  /** Messages API 必填的 max_tokens 输出上限，缺省 8192；req.parameters.max_tokens 可按次覆盖 */
  maxTokens?: number;
  /**
   * TASK-099 prompt caching 模式：
   * - "auto"（缺省）：请求装配时在 system 尾元素 + 倒数第 1/2 条消息的末位内容块
   *   设 cache_control 断点（总数 ≤ ANTHROPIC_CACHE_BREAKPOINT_LIMIT，Anthropic 约束）；
   * - "off"：不注入断点，请求形态与旧版逐字节一致；
   * - 函数形式：每次请求装配时同步求值（运行中改档即时生效——async 配置源
   *   应在构造驱动前先 resolve 出值再传入）。
   */
  promptCaching?: PromptCachingMode | (() => PromptCachingMode);
}

/** TASK-099：Anthropic prompt caching 模式（config 中心 execution.promptCaching 同名同值域） */
export type PromptCachingMode = "auto" | "off";

/** Anthropic cache_control 断点类型（ephemeral 是当前唯一支持的缓存类型） */
export interface AnthropicCacheControl {
  type: "ephemeral";
}

/**
 * Anthropic 单请求 cache_control 断点上限（官方约束：≤4）。
 * 本实现的 auto 策略固定产 1（system 尾）+ 2（消息倒数窗口）= 3 个，恒在上限内；
 * 常量同时是 applyPromptCaching 的硬闸（策略演进时防越界）。
 */
export const ANTHROPIC_CACHE_BREAKPOINT_LIMIT = 4;

/** 带 cache_control 标记的内容块（断点挂内容块级；消息边界取末位块） */
type CacheableContentBlock = AnthropicContentBlock & { cache_control?: AnthropicCacheControl };

/** system 参数形态：字符串（旧版）或内容块数组（cache_control 需要块级挂载） */
export type AnthropicSystemParam =
  | string
  | Array<{ type: "text"; text: string; cache_control?: AnthropicCacheControl }>;

/**
 * TASK-099：在映射后的 Anthropic 请求件上布置 prompt caching 断点（auto 策略）。
 *
 * 断点位置：
 * 1. system 尾元素——字符串提升为单块数组后挂标记（Anthropic 断点只能挂内容块）；
 * 2. 倒数第 1 条消息的末位内容块；
 * 3. 倒数第 2 条消息的末位内容块。
 *
 * messages 就地突变（mapOpenAIMessagesToAnthropic 每次产全新对象，无共享别名）；
 * 返回 system 参数（空串原样返回，调用方跳过赋值）。超 4 断点硬闸截停
 * （默认 3 个，闸门仅为策略演进兜底）；已在块上重复标记跳过（单消息窗口去重）。
 */
export function applyPromptCaching(
  system: string,
  messages: AnthropicMessage[]
): AnthropicSystemParam {
  let remaining = ANTHROPIC_CACHE_BREAKPOINT_LIMIT;
  let systemOut: AnthropicSystemParam = system;
  if (system) {
    systemOut = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
    remaining -= 1;
  }
  const markTail = (msg: AnthropicMessage | undefined): void => {
    if (!msg || remaining <= 0) return;
    const block = msg.content[msg.content.length - 1] as CacheableContentBlock | undefined;
    if (!block || block.cache_control) return;
    block.cache_control = { type: "ephemeral" };
    remaining -= 1;
  };
  // 倒数窗口：最后一条优先（缓存命中收益最大），其次倒数第二条
  markTail(messages[messages.length - 1]);
  markTail(messages[messages.length - 2]);
  return systemOut;
}

/**
 * Anthropic Messages API 原生协议驱动（AnthropicDriver）
 *
 * 与 OpenAICompatibleDriver 的差异点（协议层，而非能力层）：
 * - 鉴权走 x-api-key 头 + anthropic-version 固定版本，而非 Authorization Bearer；
 * - system 提示词是顶层参数而非 messages 里的 system 角色；
 * - 工具结果以 user 角色 tool_result content block 回传，assistant 工具调用
 *   以 tool_use content block 下发（OpenAI 是消息级 tool_calls/tool 角色）；
 * - SSE 事件是「语义事件流」（content_block_start/delta/stop…），每个 data 载荷
 *   自带 type 字段且与 event 名一致——解析只按 data.type 分派，不维护 event 行状态。
 *
 * 韧性层与 OpenAICompatibleDriver 同一实现（createResilientFetch）：非 2xx /
 * fetch reject / 响应头超时在首字节前按分类退避重试；流已开始吐字后的失败不
 * 透明重跑，仅升级为 ClassifiedModelError 上抛（诚实重试边界）。
 */

/** Anthropic content block：本驱动只产出文本 / 工具调用 / 工具结果三类 */
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

/**
 * 推理档位 → extended thinking 预算（tokens）。能力运行时 P1 的内置换算表：
 * Anthropic 无 effort 档位概念，只有绝对预算；按常见端点的中位输出规模取
 * low 4K / medium 16K / high 32K。未知名回落 medium（预算错选是可逆的用户操作，
 * API 会按实际预算执行）。后续需要精细化时迁移到 harness_config。
 */
const EFFORT_BUDGET_TOKENS: Record<string, number> = {
  low: 4096,
  medium: 16384,
  high: 32768,
};

/**
 * OpenAI 风格 ChatMessage[] → Anthropic Messages API 参数。
 *
 * 映射动机：
 * - system 消息不能进 messages（Anthropic 无 system 角色），抽出拼接为顶层 system；
 * - 连续多条 role:"tool"（并行工具调用产物）合并进同一条 user 消息——
 *   Anthropic 要求 tool_result 位于 user 消息且紧跟对应 tool_use，拆成多条
 *   相邻 user 消息虽会被服务端合并，但显式合并让请求体与官方示例同构；
 * - assistant 的 tool_calls → tool_use block，arguments JSON.parse 容错：
 *   历史上下文可能含非法 arguments（截断/旧格式），此时回落空对象保住会话
 *   结构完整，而不是让整个请求 400。
 */
export function mapOpenAIMessagesToAnthropic(messages: ChatMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const mapped: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // system 约定为纯文本（多模态只出现在 user 轮次），显式收窄防 parts 误入
      if (typeof msg.content === "string" && msg.content) systemParts.push(msg.content);
      continue;
    }

    if (msg.role === "tool") {
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        // tool 响应按约定为纯文本（多模态只出现在 user 轮次）
        content: typeof msg.content === "string" ? msg.content : "",
      };
      const last = mapped[mapped.length - 1];
      // 仅并入「纯 tool_result」的相邻 user 消息，避免污染带文本的 user 轮次
      if (
        last &&
        last.role === "user" &&
        last.content.length > 0 &&
        last.content.every((b) => b.type === "tool_result")
      ) {
        last.content.push(block);
      } else {
        mapped.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const content: AnthropicContentBlock[] = [];
      if (typeof msg.content === "string" && msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function.arguments) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          // arguments 非法 → 空对象（见函数头注释）
        }
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      // 空 assistant 消息（无文本无工具调用）会被 API 判非法，直接跳过
      if (content.length > 0) mapped.push({ role: "assistant", content });
      continue;
    }

    // role:"user"
    if (Array.isArray(msg.content)) {
      // 多模态（能力运行时 P2）：text 块平移；image_url（内部 OpenAI 风格 data URL）
      // → Anthropic image base64 source 块
      const blocks: AnthropicContentBlock[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          blocks.push({ type: "text", text: part.text });
        } else {
          const m = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
          if (m) {
            blocks.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
          }
        }
      }
      if (blocks.length > 0) mapped.push({ role: "user", content: blocks });
    } else if (msg.content) {
      mapped.push({ role: "user", content: [{ type: "text", text: msg.content }] });
    }
  }

  return { system: systemParts.join("\n\n"), messages: mapped };
}

/** Anthropic SSE 流解析状态：跨事件记忆 tool_use 块元信息与 message_start 的输入 token */
interface StreamState {
  /** content_block_start(tool_use) 记录 index → {id,name}，供增量对齐与调试 */
  toolBlocks: Map<number, { id: string; name: string }>;
  /** message_start.usage.input_tokens：message_delta 的 usage 通常只带 output_tokens，输入侧由此补齐 */
  inputTokens?: number;
  /** message_start.usage.cache_read_input_tokens：缓存命中读取（计价分档数据源，能力运行时 P1） */
  cachedTokens?: number;
  /** message_start.usage.cache_creation_input_tokens：缓存写入（计价分档数据源，TASK-079） */
  cacheCreationTokens?: number;
}

export class AnthropicDriver implements IModelDriver {
  private readonly fetchImpl: typeof fetch;
  private readonly maxTokens: number;
  private readonly promptCaching: PromptCachingMode | (() => PromptCachingMode);

  constructor(
    private apiKey?: string,
    private baseUrl: string = "https://api.anthropic.com",
    options: AnthropicDriverOptions = {}
  ) {
    const baseFetch = options.fetchImpl ?? fetch;
    if (options.resilience === false) {
      this.fetchImpl = baseFetch;
    } else {
      // 布尔开关仅控制启停；策略本体与 OpenAICompatibleDriver 共用默认口径
      this.fetchImpl = createResilientFetch(baseFetch, resolveResiliencePolicy(undefined), {});
    }
    this.maxTokens = options.maxTokens ?? 8192;
    // TASK-099：缺省 auto（新增能力默认开，off 回退旧版请求形态）
    this.promptCaching = options.promptCaching ?? "auto";
  }

  async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    // 域名规则：Anthropic 兼容网关（如 MiniMax）要 x-api-key，Azure 要 api-key
    const endpoint = resolveEndpointHeaders({
      baseUrl: this.baseUrl,
      protocol: "anthropic",
      apiKey: this.apiKey,
      sessionId: req.sessionId,
      turnId: req.turnId,
      model: req.model,
    });
    if (this.apiKey && !endpoint.ownsAuth) {
      headers["x-api-key"] = this.apiKey;
    }
    Object.assign(headers, endpoint.headers);
    // 归属头：标明请求来自 vuagent（可用 VUAGENT_USER_AGENT(_SUFFIX) 覆盖）
    Object.assign(headers, attributionHeadersForRequest());
    // TASK-098 出站 trace 传播：入站 traceparent 在 AsyncLocalStorage 中时
    // 注入子 span traceparent（同 traceId + 新 span id）；无上下文不加头，
    // 请求形态与注入前逐字节一致（零开销短路）
    const outboundTraceparent = childTraceparent();
    if (outboundTraceparent) {
      headers["traceparent"] = outboundTraceparent;
    }

    const { system, messages } = mapOpenAIMessagesToAnthropic(req.messages);

    // TASK-099：prompt caching 断点在请求装配时布置——此刻 messages 已经过
    // 上游压缩层裁剪，断点天然落在「裁剪后」的尾部窗口（超长上下文压缩后
    // 断点仍正确贴尾）。函数形态逐次求值，值形态为构造期快照。
    const cachingMode =
      typeof this.promptCaching === "function" ? this.promptCaching() : this.promptCaching;

    // 能力运行时 P1：OpenAI 风格 reasoning_effort → Anthropic extended thinking。
    // Anthropic 不认 reasoning_effort 字段（原样透传必 400），这里翻译成
    // thinking budget 并剔除原字段；extended thinking 与 temperature/top_p/top_k
    // 采样参数互斥（同发必 400），thinking 启用时一并剔除（TASK-084）。
    const {
      reasoning_effort: reasoningEffort,
      temperature: _samplingTemperature,
      top_p: _samplingTopP,
      top_k: _samplingTopK,
      ...restParams
    } = (req.parameters ?? {}) as Record<string, unknown>;

    const payload: Record<string, unknown> = {
      model: req.model,
      max_tokens: this.maxTokens,
      stream: true,
      messages,
      // parameters 放最后展开：调用方可按次覆盖 max_tokens 等原生参数
      ...restParams,
    };
    if (typeof reasoningEffort === "string" && reasoningEffort.trim()) {
      // TASK-084：Object.hasOwn 守卫原型链——档名取 "constructor"/"toString" 等
      // 原型成员时会拿到函数而非预算数字（budget 被 JSON 序列化丢弃致 400）
      const effortKey = reasoningEffort.trim();
      const budget = Object.hasOwn(EFFORT_BUDGET_TOKENS, effortKey)
        ? EFFORT_BUDGET_TOKENS[effortKey]
        : EFFORT_BUDGET_TOKENS.medium;
      payload.thinking = { type: "enabled", budget_tokens: budget };
      // API 约束：max_tokens 必须大于 budget_tokens；不足时抬到 budget 的 1.5 倍（千位取整）
      const currentMax = typeof payload.max_tokens === "number" ? payload.max_tokens : this.maxTokens;
      payload.max_tokens = Math.max(currentMax, Math.ceil((budget * 1.5) / 1000) * 1000);
    } else {
      // 无 thinking 时采样参数正常透传
      if (_samplingTemperature !== undefined) payload.temperature = _samplingTemperature;
      if (_samplingTopP !== undefined) payload.top_p = _samplingTopP;
      if (_samplingTopK !== undefined) payload.top_k = _samplingTopK;
    }
    if (cachingMode === "auto") {
      // auto：system 尾 + 消息倒数窗口设断点；system 为空时消息尾部断点照常布置
      const systemOut = applyPromptCaching(system, messages);
      if (systemOut) payload.system = systemOut;
    } else if (system) {
      // off：完全不变（请求形态与旧版逐字节一致）
      payload.system = system;
    }

    if (req.tools && req.tools.length > 0) {
      // OpenAI function 风格 → Anthropic 工具定义：parameters 平移为 input_schema
      payload.tools = req.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: req.abortSignal,
      });
    } catch (err: unknown) {
      // 调用方主动中止：原样上抛，保留既有中止语义
      if (req.abortSignal?.aborted) throw err;
      const errorClass = classifyModelError(err);
      const msg = err instanceof Error ? err.message : String(err);
      throw new ClassifiedModelError(
        `连接模型 API [${url}] 失败: ${msg}。请检查 API 基础地址 Base URL 或网络连通性。`,
        errorClass
      );
    }

    if (!res.ok) {
      // 与 OpenAICompatibleDriver 同口径：先读正文再分类（context_overflow 依赖 message 检测）
      const errText = await res.text().catch(() => "");
      const errorClass = classifyHttpError(res.status, errText);
      const detail = formatModelErrorDetail(errText);
      throw new ClassifiedModelError(
        `模型 API 返回错误 (${res.status} ${res.statusText}): ${detail}`,
        errorClass,
        res.status
      );
    }

    if (!res.body) {
      throw new ClassifiedModelError("No response body received from model API", "network", res.status);
    }

    const state: StreamState = { toolBlocks: new Map() };
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (err: unknown) {
          // 诚实重试边界：流已开始吐字后不做透明重跑，仅升级为分类错误上抛
          if (req.abortSignal?.aborted) throw err;
          const errorClass = classifyModelError(err);
          const msg = err instanceof Error ? err.message : String(err);
          throw new ClassifiedModelError(`模型流读取中断: ${msg}`, errorClass, res.status);
        }
        const { done, value } = readResult;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          // 只解析 data 行：Anthropic 每个 data 载荷自带 type 字段（与 event 名一致），
          // event 行不参与分派，避免维护双通道状态
          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6).trim();
          if (!dataStr) continue;

          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(dataStr) as Record<string, unknown>;
          } catch {
            // 忽略非合法 JSON 行
            continue;
          }

          const chunk = toStreamChunk(parsed, state);
          if (chunk) yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * 单个 Anthropic SSE 事件 → ModelStreamChunk（不需要产出增量的事件返回 undefined）。
 * 提取为纯函数：事件 → chunk 的映射无副作用（仅填充跨事件 state），便于单测与后续复用。
 */
function toStreamChunk(parsed: Record<string, unknown>, state: StreamState): ModelStreamChunk | undefined {
  switch (parsed.type) {
    case "message_start": {
      // message_start 携带输入 token 计数；此处只记忆不产 chunk——
      // usage 统一在 message_delta 汇总产出，避免同一轮多次 usage 事件
      const message = parsed.message as {
        usage?: {
          input_tokens?: unknown;
          cache_read_input_tokens?: unknown;
          cache_creation_input_tokens?: unknown;
        };
      } | undefined;
      const inputTokens = message?.usage?.input_tokens;
      if (typeof inputTokens === "number") state.inputTokens = inputTokens;
      const cached = message?.usage?.cache_read_input_tokens;
      if (typeof cached === "number" && cached > 0) state.cachedTokens = cached;
      const cacheCreation = message?.usage?.cache_creation_input_tokens;
      if (typeof cacheCreation === "number" && cacheCreation > 0) state.cacheCreationTokens = cacheCreation;
      return undefined;
    }

    case "content_block_start": {
      const index = typeof parsed.index === "number" ? parsed.index : 0;
      const block = parsed.content_block as { type?: string; id?: string; name?: string } | undefined;
      if (block?.type === "tool_use") {
        // 记录 index → {id,name}：后续 input_json_delta 只带 index，上层按 index 归并
        state.toolBlocks.set(index, { id: block.id ?? "", name: block.name ?? "" });
        return {
          type: "tool_call_delta",
          toolCall: { index, id: block.id, name: block.name, argumentsDelta: "" },
        };
      }
      // text 块的 start 事件不携带内容（内容全部在后续 delta 里），不产 chunk
      return undefined;
    }

    case "content_block_delta": {
      const index = typeof parsed.index === "number" ? parsed.index : 0;
      const delta = parsed.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
      switch (delta?.type) {
        case "text_delta":
          return delta.text ? { type: "text_delta", text: delta.text } : undefined;
        case "thinking_delta":
          // 扩展思考（extended thinking）→ 复用 thought_delta 通道，与
          // OpenAICompatibleDriver 的 reasoning_content 口径对齐
          return delta.thinking ? { type: "thought_delta", text: delta.thinking } : undefined;
        case "input_json_delta":
          // 工具入参按字符串切片下发，由上层累积后 JSON.parse
          return delta.partial_json
            ? { type: "tool_call_delta", toolCall: { index, argumentsDelta: delta.partial_json } }
            : undefined;
        default:
          // signature_delta 等签名校验类增量对上层无意义，静默丢弃
          return undefined;
      }
    }

    case "message_delta": {
      const usage = parsed.usage as {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cache_read_input_tokens?: unknown;
        cache_creation_input_tokens?: unknown;
      } | undefined;
      if (!usage) return undefined;
      // 输入 token 优先取本事件的值（部分网关会在此重复下发），缺省回落 message_start 记忆
      const rawInputTokens =
        typeof usage.input_tokens === "number" ? usage.input_tokens : (state.inputTokens ?? 0);
      const completionTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      // Anthropic 的 thinking token 计入 output_tokens（无独立计数），推理分档不单列；
      // 缓存读取/写入经 message_start 记忆补齐（部分网关也会在 message_delta 重复下发）
      const cachedTokens =
        typeof usage.cache_read_input_tokens === "number"
          ? usage.cache_read_input_tokens
          : state.cachedTokens;
      const cacheCreationTokens =
        typeof usage.cache_creation_input_tokens === "number"
          ? usage.cache_creation_input_tokens
          : state.cacheCreationTokens;
      // TASK-079 口径修正：Anthropic 的 input_tokens 本就不含 cache_read / cache_creation
      // （三者并列上报），而下游计价器按 OpenAI 语义「promptTokens 为总输入、cached 是其中
      // 命中部分」做减法拆分。这里统一为 OpenAI 语义——总输入 = 常规 + 读取 + 写入，
      // 否则常规段会被重复扣减（少计费），totalTokens 也少计上下文占用。
      const promptTokens = rawInputTokens + (cachedTokens ?? 0) + (cacheCreationTokens ?? 0);
      return {
        type: "usage",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          ...(cachedTokens && cachedTokens > 0 ? { cachedTokens } : {}),
          ...(cacheCreationTokens && cacheCreationTokens > 0 ? { cacheCreationTokens } : {}),
        },
      };
    }

    case "message_stop":
      return { type: "done" };

    case "error": {
      const err = parsed.error as { type?: string; message?: string } | undefined;
      const msg = err?.message || JSON.stringify(parsed);
      const isOverloaded = err?.type === "overloaded_error";
      const errorClass = isOverloaded ? "server" : classifyModelError(msg);
      throw new ClassifiedModelError(`Anthropic 流式错误: ${msg}`, errorClass);
    }

    default:
      // ping / content_block_stop 等事件不映射增量
      return undefined;
  }
}
