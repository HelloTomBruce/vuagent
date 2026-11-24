import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

/**
 * 场景② 数据分析副驾：制定分析计划（只读）
 * 返回 ui_analysis_plan 卡片（内嵌 VaAgentPlan 只读渲染）
 */
export const AnalysisPlanTool: HarnessTool = {
  name: "analysis_plan_create",
  description: "针对指定分析主题制定一份分步数据分析计划（返回计划步骤卡片）",
  parameters: Type.Object({
    topic: Type.String({ description: "分析主题，例如 Q3 销售复盘" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const topic = String(ctx.args.topic || "Q3 销售复盘");
    return {
      rendered: true,
      component: "ui_analysis_plan",
      props: {
        topic,
        steps: [
          { id: "s1", title: "校验数据源", detail: "核对 orders / order_items 两表行数与时间边界", status: "done", duration: 420 },
          { id: "s2", title: "聚合核心指标", detail: "GMV、订单量、客单价按周聚合", status: "pending" },
          { id: "s3", title: "渠道拆解", detail: "按线上商城 / 小程序 / 门店 POS / 分销四渠道拆分", status: "pending" },
          { id: "s4", title: "生成分析报告", detail: "输出 KPI 趋势卡与渠道构成图", status: "pending" },
        ],
      },
    };
  },
};

/**
 * 场景② 数据分析副驾：执行分析并输出报告（只读）
 * 返回 ui_analysis_report 卡片（内嵌 VaKpiChart × 3 + VaBreakdownChart）
 */
export const AnalysisReportTool: HarnessTool = {
  name: "analysis_run_report",
  description: "执行数据分析并生成报告：KPI 趋势（GMV/订单量/客单价）与渠道构成拆解（内置仿真数据集）",
  parameters: Type.Object({
    topic: Type.Optional(Type.String({ description: "分析主题" })),
    period: Type.Optional(Type.String({ description: "统计周期，例如 2026-Q3" })),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const topic = String(ctx.args.topic || "Q3 销售复盘");
    const period = String(ctx.args.period || "2026-Q3");
    return {
      rendered: true,
      component: "ui_analysis_report",
      props: {
        topic,
        period,
        kpis: [
          {
            label: "季度 GMV（万元）",
            value: 1842,
            delta: 0.23,
            deltaLabel: "vs Q2",
            series: [102, 118, 126, 139, 133, 148, 155, 170, 166, 182, 194, 205],
          },
          {
            label: "订单量",
            value: 48620,
            delta: 0.15,
            deltaLabel: "vs Q2",
            series: [2900, 3050, 3320, 3480, 3410, 3690, 3950, 4100, 4020, 4380, 4450, 4870],
          },
          {
            label: "客单价（元）",
            value: 379,
            delta: 0.07,
            deltaLabel: "vs Q2",
            series: [351, 355, 358, 357, 362, 360, 366, 364, 369, 371, 374, 379],
          },
        ],
        breakdown: {
          total: 1842,
          unit: "万元",
          items: [
            { label: "线上商城", value: 862, color: "#c2410c" },
            { label: "小程序商城", value: 512, color: "#e8925e" },
            { label: "门店 POS", value: 298, color: "#d8b28a" },
            { label: "分销渠道", value: 170, color: "#b9a58c" },
          ],
        },
      },
    };
  },
};

export const analysisTools = [AnalysisPlanTool, AnalysisReportTool];
