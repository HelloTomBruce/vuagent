/**
 * 聊天流数据域：SSE 连接管理 + 会话级多任务后台执行状态
 * 从原 Console.vue 的 connectToSessionStream / handleSend 推流段 / stopExecution 平移。
 * 事件归约逻辑全部委托给 stream/reducer.ts（纯函数，可单测）。
 */
import { computed, reactive, ref } from "vue";
import { abortSession, openChatStream, openSessionStream } from "../api/client";
import type { ChatRequestBody } from "../api/client";
import { extractSSEEvents } from "../stream/sse";
import { applyStreamEvent, recordSeq } from "../stream/reducer";
import type { ScrollToBottomOptions } from "@vuagent/ui";
import type { ContextPart } from "@vuagent/ui";
import type { HarnessStreamEvent } from "@vuagent/protocol";
import type { MessageTurn, PlanStep } from "../types";

export interface ChatStreamOptions {
  getActiveSessionId: () => string;
  refreshSessions: () => Promise<void>;
  /** 流式期间的跟随滚动（钉底时才真正滚动）；发送消息用 { force: true } */
  scrollToBottom: (options?: ScrollToBottomOptions) => void;
}

export interface SendPromptOptions {
  sessionId: string;
  workspaceId: string;
  modelProfileId?: string;
  permission: string;
  /** 推理档位（能力运行时 P1）：透传 /api/chat，服务端按能力声明裁决 */
  reasoningEffort?: string;
  /** 图片附件（能力运行时 P2）：base64，服务端组装为 content parts */
  images?: Array<{ name: string; mediaType: string; data: string }>;
  /** 附件回显元数据（TASK-050）：user turn 渲染用；dataUrl 仅存在于当日会话内存态 */
  attachments?: Array<{ name: string; kind: "image" | "file"; size: number; dataUrl?: string }>;
}

