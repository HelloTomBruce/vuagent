/** VaAgentPlan 的类型定义 */

export type PlanStepStatus = "pending" | "running" | "done" | "error";

export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  status?: PlanStepStatus;
  /** running 态的计时起点（ms 时间戳） */
  startedAt?: number;
  /** done 态的最终耗时 ms */
  duration?: number;
}

export interface AgentPlanProps {
  steps: PlanStep[];
  /** 审阅编辑模式：可重命名 / 排序 / 增删步骤 */
  editable?: boolean;
  title?: string;
}

export interface AgentPlanEvents {
  "update:steps": [steps: PlanStep[]];
  retry: [step: PlanStep];
}
