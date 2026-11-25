/**
 * @vuagent/ui - useAgentChat Composable
 * 前端流式状态机：驱动 MessageBlock 混合流、处理 SSE 事件与 HITL 动作回调
 */

import { getCurrentInstance, onBeforeUnmount, ref, shallowRef } from "vue";
import type { MessageBlock, UIStreamEvent, CustomProviderConfig } from "./types.js";
import { setupDefaultAgentRegistry } from "./registry.js";
import { consumeSSEStream } from "./sse.js";
import { createDeltaBuffer } from "./useDeltaBuffer.js";

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
  // 兜底初始化：宿主若未显式调用 setupDefaultAgentRegistry()，这里确保内置组件已注册（幂等）。
  // 注意这是运行时调用而非模块顶层副作用，不影响消费方 tree-shaking。
  setupDefaultAgentRegistry();

  const messages = ref<ChatMessage[]>([]);
  const isStreaming = ref(false);
  const error = ref<string | null>(null);

  // 当前正在流式接收的助手消息引用。
  // 注意保存的是 messages 数组内的响应式代理（而非原始对象）：
  // 流式期间对 blocks/content 的写入必须经代理触发依赖更新，
  // 否则 rAF commit 后模板不会重渲（绕过缓冲的直写点由此杜绝）。
  const currentAssistantMsg = shallowRef<ChatMessage | null>(null);

  // ---- 流式文本 rAF 合帧（TASK-104，TASK-114 抽离为共享件 runtime/useDeltaBuffer）----
  // delta 只进缓冲，requestAnimationFrame 每帧一次 commit 到响应式 text block；
  // markdown 重解析（VaMarkdown 的 content computed）随 commit 同帧节流——
  // 同帧多次 delta 只触发一次重解析。响应式链路唯一写入点就是 commit 回调。
  let bufferBlock: Extract<MessageBlock, { kind: "text" }> | null = null;
  const textBuffer = createDeltaBuffer({
    commit: (text) => {
      if (bufferBlock && text) {
        bufferBlock.content += text;
      }
    },
  });

  /**
   * 即时 flush：取消待执行帧并同步提交缓冲（幂等）。
   * 复制/截图等需要立刻取全文的场景，以及流结束 / 错误 / 组件卸载路径
   * 统一走这里，保证流式结束时全文完整无丢字。
   */
  const flushNow = () => textBuffer.flush();
  /** 丢弃缓冲：clearMessages/setMessages 换血消息时旧块已不可达，无需提交 */
  const dropTextBuffer = () => textBuffer.drop();

  /**
   * 清洗或追加文本块（rAF 合帧版）：
   * delta 落到目标 text block 的缓冲，帧回调统一 commit；
   * 块边界切换（缓冲块之后插入了 component 块）时旧块缓冲立即落账，
   * 保证块序与逐 delta 直写版一致（text → component → text）。
   */
  const appendTextDelta = (msg: ChatMessage, delta: string) => {
    if (!msg.blocks) {
      msg.blocks = [];
    }
    const lastBlock = msg.blocks[msg.blocks.length - 1];
    let target: Extract<MessageBlock, { kind: "text" }>;
    if (lastBlock && lastBlock.kind === "text") {
      target = lastBlock;
    } else {
      msg.blocks.push({
        id: `blk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "text",
        content: "",
      });
      // 从响应式数组读回代理引用：commit 经代理写入才能触发依赖更新
      target = msg.blocks[msg.blocks.length - 1] as Extract<MessageBlock, { kind: "text" }>;
    }

    if (bufferBlock && bufferBlock !== target) {
      // 防御层：正常链路 handleStreamEvent 已在组件块结构事件前 flush；
      // 此处兜底跨块缓冲串字（如直接调用本函数的场景），旧块缓冲立即提交保块序
      textBuffer.flush();
    }
    bufferBlock = target;
    textBuffer.push(delta);
  };

  // 组件作用域内注册卸载钩子：卸载时强制 flush，缓冲文本不丢
  // （单测等非组件环境无实例，自然跳过）
  if (getCurrentInstance()) {
    onBeforeUnmount(flushNow);
  }

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

    // 合帧纪律：仅 text_delta 进缓冲；其余事件（组件块结构变化 / turn_end / error）
    // 处理前先同步 flush——块结构切换时已收文本先就位（保块序），
    // 终态与错误事件保证流式结束时全文完整无丢字。
    if (event.type !== "text_delta") {
      flushNow();
    }

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
      // 保存响应式代理而非原始对象：后续 block 写入经代理触发更新（见字段注释）
      currentAssistantMsg.value = messages.value[messages.value.length - 1];
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
      // TASK-114：SSE 消费循环收口至共享件 runtime/sse.ts（与宿主流式数据域同一实现）。
      // 解析升级：跨 chunk 半包 / CRLF / 多行 data 合并（原内联实现仅逐行拆分）。
      const { aborted } = await consumeSSEStream<UIStreamEvent>({
        open: async () => {
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
          return res;
        },
        onEvent: (event) => handleStreamEvent(event),
        onDone: () => handleStreamEvent({ type: "turn_end" }),
      });
      // 本地中止（当前 sendMessage 未接 signal——保留语义位）与异常收尾都强制 flush：
      // 流正常读完（含未发 [DONE] 的异常收尾）也强制 flush，缓冲不丢字
      void aborted;
      flushNow();
    } catch (err: any) {
      // 请求失败路径强制 flush：已收到的文本先完整落账
      flushNow();
      error.value = err.message || "Failed to send message";
      isStreaming.value = false;
      options.onError?.(err);
    }
  };

  /**
   * 提交 HITL 交互动作
   */
  const submitAction = async <TPayload = unknown>(toolCallId: string, payload: TPayload) => {
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
    // 回放结束（序列未含 turn_end 时）同样强制 flush；并强制复位 isStreaming——
    // 序列缺终态事件时此前会永久悬挂在流式态（审查修复轮补记）
    flushNow();
    isStreaming.value = false;
  };

  const clearMessages = () => {
    dropTextBuffer(); // 旧消息整体丢弃，缓冲块已不可达，直接丢弃不提交
    messages.value = [];
    currentAssistantMsg.value = null;
    error.value = null;
  };

  const setMessages = (newMessages: ChatMessage[]) => {
    dropTextBuffer();
    messages.value = [...newMessages];
    currentAssistantMsg.value = null;
    error.value = null;
  };

  return {
    messages,
    isStreaming,
    error,
    /** 即时提交合帧缓冲（复制/截图等需要立刻取全文的场景；测试亦经此手动 flush） */
    flushNow,
    sendMessage,
    submitAction,
    handleStreamEvent,
    playMockEvents,
    clearMessages,
    setMessages,
  };
}
