import {
  ApprovalCardToolSchema,
  TrajectoryToolSchema,
  CodeDiffToolSchema,
  MetricChartToolSchema,
  AgentPlanToolSchema,
  FileTreeToolSchema,
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
  execute: async (ctx) => {
    return {
      rendered: true,
      component: "ui_trajectory",
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
];
