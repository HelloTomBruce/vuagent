/**
 * @vuagent/ui - useAgentChat Composable
 * 前端流式状态机：驱动 MessageBlock 混合流、处理 SSE 事件与 HITL 动作回调
 */

import { ref, shallowRef } from "vue";
import type { MessageBlock, UIStreamEvent, CustomProviderConfig } from "./types.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content?: string;
  blocks?: MessageBlock[];
  createdAt: number;
}

export interface UseAgentChatOptions {
  apiBaseUrl?: string;
  sessionId?: string;
  onEvent?: (event: UIStreamEvent) => void;
  onTurnEnd?: () => void;
  onError?: (err: any) => void;
}

export interface SendMessageOptions {
  apiBaseUrl?: string;
  sessionId?: string;
  workspaceId?: string;
  mode?: "code" | "plan" | "ask";
  safety?: "auto" | "review";
  contextFiles?: Array<{ path: string; content?: string }>;
  headers?: Record<string, string>;
  providerConfig?: CustomProviderConfig;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const messages = ref<ChatMessage[]>([]);
  const isStreaming = ref(false);
  const error = ref<string | null>(null);

  // 当前正在流式接收的助手消息引用
  const currentAssistantMsg = shallowRef<ChatMessage | null>(null);

  /**
   * 清洗或追加文本块
   */
  const appendTextDelta = (msg: ChatMessage, delta: string) => {
    if (!msg.blocks) {
      msg.blocks = [];
    }
    const lastBlock = msg.blocks[msg.blocks.length - 1];
    if (lastBlock && lastBlock.kind === "text") {
      lastBlock.content += delta;
    } else {
      msg.blocks.push({
        id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "text",
        content: delta,
      });
    }
  };

  /**
   * 查找组件块
   */
  const findComponentBlock = (toolCallId: string) => {
    if (!currentAssistantMsg.value?.blocks) return null;
    return currentAssistantMsg.value.blocks.find(
      (b) => b.kind === "component" && b.toolCallId === toolCallId
    ) as Extract<MessageBlock, { kind: "component" }> | undefined;
  };

  /**
   * 核心：处理单条 UIStreamEvent
   */
  const handleStreamEvent = (event: UIStreamEvent) => {
    options.onEvent?.(event);

    if (event.type === "turn_end") {
      isStreaming.value = false;
      if (currentAssistantMsg.value?.blocks) {
        currentAssistantMsg.value.blocks = currentAssistantMsg.value.blocks.filter(
          (b) => b.kind !== "component" || (b.componentName && b.componentName !== "unknown")
        );
      }
      currentAssistantMsg.value = null;
      options.onTurnEnd?.();
      return;
    }

    if (event.type === "error") {
      isStreaming.value = false;
      error.value = event.message;
      options.onError?.(new Error(event.message));
      return;
    }

    // 确保有活跃的助手消息
    if (!currentAssistantMsg.value) {
      const msg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        blocks: [],
        createdAt: Date.now(),
      };
      messages.value.push(msg);
      currentAssistantMsg.value = msg;
    }

    const current = currentAssistantMsg.value;