export function useChatStream(options: ChatStreamOptions) {
  const chatTurns = ref<MessageTurn[]>([]);
  const planSteps = ref<PlanStep[]>([]);
  const isPlanExpanded = ref(true);
  const isPlanVisible = computed(() => planSteps.value.length > 0);
  const completedStepsCount = computed(() => {
    return planSteps.value.filter((s) => s.status === "done").length;
  });
  const currentRunningStep = computed(() => {
    return planSteps.value.find((s) => s.status === "running");
  });

  const isRunning = ref(false);
  const activeAbortController = ref<AbortController | null>(null);

  // 上下文用量（由 usage 事件实时驱动；无事件时保持默认占位）
  const contextUsed = ref(0);
  const contextLimit = ref(128000);
  // 会话累计消耗（计费口径 = Σ各步 prompt+completion，与服务端 TelemetryLedger 同源；
  // 注意 usage.promptTokens 含重发历史属窗口口径，跨步累加必须逐事件累加而非取 totalTokens）
  const sessionTokensUsed = ref(0);
  /** 每会话累计表：多会话并行时后台会话的消耗按 id 归账，切回时秒级恢复 */
  const sessionTokensUsedMap = reactive(new Map<string, number>());
  // 协议级分段估算（system/history/tools），由 usage 事件的 parts 驱动；
  // 无 parts（旧服务端/沙箱演示流）时由视图层降级为单段「对话历史」
  const ctxParts = ref<ContextPart[]>([]);

  // 会话级多任务后台执行管理与流缓冲状态
  const sessionTurnsCache = new Map<string, MessageTurn[]>();
  const sessionRunningMap = reactive(new Map<string, boolean>());
  const sessionAbortControllers = new Map<string, AbortController>();

  function resetTurns() {
    chatTurns.value = [];
    planSteps.value = [];
    // 新会话：上下文仪表归零（等运行时 usage 事件按真实占用覆盖）
    contextUsed.value = 0;
    ctxParts.value = [];
    sessionTokensUsed.value = 0;
  }

  function isActiveSession(targetSessionId?: string) {
    return !targetSessionId || targetSessionId === options.getActiveSessionId();
  }

  function handleStreamEvent(event: HarnessStreamEvent, turn: MessageTurn, targetSessionId?: string) {
    // R7 修复：seq 广播序号在入口统一记录——usage/traj 提前 return 的分支
    // 不再绕过（此前 lastSeq 永远落后真实广播序号，增量重连游标会失真）
    recordSeq(turn, event);

    // usage 是会话级事件（不挂在具体 turn 上），先行拦截更新上下文 Gauge。
    // 窗口占用口径（与 Codex/Claude Code 一致）：promptTokens 是本步发送的全部上下文
    // （ReAct 每步重发历史，取"最近一次调用"即真实占用），直接覆盖而非跨步累加。
    if (event.type === "usage") {
      contextUsed.value = event.promptTokens + event.completionTokens;
      // 累计消耗归账：逐事件累加 prompt+completion（计费口径）；后台会话按 id 记账
      const usageSessionId = targetSessionId || options.getActiveSessionId();
      sessionTokensUsedMap.set(
        usageSessionId,
        (sessionTokensUsedMap.get(usageSessionId) ?? 0) +
          event.promptTokens +
          event.completionTokens
      );
      if (isActiveSession(targetSessionId)) {
        sessionTokensUsed.value += event.promptTokens + event.completionTokens;
      }
      if (event.contextWindow) {
        contextLimit.value = event.contextWindow;
      }
      // 优先消费服务端分段（system/tools/history）；无 parts 时降级为单段历史
      ctxParts.value = event.parts?.length
        ? event.parts
        : [{ id: "history", label: "对话历史", tokens: contextUsed.value, kind: "history" }];
      return;
    }

    // traj 是 turn 级轨迹事件：实时追加到当前 assistant turn（对齐 dsh 轨迹随 turn 生长）
    if (event.type === "traj") {
      if (!turn.trajEvents) turn.trajEvents = [];
      turn.trajEvents.push(event.event);
      return;
    }

    applyStreamEvent(
      turn,
      event,
      { isActiveSession: isActiveSession(targetSessionId) },
      {
        setPlanSteps(steps) {
          planSteps.value = steps;
          isPlanExpanded.value = true;
        },
      }
    );
  }

  /**
   * 接入/建立会话 SSE 流（支持全新发起与断线/切换会话重连）
   * 与原实现逐行对应：后台执行不随连接断开而中断
   */
  async function connectToSessionStream(
    targetSessionId: string,
    targetTurn: MessageTurn,
    isPostChat: boolean,
    postBody?: ChatRequestBody
  ) {
    sessionRunningMap.set(targetSessionId, true);
    if (options.getActiveSessionId() === targetSessionId) {
      isRunning.value = true;
    }

    const abortCtrl = new AbortController();
    sessionAbortControllers.set(targetSessionId, abortCtrl);
    if (options.getActiveSessionId() === targetSessionId) {
      activeAbortController.value = abortCtrl;
    }

    const startTime = Date.now();

    try {
      const res = isPostChat
        ? await openChatStream(postBody as ChatRequestBody)
        : await openSessionStream(targetSessionId);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取服务端流数据");

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const { payloads, buffer: rest } = extractSSEEvents(
          decoder.decode(value, { stream: true }),
          buffer
        );
        buffer = rest;

        for (const raw of payloads) {
          if (raw === "[DONE]") {
            targetTurn.isStreaming = false;
            break;
          }

          try {
            const event = JSON.parse(raw);
            handleStreamEvent(event, targetTurn, targetSessionId);
          } catch (err) {
            console.warn("解析 SSE 块失败:", raw, err);
          }
        }

        if (options.getActiveSessionId() === targetSessionId) {
          options.scrollToBottom();
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // R1 修复：中止徽标呈现（aborted 事件已发时幂等），不再注入斜体假正文
        targetTurn.abortedReason ??= "user";
      } else {
        targetTurn.content += `\n\n*(调用出错: ${err?.message || String(err)})*`;
      }
    } finally {
      targetTurn.isStreaming = false;
      targetTurn.thoughtDuration = Math.round((Date.now() - startTime) / 100) / 10;
      sessionRunningMap.set(targetSessionId, false);
      sessionAbortControllers.delete(targetSessionId);
      if (options.getActiveSessionId() === targetSessionId) {
        isRunning.value = false;
        activeAbortController.value = null;
        options.scrollToBottom();
      }
      await options.refreshSessions();
    }
  }

  /**
   * 发起一轮任务：追加用户 Turn + 流式助手 Turn，随后建立 POST /api/chat 推流
   * （原 handleSend 的第 2~4 段，会话创建前置逻辑留在视图层编排）
   */
  async function sendPrompt(prompt: string, opts: SendPromptOptions) {
    const userTurn: MessageTurn = {
      id: `turn-user-${Date.now()}`,
      role: "user",
      content: prompt,
      ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
      timestamp: Date.now(),
    };
    chatTurns.value.push(userTurn);

    const assistantTurn: MessageTurn = {
      id: `turn-asst-${Date.now()}`,
      role: "assistant",
      content: "",
      thought: "",
      thoughtExpanded: true,
      thoughtDuration: 0,
      isStreaming: true,
      cards: [],
      blocks: [],
      trajEvents: [],
      timestamp: Date.now(),
    };
    chatTurns.value.push(assistantTurn);
    sessionTurnsCache.set(opts.sessionId, chatTurns.value);
    // 用户刚发出消息：强制回底（无视钉底状态）
    options.scrollToBottom({ force: true });

    // 关键：从 reactive 数组取代理对象交给流处理器。
    // 直接改 raw 对象会绕过 Vue proxy 导致真实模型流式期间界面不更新
    // （此前仅因沙箱演示流的 ui_agent_plan 恰好触发重渲染而未暴露）。
    const reactiveTurn = chatTurns.value[chatTurns.value.length - 1];
    void connectToSessionStream(opts.sessionId, reactiveTurn, true, {
      sessionId: opts.sessionId,
      workspaceId: opts.workspaceId,
      prompt,
      modelProfileId: opts.modelProfileId,
      permission: opts.permission,
      reasoningEffort: opts.reasoningEffort,
      images: opts.images,
      // 落库元数据剥离 dataUrl（服务端不存内容）；JSON 序列化自动丢弃 undefined
      attachments: opts.attachments?.length
        ? opts.attachments.map(({ name, kind, size }) => ({ name, kind, size }))
        : undefined,
    });
  }

  /** 停止当前激活会话的运行（通知后端中止执行回环） */
  async function stopExecution() {
    const currentSessionId = options.getActiveSessionId();
    if (currentSessionId) {
      // R1 修复：先通知服务端中止——hub 广播的 aborted 事件经当前 SSE 流
      // 送达 reducer（徽标呈现），本地连接保持到事件流过；
      // 此前先掐断本地 fetch，aborted 事件永远到不了，只剩假斜体文案
      await abortSession(currentSessionId);
      sessionRunningMap.set(currentSessionId, false);
      sessionAbortControllers.delete(currentSessionId);
    }
    // 服务端广播后关闭本地流（事件已送达；本地 abort 只是兜底断开手段）
    if (activeAbortController.value) {
      activeAbortController.value.abort();
    }
    isRunning.value = false;
    activeAbortController.value = null;
  }

  return {
    chatTurns,
    planSteps,
    isPlanVisible,
    isPlanExpanded,
    completedStepsCount,
    currentRunningStep,
    isRunning,
    activeAbortController,
    contextUsed,
    contextLimit,
    sessionTokensUsed,
    sessionTokensUsedMap,
    ctxParts,
    sessionTurnsCache,
    sessionRunningMap,
    sessionAbortControllers,
    resetTurns,
    sendPrompt,
    connectToSessionStream,
    stopExecution,
  };
}

export type ChatStreamApi = ReturnType<typeof useChatStream>;
