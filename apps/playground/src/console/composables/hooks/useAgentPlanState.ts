/**
 * Agent 计划条状态（TASK-113 自 useChatStream 抽取）：
 * plan 事件 → 步骤列表 + 派生计数（完成数 / 运行中步骤）+ 展开态。
 * 纯数据域，视图渲染由 DockedPlanBar 消费。
 */
import { computed, ref } from "vue";
import type { PlanStep } from "../../types";

export function useAgentPlanState() {
  const planSteps = ref<PlanStep[]>([]);
  const isPlanExpanded = ref(true);
  const isPlanVisible = computed(() => planSteps.value.length > 0);
  const completedStepsCount = computed(() => {
    return planSteps.value.filter((s) => s.status === "done").length;
  });
  const currentRunningStep = computed(() => {
    return planSteps.value.find((s) => s.status === "running");
  });

  /** reducer sink 入口：计划事件到达时整表替换并保持展开（用户新计划可见） */
  function setPlanSteps(steps: PlanStep[]): void {
    planSteps.value = steps;
    isPlanExpanded.value = true;
  }

  function reset(): void {
    planSteps.value = [];
    isPlanExpanded.value = true;
  }

  return {
    planSteps,
    isPlanExpanded,
    isPlanVisible,
    completedStepsCount,
    currentRunningStep,
    setPlanSteps,
    reset,
  };
}
