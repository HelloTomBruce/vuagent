/**
 * 上下文水位仪表（TASK-113 自 useChatStream 抽取）：
 * usage 事件 → 仪表状态归约。两条口径（踩坑知识固化）：
 * - **窗口占用口径**（contextUsed，与 Codex/Claude Code 一致）：promptTokens 是本步
 *   发送的全部上下文（ReAct 每步重发历史），取「最近一次调用」直接覆盖而非累加；
 * - **计费口径**（sessionTokensUsed / 按会话 Map）：跨步逐事件累加
 *   prompt+completion——usage.promptTokens 含重发历史，取 totalTokens 会虚增。
 * 多会话并行时后台会话的消耗按 id 归账，切回时秒级恢复。
 */
import { reactive, ref } from "vue";
import type { ContextPart } from "@vuagent/ui";

/**
 * usage 事件入参：结构化最小面（仪表只消费这些字段）。
 * 完整 protocol usage 事件天然满足该形状（调用方直接传事件即可）。
 */
interface UsageEventInput {
  promptTokens: number;
  completionTokens: number;
  contextWindow?: number;
  parts?: ContextPart[];
}

export function useContextGauge(getActiveSessionId: () => string) {
  const contextUsed = ref(0);
  const contextLimit = ref(128000);
  // 会话累计消耗（计费口径 = Σ各步 prompt+completion，与服务端 TelemetryLedger 同源）
  const sessionTokensUsed = ref(0);
  /** 每会话累计表：多会话并行时后台会话的消耗按 id 归账，切回时秒级恢复 */
  const sessionTokensUsedMap = reactive(new Map<string, number>());
  // 协议级分段估算（system/history/tools），由 usage 事件的 parts 驱动；
  // 无 parts（旧服务端/沙箱演示流）时由视图层降级为单段「对话历史」
  const ctxParts = ref<ContextPart[]>([]);

  /**
   * usage 事件归约（useChatStream.handleStreamEvent 的 usage 拦截分支原样平移）：
   * 窗口口径覆盖 + 计费口径累加 + 分段估算（无 parts 降级单段历史）。
   */
  function applyUsageEvent(event: UsageEventInput, targetSessionId?: string): void {
    contextUsed.value = event.promptTokens + event.completionTokens;
    // 累计消耗归账：逐事件累加 prompt+completion（计费口径）；后台会话按 id 记账
    const usageSessionId = targetSessionId || getActiveSessionId();
    sessionTokensUsedMap.set(
      usageSessionId,
      (sessionTokensUsedMap.get(usageSessionId) ?? 0) +
        event.promptTokens +
        event.completionTokens
    );
    if (!targetSessionId || targetSessionId === getActiveSessionId()) {
      sessionTokensUsed.value += event.promptTokens + event.completionTokens;
    }
    if (event.contextWindow) {
      contextLimit.value = event.contextWindow;
    }
    // 优先消费服务端分段（system/tools/history）；无 parts 时降级为单段历史
    ctxParts.value = event.parts?.length
      ? event.parts
      : [{ id: "history", label: "对话历史", tokens: contextUsed.value, kind: "history" }];
  }

  /** 新会话：仪表归零（等运行时 usage 事件按真实占用覆盖） */
  function reset(): void {
    contextUsed.value = 0;
    ctxParts.value = [];
    sessionTokensUsed.value = 0;
  }

  return {
    contextUsed,
    contextLimit,
    sessionTokensUsed,
    sessionTokensUsedMap,
    ctxParts,
    applyUsageEvent,
    reset,
  };
}
