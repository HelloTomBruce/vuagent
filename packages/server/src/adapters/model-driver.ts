import type { ChatMessage } from "../core/context-compactor.js";

export interface ModelStreamChunk {
  type: "text_delta" | "thought_delta" | "tool_call_delta" | "done" | "usage";
  text?: string;
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** 思考/推理 token（OpenAI 兼容 reasoning_tokens；Anthropic thinking 计入 output 不单列） */
    reasoningTokens?: number;
    /** Prompt Cache 命中读取的输入 token（OpenAI cached_tokens / Anthropic cache_read_input_tokens） */
    cachedTokens?: number;
    /**
     * Prompt Cache 写入的输入 token（Anthropic cache_creation_input_tokens）。
     * OpenAI 无缓存写入概念（写入与常规输入同价），此字段恒缺省。
     */
    cacheCreationTokens?: number;
  };
}

export interface ModelDriverRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  parameters?: Record<string, unknown>;
  abortSignal?: AbortSignal;
}

/**
 * 模型调用抽象驱动接口 (IModelDriver)
 */
export interface IModelDriver {
  generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk>;
}
