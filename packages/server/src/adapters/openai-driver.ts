import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "./model-driver.js";
import {
  ClassifiedModelError,
  classifyHttpError,
  classifyModelError,
  createResilientFetch,
  formatModelErrorDetail,
  resolveResiliencePolicy,
  type ResiliencePolicy,
  type ResilientFetchHooks,
} from "./resilience.js";

/** driver 级韧性选项：缺省启用默认策略；`resilience: false` 整体关闭（测试直连用） */
export interface OpenAIDriverOptions {
  resilience?: ResiliencePolicy | false;
  /** fetch 注入点（测试 mock SSE 流用）；缺省全局 fetch */
  fetchImpl?: typeof fetch;
  /** 重试遥测接缝（上层埋点用） */
  onRetry?: ResilientFetchHooks["onRetry"];
}

/**
 * OpenAI 规范兼容模型驱动 (OpenAICompatibleDriver)
 * 支持 OpenAI、DeepSeek、Qwen、Moonshot、Ollama 及各类兼容网关
 *
 * 韧性（TASK-048）：HTTP 请求经 createResilientFetch 包装——指数退避重试 +
 * Retry-After 尊重 + 响应头前超时；失败上抛 ClassifiedModelError（errorClass 供
 * 上层程序化区分）。流已开始吐字后的错误不透明重跑，仅升级为分类错误。
 */
export class OpenAICompatibleDriver implements IModelDriver {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private apiKey?: string,
    private baseUrl: string = "https://api.openai.com/v1",
    options: OpenAIDriverOptions = {}
  ) {
    const baseFetch = options.fetchImpl ?? fetch;
    if (options.resilience === false) {
      this.fetchImpl = baseFetch;
    } else {
      const policy = resolveResiliencePolicy(options.resilience ?? undefined);
      this.fetchImpl = createResilientFetch(
        baseFetch,
        policy,
        options.onRetry ? { onRetry: options.onRetry } : {}
      );
    }
  }

  async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...req.parameters,
    };

    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools;
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
      // R6 修复：先读 errText 再分类——400 "maximum context length…" 依赖
      // message 检测，此前分类在读取正文前执行，context_overflow 永远不可达
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

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let inThinkTag = false;

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
          if (!trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.slice(6).trim();

          if (dataStr === "[DONE]") {
            yield { type: "done" };
            continue;
          }

          try {
            const parsed = JSON.parse(dataStr);

            // 识别流中嵌入的业务错误（如个别国产模型在 HTTP 200 下首包返回 error_code 或 error 对象）
            if (parsed.error || parsed.error_code || (typeof parsed.code === "number" && parsed.code >= 400)) {
              const errObj = (parsed.error && typeof parsed.error === "object") ? parsed.error : parsed;
              const errMsg = errObj.message ?? errObj.error_msg ?? errObj.msg ?? JSON.stringify(errObj);
              const errStatus = typeof errObj.code === "number" ? errObj.code : (typeof parsed.error_code === "number" ? parsed.error_code : undefined);
              const errorClass = errStatus ? classifyHttpError(errStatus, errMsg) : classifyModelError(errMsg);
              throw new ClassifiedModelError(
                `模型流输出错误${errStatus ? ` (${errStatus})` : ""}: ${errMsg}`,
                errorClass,
                errStatus
              );
            }

            const choice = parsed.choices?.[0];

            if (parsed.usage) {
              // 能力运行时 P1：分档计价数据源——缓存命中与推理 token 明细
              //（较新的 usage 细分字段，旧端点缺省 = 分段缺省，计价回落整段单价）
              const usageDetails = parsed.usage as {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
                prompt_tokens_details?: { cached_tokens?: unknown };
                completion_tokens_details?: { reasoning_tokens?: unknown };
              };
              yield {
                type: "usage",
                usage: {
                  promptTokens: usageDetails.prompt_tokens ?? 0,
                  completionTokens: usageDetails.completion_tokens ?? 0,
                  totalTokens: usageDetails.total_tokens ?? 0,
                  ...(typeof usageDetails.prompt_tokens_details?.cached_tokens === "number"
                    ? { cachedTokens: usageDetails.prompt_tokens_details.cached_tokens }
                    : {}),
                  ...(typeof usageDetails.completion_tokens_details?.reasoning_tokens === "number"
                    ? { reasoningTokens: usageDetails.completion_tokens_details.reasoning_tokens }
                    : {}),
                },
              };
            }

            if (!choice) continue;

            const delta = choice.delta;
            if (!delta) continue;

            // 思考过程输出增量 (DeepSeek reasoning_content / Qwen thought)
            const reasoning = delta.reasoning_content || delta.reasoning || delta.thought;
            if (reasoning) {
              yield {
                type: "thought_delta",
                text: reasoning,
              };
            }

            // 文本输出增量（支持提取内联 <think>...</think> 标签）
            if (delta.content) {
              let text = delta.content;
              if (text.includes("<think>")) {
                inThinkTag = true;
                text = text.replace("<think>", "");
              }
              if (inThinkTag) {
                if (text.includes("</think>")) {
                  const [thoughtPart, rest] = text.split("</think>");
                  inThinkTag = false;
                  if (thoughtPart) {
                    yield { type: "thought_delta", text: thoughtPart };
                  }
                  if (rest) {
                    yield { type: "text_delta", text: rest };
                  }
                } else {
                  yield { type: "thought_delta", text };
                }
              } else {
                yield {
                  type: "text_delta",
                  text,
                };
              }
            }

            // 工具调用输出增量
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: "tool_call_delta",
                  toolCall: {
                    index: tc.index ?? 0,
                    id: tc.id,
                    name: tc.function?.name,
                    argumentsDelta: tc.function?.arguments,
                  },
                };
              }
            }
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
