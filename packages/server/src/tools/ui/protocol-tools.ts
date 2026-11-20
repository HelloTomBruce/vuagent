import {
  ApprovalCardToolSchema,
  TrajectoryToolSchema,
  CodeDiffToolSchema,
  MetricChartToolSchema,
  AgentPlanToolSchema,
  FileTreeToolSchema,
  TaskBoardToolSchema,
  ChangeSummaryToolSchema,
  CommentThreadToolSchema,
  AiAnswerToolSchema,
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
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_approval_card",
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
