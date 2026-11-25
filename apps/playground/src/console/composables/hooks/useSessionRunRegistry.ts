/**
 * 会话级多任务运行登记表（TASK-113 自 useChatStream 抽取）：
 * 多会话并行后台执行的状态面——哪个会话在跑 / 各自的本地中止控制器 /
 * 会话级 turns 缓存（切回秒级恢复）/ 活跃性判定。
 *
 * 附带 appendReactiveTurn：Vue 响应式数组的「代理陷阱」防线——
 * 直接改 push 进数组的原始对象会绕过 proxy 导致流式期间界面不更新，
 * 必须从数组读回代理引用交给流处理器（原 useChatStream L247-250 的坑位知识固化）。
 */
import { reactive } from "vue";
import type { Ref } from "vue";
import type { MessageTurn } from "../../types";

export function useSessionRunRegistry(getActiveSessionId: () => string) {
  const sessionRunningMap = reactive(new Map<string, boolean>());
  const sessionAbortControllers = new Map<string, AbortController>();
  const sessionTurnsCache = new Map<string, MessageTurn[]>();

  /** 活跃性判定：事件是否属于当前正查看的会话（缺省 = 未指定时视为活跃） */
  function isActiveSession(targetSessionId?: string): boolean {
    return !targetSessionId || targetSessionId === getActiveSessionId();
  }

  /** 登记会话进入运行态（含本地中止控制器） */
  function markRunning(sessionId: string, controller: AbortController): void {
    sessionRunningMap.set(sessionId, true);
    sessionAbortControllers.set(sessionId, controller);
  }

  /** 登记会话退出运行态（服务端确认中止 / 流收尾） */
  function markStopped(sessionId: string): void {
    sessionRunningMap.set(sessionId, false);
    sessionAbortControllers.delete(sessionId);
  }

  /** 缓存会话的 turns 引用（切换会话时秒级恢复内容） */
  function cacheTurns(sessionId: string, turns: MessageTurn[]): void {
    sessionTurnsCache.set(sessionId, turns);
  }

  /** 读取会话的本地中止控制器（stopExecution 兜底断开用） */
  function getAbortController(sessionId: string): AbortController | undefined {
    return sessionAbortControllers.get(sessionId);
  }

  return {
    sessionRunningMap,
    sessionAbortControllers,
    sessionTurnsCache,
    isActiveSession,
    markRunning,
    markStopped,
    cacheTurns,
    getAbortController,
  };
}

/**
 * 向响应式数组追加元素并返回数组内的代理引用。
 * 流处理器必须持有代理引用而非原始对象——否则字段变更不触发依赖更新
 * （详见文件头注释）。
 */
export function appendReactiveTurn<T>(list: Ref<T[]>, turn: T): T {
  list.value.push(turn);
  return list.value[list.value.length - 1];
}
