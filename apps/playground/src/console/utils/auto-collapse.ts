/**
 * 完成后自动折叠判定（TASK-016，TASK-017 反馈修订）：思考过程 + 工具执行卡
 * - 纯函数、无 Vue 依赖，供 AssistantTurn / CardRenderer 消费，便于单测
 * - 只回答「默认态应该怎么开/收」；流式进行中用户手动展开/收起的状态由各组件的
 *   touched 哨兵保护，本模块不参与、不覆盖
 *
 * 修订语义：工具卡不再「各自完成各自收」，而是跟随整个 turn 的流式状态——
 * 输出期间保持展开，流结束（isStreaming true→false）与思考过程在同一时刻一并收起，
 * 最终只展示结论（用户反馈：逐卡收起显得零碎，期望整体一块折叠）。
 */
import type { InteractionSettings } from "../composables/useInteractionSettings";

/**
 * 思考过程：turn 流式结束（isStreaming 由 true→false 跳变）时是否自动折叠。
 * 调用方仅在跳变时刻消费一次；开关关闭时保持现状不动。
 */
export function shouldCollapseThoughtOnFinish(
  settings: Pick<InteractionSettings, "autoCollapseThought">
): boolean {
  return settings.autoCollapseThought === true;
}

/**
 * 统一过程折叠（用户反馈修订）：两项开关均开时，turn 结束后把「思考过程 + 工具调用卡片」
 * 整体收进一条「已完成 · 耗时 Ns · N 次工具调用」摘要条（文本结果保持可见），点击可展开。
 * 任一开关关闭时退回各自独立行为，不启用统一摘要条。
 */
export function shouldCollapseProcessOnFinish(
  settings: Pick<InteractionSettings, "autoCollapseThought" | "autoCollapseToolCards">
): boolean {
  return settings.autoCollapseThought === true && settings.autoCollapseToolCards === true;
}

/** 工具卡 defaultOpen 判定上下文 */
export interface ToolCardOpenContext {
  /** 所属 turn 是否仍在流式输出 */
  turnStreaming: boolean;
  /** 卡片生命周期状态："streaming" | "executing" | "done" | "error" */
  status?: string;
}

/**
 * 工具执行卡 defaultOpen 计算
 *
 * - 开关开（默认）：输出期间展开（streaming/executing/done 均展开），
 *   turn 流式结束时与思考过程一并收起（defaultOpen 随 turnStreaming 响应式翻转）；
 *   error 不在此展开——失败诊断由 VaToolCallCard 的 openOnError 恒展开兜底
 *   （含初始即 error 的 onMounted 路径；用户手动操作过后不强制干预）
 * - 开关关：保持原行为——streaming 展开、其余按组件默认
 */
export function toolCardDefaultOpen(
  settings: Pick<InteractionSettings, "autoCollapseToolCards">,
  ctx: ToolCardOpenContext
): boolean {
  if (settings.autoCollapseToolCards) {
    if (ctx.status === "error") return false;
    return ctx.turnStreaming;
  }
  return ctx.status === "streaming";
}
