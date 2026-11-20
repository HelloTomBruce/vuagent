import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "./model-driver.js";
import type { ChatMessage } from "../core/context-compactor.js";
import {
  ClassifiedModelError,
  classifyHttpError,
  classifyModelError,
  createResilientFetch,
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
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

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
      if (msg.content) systemParts.push(msg.content);
      continue;
    }

    if (msg.role === "tool") {
      const block: AnthropicContentBlock = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: msg.content ?? "",
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
      if (msg.content) content.push({ type: "text", text: msg.content });
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
    if (msg.content) {
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
}

export class AnthropicDriver implements IModelDriver {
  private readonly fetchImpl: typeof fetch;
  private readonly maxTokens: number;

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
  }

  async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/messages`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    const { system, messages } = mapOpenAIMessagesToAnthropic(req.messages);

    const payload: Record<string, unknown> = {
      model: req.model,
      max_tokens: this.maxTokens,
      stream: true,
      messages,
      // parameters 放最后展开：调用方可按次覆盖 max_tokens 等原生参数
      ...req.parameters,
    };
    if (system) {
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
      throw new ClassifiedModelError(
        `模型 API 返回错误 (${res.status} ${res.statusText}): ${errText}`,
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

          try {
            const parsed = JSON.parse(dataStr) as Record<string, unknown>;
            const chunk = toStreamChunk(parsed, state);
            if (chunk) yield chunk;
          } catch {
            // 忽略非合法 JSON 行
          }
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
      const message = parsed.message as { usage?: { input_tokens?: unknown } } | undefined;
      const inputTokens = message?.usage?.input_tokens;
      if (typeof inputTokens === "number") state.inputTokens = inputTokens;
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
      const usage = parsed.usage as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
      if (!usage) return undefined;
      // 输入 token 优先取本事件的值（部分网关会在此重复下发），缺省回落 message_start 记忆
      const promptTokens =
        typeof usage.input_tokens === "number" ? usage.input_tokens : (state.inputTokens ?? 0);
      const completionTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
      return {
        type: "usage",
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
    }

    case "message_stop":
      return { type: "done" };

    default:
      // ping / content_block_stop / error 等事件不映射增量
      return undefined;
  }
}
