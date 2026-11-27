/**
 * 轮次中止编排（TASK-113 自 useChatStream.stopExecution 抽取）：
 * 固化 R1 修复的顺序知识——**先通知服务端中止**（hub 广播的 aborted 事件经当前
 * SSE 流送达 reducer 呈现徽标），**再**本地兜底断开；顺序颠倒会让 aborted 事件
 * 永远到不了前端，只剩假斜体文案。
 */
import { abortSession } from "../../api/client";
import type { useSessionRunRegistry } from "./useSessionRunRegistry";

export interface UseTurnAbortDeps {
  getActiveSessionId: () => string;
  registry: ReturnType<typeof useSessionRunRegistry>;
  /** 活跃会话镜像态回写（isRunning / activeAbortController 由调用方持有） */
  onStopped: () => void;
}

export function useTurnAbort(deps: UseTurnAbortDeps) {
  /**
   * 停止当前激活会话的运行：
   * 1. 通知服务端中止执行回环（aborted 事件经流送达）；
   * 2. 登记表标记停止；
   * 3. 本地 abort 兜底断开（事件已送达后的兜底手段）。
   */
  async function stopExecution(): Promise<void> {
    const currentSessionId = deps.getActiveSessionId();
    if (currentSessionId) {
      // 1. 通知服务端中止（aborted 事件经流送达 reducer）
      await abortSession(currentSessionId);
      // 2. 先取本地控制器引用（markStopped 会从登记表删除），标记停止
      const localController = deps.registry.getAbortController(currentSessionId);
      deps.registry.markStopped(currentSessionId);
      // 3. 本地 abort 兜底断开（事件已送达后的兜底手段）
      localController?.abort();
    }
    deps.onStopped();
  }

  return { stopExecution };
}
