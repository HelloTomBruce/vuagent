import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

const PLAN_STEPS = [
  { id: "s1", title: "校验数据源", detail: "核对 orders / order_items 两表行数与时间边界" },
  { id: "s2", title: "聚合核心指标", detail: "GMV、订单量、客单价按周聚合" },
  { id: "s3", title: "渠道拆解", detail: "按线上商城 / 小程序 / 门店 POS / 分销四渠道拆分" },
  { id: "s4", title: "异常检测", detail: "对周环比波动超过 ±15% 的指标标记异常并归因" },
  { id: "s5", title: "生成分析报告", detail: "输出 KPI 趋势卡、渠道构成图与异常清单" },
];

/**
 * 场景② 数据分析副驾：制定分析计划（只读预览，步骤全部 pending）
 */
export const AnalysisPlanTool: HarnessTool = {
  name: "analysis_plan_create",
  description: "针对指定分析主题制定一份分步数据分析计划（返回计划预览卡，步骤待执行）",
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
      props: { topic, phase: "preview", steps: PLAN_STEPS.map((s) => ({ ...s, status: "pending" })) },
    };
  },
};

/**
 * 场景② 数据分析副驾：执行计划（与 plan_create 同卡片、不同状态——同组件状态演进）
 * 返回全部 done 的计划卡，含每步耗时，形成「预览 → 执行」的叙事闭环。
 */
export const AnalysisExecutePlanTool: HarnessTool = {
  name: "analysis_execute_plan",
  description: "执行已制定的分析计划，返回带完成状态与每步耗时的计划卡。通常在 analysis_plan_create 之后调用。",
  parameters: Type.Object({
    topic: Type.Optional(Type.String({ description: "分析主题" })),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const topic = String(ctx.args.topic || "Q3 销售复盘");
    const durations = [420, 1860, 1240, 980, 1500];
    return {
      rendered: true,
      component: "ui_analysis_plan",
      props: {
        topic,
        phase: "executed",
        steps: PLAN_STEPS.map((s, i) => ({ ...s, status: "done", duration: durations[i] })),
      },
    };
  },
};

/**
 * 场景② 数据分析副驾：执行分析并输出报告（KPI 趋势 + 渠道构成 + 异常清单）
 */
export const AnalysisReportTool: HarnessTool = {
  name: "analysis_run_report",
  description: "执行数据分析并生成报告：KPI 趋势、渠道构成拆解与异常检测结果（内置仿真数据集）。报告卡支持按维度下钻，可继续调用 analysis_drilldown。",
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
          {
            label: "退货率",
            value: 4.2,
            delta: -0.12,
            invertDelta: true,
            deltaLabel: "vs Q2（越低越好）",
            series: [5.6, 5.4, 5.2, 5.3, 5.0, 4.9, 4.8, 4.7, 4.6, 4.4, 4.3, 4.2],
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
        anomalies: [
          { metric: "GMV", severity: "high", message: "第 11-12 周 GMV 环比跳涨 +18%", suggestion: "与「周年庆大促」投放档期吻合，属预期内放量" },
          { metric: "门店 POS", severity: "medium", message: "华北区域连续 3 周下滑 −7%", suggestion: "建议按区域下钻核对门店开关店与竞品动作" },
        ],
      },
    };
  },
};

/**
 * 场景② 数据分析副驾：维度下钻（报告卡「下钻」按钮驱动的交互回传）
 */
export const AnalysisDrilldownTool: HarnessTool = {
  name: "analysis_drilldown",
  description: "按指定维度下钻分析明细：SKU / 区域 / 渠道 / 时间，返回明细表卡片。通常由报告卡的下钻按钮触发。",
  parameters: Type.Object({
    dimension: Type.String({ description: "下钻维度：sku / region / channel / week 之一" }),
    topic: Type.Optional(Type.String({ description: "分析主题" })),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const dimension = String(ctx.args.dimension || "region");
    const topic = String(ctx.args.topic || "Q3 销售复盘");

    const DATASETS: Record<string, { columns: string[]; rows: (string | number)[][]; footnote: string }> = {
      sku: {
        columns: ["SKU", "品类", "GMV（万元）", "环比", "退货率"],
        rows: [
          ["SKU-1024 智能保温杯 Pro", "家居", 286, "+41%", "2.1%"],
          ["SKU-2077 无线降噪耳机 X3", "数码", 241, "+66%", "3.8%"],
          ["SKU-3310 儿童学习桌 S2", "家居", 198, "+12%", "5.2%"],
          ["SKU-4096 轻便折叠单车", "出行", 154, "−9%", "7.6%"],
          ["SKU-5120 都市通勤背包", "服饰", 133, "+22%", "4.4%"],
        ],
        footnote: "Top 5 SKU 合计占季度 GMV 55%；折叠单车为唯一负增长单品，主因竞品降价 15%",
      },
      region: {
        columns: ["区域", "GMV（万元）", "环比", "门店数", "动销率"],
        rows: [
          ["华东", 613, "+31%", 42, "88%"],
          ["华南", 486, "+24%", 35, "85%"],
          ["华北", 342, "−7%", 28, "71%"],
          ["西南", 231, "+18%", 19, "82%"],
          ["其他", 170, "+9%", 22, "78%"],
        ],
        footnote: "华北为唯一负增长区域：3 家门店装修闭店 + 竞品开业 2 家，建议结合区域下钻复核",
      },
      channel: {
        columns: ["渠道", "GMV（万元）", "环比", "新客占比", "客单价"],
        rows: [
          ["线上商城", 862, "+27%", "34%", 402],
          ["小程序商城", 512, "+38%", "41%", 288],
          ["门店 POS", 298, "−7%", "12%", 466],
          ["分销渠道", 170, "+15%", "58%", 213],
        ],
        footnote: "小程序增速最快且新客占比最高，建议追加投放；分销客单价低但走量稳定",
      },
      week: {
        columns: ["周", "GMV（万元）", "订单量", "环比", "备注"],
        rows: [
          ["W27", 148, "3,920", "+8%", "—"],
          ["W28", 155, "3,960", "+5%", "—"],
          ["W29", 170, "4,110", "+10%", "会员日活动"],
          ["W30", 166, "4,020", "−2%", "台风闭店 2 天"],
          ["W31", 182, "4,380", "+10%", "新品首发"],
          ["W32", 194, "4,450", "+7%", "—"],
          ["W33-34", 411, "9,340", "+18%", "周年庆大促"],
          ["W35", 216, "5,120", "—", "大促长尾"],
        ],
        footnote: "大促两周贡献季度 GMV 22%；W30 台风闭店为唯一外生干扰点",
      },
    };

    const data = DATASETS[dimension] ?? DATASETS.region;
    return {
      rendered: true,
      component: "ui_analysis_table",
      props: { topic, dimension, ...data },
    };
  },
};

export const analysisTools = [AnalysisPlanTool, AnalysisExecutePlanTool, AnalysisReportTool, AnalysisDrilldownTool];
