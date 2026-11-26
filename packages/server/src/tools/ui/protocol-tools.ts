import {
  ApprovalCardToolSchema,
  TrajectoryToolSchema,
  CodeDiffToolSchema,
  MetricChartToolSchema,
  AgentPlanToolSchema,
  PlanCollabResultSchema,
  FileTreeToolSchema,
  TaskBoardToolSchema,
  ChangeSummaryToolSchema,
  CommentThreadToolSchema,
  AiAnswerToolSchema,
  FormToolSchema,
  coerceFormFields,
  deriveFormResultSchema,
  liftFormResultSchema,
} from "@vuagent/protocol";
import type { HarnessTool } from "../../core/types.js";

/**
 * 契约工具集合：直接复用 @vuagent/protocol 中的 TypeBox 规范
 * 这类工具用于模型向客户端 UI 发起结构化组件渲染
 */
export const UIApprovalCardTool: HarnessTool = {
  name: "ui_approval_card",
  description: "敏感高风险操作审批卡片，挂起并等待人工决策",
  parameters: ApprovalCardToolSchema,
  riskLevel: "high",
  requiresApproval: true,
  writesWorkspace: false, // 纯渲染契约工具，无工作区副作用
  // TASK-089：L1 决策型交互声明（设计文档 §2）——回传按信封契约解析，
  // 批准路径的工具结果走「语义摘要 + JSON 附录」双层 content。
  interaction: { level: "L1", timeoutMeaning: "deny" },
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_approval_card",
      props: ctx.args,
    };
  },
};

/**
 * TASK-092（实施方案 TASK-E）：ui_form——L2 值采集首个落地组件（设计文档 §7）。
 *
 * 关键语义：
 * - **无审批挂起**：requiresApproval=false、riskLevel=low——挂起由 interaction.level="L2"
 *   驱动（执行器识别 L2 直接 actionHub.waitForAction），与 HITL 审批守卫完全解耦
 *   （「L2 挂起≠审批」：tool-guards 的 approvalDecision 不命中本工具，任何权限模式下
 *   都直接进入挂起等待填写，不产生审批卡）；
 * - **resultSchema 不允许模型声明**：由 deriveResultSchema 按模型入参 fields 推导
 *   （设计文档 §7：fields 是输入、resultSchema 是推导结果，防止模型自定义 resultSchema
 *   放宽校验）；liftFormResultSchema 把普通 JSON 提升为 TypeBox 供边界校验同口径消费；
 * - **secret 通道**：字段 secret:true 的回传值在路由边界剥离入 secret store，
 *   模型上下文/台账/落库只见 { ref, masked } 占位（设计文档 §5）。
 * 注：execute 在正常链路不会到达——L2 挂起路径以 earlyResult 短路沙箱执行
 * （工具结果 = 用户提交的摘要，而非渲染回执）；保留 execute 仅为契约形状完整。
 */
export const UIFormTool: HarnessTool = {
  name: "ui_form",
  description:
    "需要用户补充结构化信息（参数、配置、凭证）时调用：渲染表单并挂起等待填写提交",
  parameters: FormToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false, // 纯渲染契约工具，无工作区副作用
  interaction: {
    level: "L2",
    timeoutMeaning: "cancel",
    deriveResultSchema: (args) =>
      liftFormResultSchema(deriveFormResultSchema(coerceFormFields(args?.fields))),
  },
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_form",
      props: ctx.args,
    };
  },
};

export const UICodeDiffTool: HarnessTool = {
  name: "ui_code_diff",
  description: "展示代码或配置文件修改的前后差异对比 (Diff)",
  parameters: CodeDiffToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_code_diff",
      props: ctx.args,
    };
  },
};

export const UIMetricChartTool: HarnessTool = {
  name: "ui_metric_chart",
  description: "展示业务统计指标、耗时监控或趋势图表",
  parameters: MetricChartToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_metric_chart",
      props: ctx.args,
    };
  },
};

export const UIAgentPlanTool: HarnessTool = {
  name: "ui_agent_plan",
  description: "展示任务执行步骤规划与实时进展清单",
  parameters: AgentPlanToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  /**
   * Phase 3（L3 patch 运行时，设计文档 §2/§8）：collaborative 协作声明——
   * interaction 恒为 L3，但挂起由模型入参 collaborative 驱动（执行器识别
   * `parsedArgs.collaborative === true` 才 waitForAction；缺省 false 保持
   * 纯展示逐字节不变）。patch 增量不唤醒协程、不进模型上下文（服务端
   * PatchStash 暂存，§8 patch 风暴防线），终态由显式 submit/cancel/超时触发。
   * 回传值按 PlanCollabResultSchema 边界校验（patch/submit 同口径）。
   */
  interaction: {
    level: "L3",
    timeoutMeaning: "cancel",
    resultSchema: PlanCollabResultSchema,
  },
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_agent_plan",
      props: ctx.args,
    };
  },
};

export const UIFileTreeTool: HarnessTool = {
  name: "ui_file_tree",
  description: "展示工作区代码目录树或变更文件结构",
  parameters: FileTreeToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_file_tree",
      props: ctx.args,
    };
  },
};

export const UITrajectoryTool: HarnessTool = {
  name: "ui_trajectory",
  description: "展示多泳道时序台账与事件流水线",
  parameters: TrajectoryToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_trajectory",
      props: ctx.args,
    };
  },
};

export const UITaskBoardTool: HarnessTool = {
  name: "ui_task_board",
  description: "把任务拆解、分工与状态流转展示为多列看板（列 + 任务卡）",
  parameters: TaskBoardToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false, // 纯渲染契约工具，无工作区副作用
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_task_board",
      props: ctx.args,
    };
  },
};

export const UIChangeSummaryTool: HarnessTool = {
  name: "ui_change_summary",
  description: "一轮工作收尾时展示变更摘要卡：文件清单、增删行数、耗时与工具调用次数",
  parameters: ChangeSummaryToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_change_summary",
      props: ctx.args,
    };
  },
};

export const UICommentThreadTool: HarnessTool = {
  name: "ui_comment_thread",
  description: "展示 agent 起草的评论/评审意见线程，待审条目与正式评论视觉区分",
  parameters: CommentThreadToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_comment_thread",
      props: ctx.args,
    };
  },
};

export const UIAiAnswerTool: HarnessTool = {
  name: "ui_ai_answer",
  description: "结论性回答需要给出引用出处时使用：正文 [1][2] 角标 + 来源列表",
  parameters: AiAnswerToolSchema,
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_ai_answer",
      props: ctx.args,
    };
  },
};

export const AllBuiltinTools: HarnessTool[] = [
  UIApprovalCardTool,
  UIFormTool,
  UICodeDiffTool,
  UIMetricChartTool,
  UIAgentPlanTool,
  UIFileTreeTool,
  UITrajectoryTool,
  UITaskBoardTool,
  UIChangeSummaryTool,
  UICommentThreadTool,
  UIAiAnswerTool,
];