    switch (event.type) {
      case "text_delta": {
        appendTextDelta(current, event.delta);
        break;
      }
      case "component_start": {
        if (!current.blocks) current.blocks = [];
        // 忽略未识别工具名称的占位事件，避免前端渲染 unknown 卡片
        if (event.componentName && event.componentName !== "unknown") {
          const existing = findComponentBlock(event.toolCallId);
          if (!existing) {
            current.blocks.push({
              id: event.toolCallId,
              kind: "component",
              toolCallId: event.toolCallId,
              componentName: event.componentName,
              status: "streaming",
              args: {},
            });
          } else if (existing.componentName === "unknown") {
            existing.componentName = event.componentName;
          }
        }
        break;
      }
      case "component_args_delta": {
        const block = findComponentBlock(event.toolCallId);
        if (block) {
          block.args = { ...block.args, ...event.partialArgs };
        }
        break;
      }
      case "component_executing": {
        if (!current.blocks) current.blocks = [];
        let block = findComponentBlock(event.toolCallId);
        if (!block) {
          if (event.componentName && event.componentName !== "unknown") {
            block = {
              id: event.toolCallId,
              kind: "component",
              toolCallId: event.toolCallId,
              componentName: event.componentName,
              status: "executing",
              args: event.args || {},
            };
            current.blocks.push(block);
          }
        } else {
          block.status = "executing";
          if (event.componentName && event.componentName !== "unknown") {
            block.componentName = event.componentName;
          }
          block.args = { ...block.args, ...event.args };
        }
        break;
      }
      case "component_ready": {
        if (!current.blocks) current.blocks = [];
        let block = findComponentBlock(event.toolCallId);
        if (!block) {
          if (event.componentName && event.componentName !== "unknown") {
            block = {
              id: event.toolCallId,
              kind: "component",
              toolCallId: event.toolCallId,
              componentName: event.componentName,
              status: event.status,
              args: {},
              result: event.data,
              error: event.error,
            };
            current.blocks.push(block);
          }
        } else {
          block.status = event.status;
          if (event.componentName && event.componentName !== "unknown") {
            block.componentName = event.componentName;
          }
          block.result = event.data;
          block.error = event.error;
        }
        break;
      }
    }
  };

  /**
   * 发起对话 (SSE)
   */
  const sendMessage = async (
    prompt: string,
    extraOptions?: SendMessageOptions | Record<string, string>
  ) => {
    if (!prompt.trim() || isStreaming.value) return;

    error.value = null;
    isStreaming.value = true;

    // 1. 追加用户消息
    messages.value.push({
      id: `usr-${Date.now()}`,
      role: "user",
      content: prompt,
      createdAt: Date.now(),
    });

    let baseUrl = options.apiBaseUrl || "";
    let headers: Record<string, string> = {};
    let providerConfig: CustomProviderConfig | undefined = undefined;
    let targetSessionId = options.sessionId;

    if (extraOptions) {
      if (
        "apiBaseUrl" in extraOptions ||
        "headers" in extraOptions ||
        "providerConfig" in extraOptions ||
        "sessionId" in extraOptions
      ) {
        const opt = extraOptions as SendMessageOptions;
        if (opt.apiBaseUrl !== undefined) baseUrl = opt.apiBaseUrl;
        if (opt.sessionId !== undefined) targetSessionId = opt.sessionId;
        if (opt.headers) headers = opt.headers;
        if (opt.providerConfig) providerConfig = opt.providerConfig;
      } else {
        headers = extraOptions as Record<string, string>;
      }
    }

    const opt = extraOptions as SendMessageOptions | undefined;

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          prompt,
          providerConfig,
          sessionId: targetSessionId,
          workspaceId: opt?.workspaceId,
          mode: opt?.mode,
          safety: opt?.safety,
          contextFiles: opt?.contextFiles,
        }),
      });

      if (!res.ok) {
        throw new Error(`Chat request failed with status ${res.status}`);
      }

      if (!res.body) {
        throw new Error("ReadableStream not supported or empty response");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === "[DONE]") {
              handleStreamEvent({ type: "turn_end" });
            } else {
              try {
                const event: UIStreamEvent = JSON.parse(dataStr);
                handleStreamEvent(event);
              } catch (parseErr) {
                console.warn("[useAgentChat] Failed to parse SSE event chunk:", parseErr);
              }
            }
          }
        }
      }
    } catch (err: any) {
      error.value = err.message || "Failed to send message";
      isStreaming.value = false;
      options.onError?.(err);
    }
  };

  /**
   * 提交 HITL 交互动作
   */
  const submitAction = async (toolCallId: string, payload: any) => {
    const baseUrl = options.apiBaseUrl || "";
    const res = await fetch(`${baseUrl}/api/action/${toolCallId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Failed to submit action: status ${res.status}`);
    }

    // 乐观更新对应组件状态
    const block = findComponentBlock(toolCallId);
    if (block) {
      block.status = "done";
      block.result = payload;
    }
    return await res.json();
  };

  /**
   * 离线回放/Mock 调试模式：按指定间隔分发 UIStreamEvent 序列
   */
  const playMockEvents = async (events: UIStreamEvent[], delayMs = 60) => {
    isStreaming.value = true;
    error.value = null;

    for (const evt of events) {
      handleStreamEvent(evt);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  };

  const clearMessages = () => {
    messages.value = [];
    currentAssistantMsg.value = null;
    error.value = null;
  };

  const setMessages = (newMessages: ChatMessage[]) => {
    messages.value = [...newMessages];
    currentAssistantMsg.value = null;
    error.value = null;
  };

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    submitAction,
    handleStreamEvent,
    playMockEvents,
    clearMessages,
    setMessages,
  };
}
