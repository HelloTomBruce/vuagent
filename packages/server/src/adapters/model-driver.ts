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
