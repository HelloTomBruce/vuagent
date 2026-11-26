/**
 * @vuagent/ui - 协作计划 steps 镜像（评审 R1 修复）
 *
 * VaAgentPlan 是纯 props 驱动组件：用户编辑 emit update:steps 后，若不把
 * 编辑结果回写到 props，下一次编辑仍从**原始 args.steps** 计算——前一次
 * patch 的增量被静默覆盖（连续编辑丢失数据，server 侧 PatchStash 同样只
 * 收到最后一次）。本模块按 toolCallId 保存「最近一次已发送的 steps」，
 * propAdapter 读取镜像作为渲染输入（在 activeProps computed 内读取即注册
 * 响应依赖，写入自动驱动回显）；终态/消息换血时清理。
 */

import { reactive } from "vue";

export const planStepsMirror = reactive(new Map<string, unknown[]>());

export function getPlanStepsMirror(toolCallId: string): unknown[] | undefined {
  return planStepsMirror.get(toolCallId);
}

export function setPlanStepsMirror(toolCallId: string, steps: readonly unknown[]): void {
  planStepsMirror.set(toolCallId, steps.map((s) => ({ ...(s as Record<string, unknown>) })));
}

export function clearPlanStepsMirror(toolCallId: string): void {
  planStepsMirror.delete(toolCallId);
}

export function clearAllPlanStepsMirrors(): void {
  planStepsMirror.clear();
}
