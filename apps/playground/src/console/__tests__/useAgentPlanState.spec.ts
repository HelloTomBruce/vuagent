import { describe, expect, it } from "vitest";
import { useAgentPlanState } from "../composables/hooks/useAgentPlanState";
import type { PlanStep } from "../types";

const step = (id: string, status: PlanStep["status"]): PlanStep =>
  ({ id, title: id, status }) as PlanStep;

describe("useAgentPlanState（TASK-113）", () => {
  it("派生计数：完成数与运行中步骤", () => {
    const plan = useAgentPlanState();
    plan.setPlanSteps([
      step("a", "done"),
      step("b", "running"),
      step("c", "pending"),
    ]);
    expect(plan.isPlanVisible.value).toBe(true);
    expect(plan.completedStepsCount.value).toBe(1);
    expect(plan.currentRunningStep.value?.id).toBe("b");
  });

  it("setPlanSteps 保持展开（新计划可见）；reset 清空", () => {
    const plan = useAgentPlanState();
    plan.isPlanExpanded.value = false;
    plan.setPlanSteps([step("a", "pending")]);
    expect(plan.isPlanExpanded.value).toBe(true);

    plan.reset();
    expect(plan.planSteps.value).toEqual([]);
    expect(plan.isPlanVisible.value).toBe(false);
  });
});
