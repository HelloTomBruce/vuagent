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
  /**
   * L3 协作模式（Phase 3，设计文档 §2/§3）：模型显式置 true 才进入——
   * 挂起等待用户编辑，底部渲染「确认计划」（confirm，终态）与
   * 「放弃」（cancel，终态）出口；步骤编辑/重试照常经
   * update:steps / retry 事件由注册层转 patch / submit 信封。
   */
  collaborative?: boolean;
  /** 协作出口按钮禁用态（非挂起态时注册层不透传 collaborative，此处为双保险） */
  disabled?: boolean;
  /**
   * L3 patch/submit 被 server 422 拒绝的逐字段错误就地回显
   * （复用 form-errors 响应式通道，设计文档 §4.2 重填闭环——错误不唤醒模型）
   */
  fieldErrors?: Record<string, string>;
}

export interface AgentPlanEvents {
  "update:steps": [steps: PlanStep[]];
  retry: [step: PlanStep];
  /** 确认计划（L3 终态）：注册层转 submit 空 values 信封，server 合并此前 patch steps */
  confirm: [];
  /** 放弃计划（L3 终态）：注册层转 cancel 信封 */
  cancel: [];
}
