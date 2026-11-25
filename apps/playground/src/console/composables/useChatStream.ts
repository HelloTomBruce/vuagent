/**
 * 聊天流编排层（TASK-113 抽取后瘦身）：
 * 组合五个可复用 hooks（SSE 消费 / 会话运行登记表 / 上下文仪表 / 计划条 / 中止编排），
 * 保留事件分发与活跃会话镜像态。事件归约逻辑在 stream/reducer.ts（纯函数，可单测）。
 *
 * 公开 API 与抽取前逐成员一致（Console.vue / useSessions 零改动）。
 */
import { ref } from "vue";
import { createDeltaBuffer } from "@vuagent/ui";
import type { DeltaBuffer } from "@vuagent/ui";
import { openChatStream, openSessionStream } from "../api/client";
import type { ChatRequestBody } from "../api/client";
import { applyStreamEvent, recordSeq } from "../stream/reducer";
import { consumeSSEStream } from "./hooks/useSSEConnection";
import {
  appendReactiveTurn,
  useSessionRunRegistry,
} from "./hooks/useSessionRunRegistry";
import { useContextGauge } from "./hooks/useContextGauge";
import { useAgentPlanState } from "./hooks/useAgentPlanState";
import { useTurnAbort } from "./hooks/useTurnAbort";
import type { ScrollToBottomOptions } from "@vuagent/ui";
import type { HarnessStreamEvent } from "@vuagent/protocol";
import type { MessageTurn } from "../types";

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

  // ---- 可复用 hooks（TASK-113）----
  const registry = useSessionRunRegistry(options.getActiveSessionId);
  const gauge = useContextGauge(options.getActiveSessionId);
  const plan = useAgentPlanState();

  // 活跃会话镜像态：registry 按会话记帐，这两个 ref 只镜像「当前正查看的会话」
  const isRunning = ref(false);
  const activeAbortController = ref<AbortController | null>(null);

  function isActiveSession(targetSessionId?: string) {
    return registry.isActiveSession(targetSessionId);
  }

  // ---- text_delta rAF 合帧（TASK-114，消费库共享件 createDeltaBuffer）----
  // delta 累积进缓冲、每帧一次经 reducer 归约（markdown 重渲染同帧节流）；
  // 按目标 turn 分键（WeakMap）——多会话并行流式互不串字；
  // 非文本事件前同步 flush（保块序），流收尾/中止/出错路径 flush 保全文完整。
  const turnDeltaBuffers = new WeakMap<MessageTurn, DeltaBuffer>();

  function flushTurnDelta(turn: MessageTurn): void {
    turnDeltaBuffers.get(turn)?.flush();
  }

  function resetTurnDeltaBuffer(turn: MessageTurn): void {
    turnDeltaBuffers.delete(turn);
  }

  function resetTurns() {
    chatTurns.value = [];
    plan.reset();
    gauge.reset();
  }

  /** 事件分发：seq 记录 → usage 拦截（仪表）→ traj 追加 → 其余交 reducer 归约 */
  function handleStreamEvent(event: HarnessStreamEvent, turn: MessageTurn, targetSessionId?: string) {
    // R7 修复：seq 广播序号在入口统一记录——usage/traj 提前 return 的分支
    // 不再绕过（此前 lastSeq 永远落后真实广播序号，增量重连游标会失真）
    recordSeq(turn, event);

    // usage 是会话级事件（不挂在具体 turn 上），先行拦截更新上下文仪表
    if (event.type === "usage") {
      gauge.applyUsageEvent(event, targetSessionId);
      return;
    }

    // traj 是 turn 级轨迹事件：实时追加到当前 assistant turn（对齐 dsh 轨迹随 turn 生长）
    if (event.type === "traj") {
      if (!turn.trajEvents) turn.trajEvents = [];
      turn.trajEvents.push(event.event);
      return;
    }

    // TASK-114：text_delta 合帧——其余事件先 flush 已收文本（保块序）
    if (event.type === "text_delta") {
      let buffer = turnDeltaBuffers.get(turn);
      if (!buffer) {
        buffer = createDeltaBuffer({
          commit: (text) => {
            applyStreamEvent(
              turn,
              { type: "text_delta", delta: text } as HarnessStreamEvent,
              { isActiveSession: isActiveSession(targetSessionId) },
              { setPlanSteps: plan.setPlanSteps }
            );
          },
        });
        turnDeltaBuffers.set(turn, buffer);
      }
      buffer.push(event.delta);
      return;
    }

    flushTurnDelta(turn);
    applyStreamEvent(
      turn,
      event,
      { isActiveSession: isActiveSession(targetSessionId) },
      {
        setPlanSteps: plan.setPlanSteps,
      }
    );
  }

  /**
   * 接入/建立会话 SSE 流（支持全新发起与断线/切换会话重连）
   * 与原实现行为对应：后台执行不随连接断开而中断
   */
  async function connectToSessionStream(
    targetSessionId: string,
    targetTurn: MessageTurn,
    isPostChat: boolean,
    postBody?: ChatRequestBody
  ) {
    const abortCtrl = new AbortController();
    registry.markRunning(targetSessionId, abortCtrl);
    if (options.getActiveSessionId() === targetSessionId) {
      isRunning.value = true;
      activeAbortController.value = abortCtrl;
    }

    const startTime = Date.now();
    resetTurnDeltaBuffer(targetTurn); // 新连接新缓冲（同 turn 对象可能被重连复用）

    try {
      const { aborted } = await consumeSSEStream<HarnessStreamEvent>({
        open: () =>
          isPostChat
            ? openChatStream(postBody as ChatRequestBody)
            : openSessionStream(targetSessionId),
        signal: abortCtrl.signal,
        onEvent: (event) => handleStreamEvent(event, targetTurn, targetSessionId),
        onDone: () => {
          flushTurnDelta(targetTurn); // TASK-114：收尾前提交缓冲，全文完整
          targetTurn.isStreaming = false;
        },
      });
      if (aborted) {
        flushTurnDelta(targetTurn);
        // R1 修复：中止徽标呈现（aborted 事件已发时幂等），不再注入斜体假正文
        targetTurn.abortedReason ??= "user";
      }
    } catch (err: unknown) {
      flushTurnDelta(targetTurn); // 错误文案追加前先落账已收文本（顺序正确）
      const message = (err as { message?: string })?.message || String(err);
      targetTurn.content += `\n\n*(调用出错: ${message})*`;
    } finally {
      flushTurnDelta(targetTurn);
      resetTurnDeltaBuffer(targetTurn);
      targetTurn.isStreaming = false;
      targetTurn.thoughtDuration = Math.round((Date.now() - startTime) / 100) / 10;
      registry.markStopped(targetSessionId);
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
   * （会话创建前置逻辑留在视图层编排）
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
    registry.cacheTurns(opts.sessionId, chatTurns.value);
    // assistant turn 只能经 appendReactiveTurn 入列一次：它既完成追加又读回代理引用，
    // 这里再手动 push 会让同一 turn 出现两份（思考过程/正文双份渲染，R8 回归）
    const reactiveTurn = appendReactiveTurn(chatTurns, assistantTurn);
    // 用户刚发出消息：强制回底（无视钉底状态；两条 turn 均已入列后再滚）
    options.scrollToBottom({ force: true });
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

  // 中止编排（R1 顺序知识固化在 useTurnAbort）：镜像态收尾由 onStopped 回写
  const { stopExecution } = useTurnAbort({
    getActiveSessionId: options.getActiveSessionId,
    registry,
    onStopped: () => {
      isRunning.value = false;
      activeAbortController.value = null;
    },
  });

  return {
    chatTurns,
    planSteps: plan.planSteps,
    isPlanVisible: plan.isPlanVisible,
    isPlanExpanded: plan.isPlanExpanded,
    completedStepsCount: plan.completedStepsCount,
    currentRunningStep: plan.currentRunningStep,
    isRunning,
    activeAbortController,
    contextUsed: gauge.contextUsed,
    contextLimit: gauge.contextLimit,
    sessionTokensUsed: gauge.sessionTokensUsed,
    sessionTokensUsedMap: gauge.sessionTokensUsedMap,
    ctxParts: gauge.ctxParts,
    sessionTurnsCache: registry.sessionTurnsCache,
    sessionRunningMap: registry.sessionRunningMap,
    sessionAbortControllers: registry.sessionAbortControllers,
    resetTurns,
    sendPrompt,
    connectToSessionStream,
    stopExecution,
  };
}

export type ChatStreamApi = ReturnType<typeof useChatStream>;
