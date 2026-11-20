import type { FinishTaskParams } from "@vuagent/protocol";

/**
 * 显式终态协议（finish_task）共享常量与默认交付断言。
 *
 * 三种轮次收尾形态（finishReason 口径）：
 * - explicit：模型调用 finish_task 且通过交付断言（enforced 模式）；
 * - natural：模型自然停机（不再调用工具；off 模式的默认路径 / enforced 模式的兜底）；
 * - truncated：达到 maxSteps 步数上限强制收尾。
 */

export const FINISH_TASK_TOOL_NAME = "finish_task";

/** 交付断言输入：finish_task 自述 + 轮次累积的实质产出画像 */
export interface DeliverableAssertionInput {
  args: Partial<FinishTaskParams>;
  /** 本轮已累积的正文输出（跨步） */
  content: string;
  /** 本轮已累积的卡片数（工具调用链 / 审批 / 终端 / ui 卡） */
  cardCount: number;
  /** 已执行步数 */
  stepCount: number;
}

export type DeliverableVerdict = { ok: true } | { ok: false; reason: string };

/**
 * 可插拔交付断言契约（AgentLoopServices.deliverableAssertion）：
 * 业务可按场景验收「是否产出实质性内容」（文本长度 / 卡片 / 特定产物存在性）。
 */
export type DeliverableAssertion = (input: DeliverableAssertionInput) => DeliverableVerdict;

/**
 * 默认断言：本轮必须存在非空正文输出或至少一张卡片——防空跑的最小守卫。
 */
export const defaultDeliverableAssertion: DeliverableAssertion = (input) => {
  const hasContent = input.content.trim().length > 0;
  const hasCards = input.cardCount > 0;
  if (hasContent || hasCards) return { ok: true };
  return {
    ok: false,
    reason:
      "本轮没有产生任何实质性输出（正文为空且无任何卡片/工具产物）。请继续执行任务、产出用户可见的结果，而不是空转收尾。",
  };
};
