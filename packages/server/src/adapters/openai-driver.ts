import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "./model-driver.js";

/**
 * OpenAI 规范兼容模型驱动 (OpenAICompatibleDriver)
 * 支持 OpenAI、DeepSeek、Qwen、Moonshot、Ollama 及各类兼容网关
 */
export class OpenAICompatibleDriver implements IModelDriver {
  constructor(
    private apiKey?: string,
    private baseUrl: string = "https://api.openai.com/v1"
  ) {}

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
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: req.abortSignal,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`连接模型 API [${url}] 失败: ${msg}。请检查 API 基础地址 Base URL 或网络连通性。`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`模型 API 返回错误 (${res.status} ${res.statusText}): ${errText}`);
    }

    if (!res.body) {
      throw new Error("No response body received from model API");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let inThinkTag = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
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
            const choice = parsed.choices?.[0];

            if (parsed.usage) {
              yield {
                type: "usage",
                usage: {
                  promptTokens: parsed.usage.prompt_tokens ?? 0,
                  completionTokens: parsed.usage.completion_tokens ?? 0,
                  totalTokens: parsed.usage.total_tokens ?? 0,
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
