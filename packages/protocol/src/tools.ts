/**
 * @vuagent/protocol
 * TypeBox 定义的共享 UI Tools Schema 与类型推导
 * 兼做大模型 Tool Parameters 规范和前端组件 Props 类型单一事实来源
 */

import { Type, type Static } from "@sinclair/typebox";

// ==========================================
// 1. 审批卡片工具 (ApprovalCard)
// ==========================================
export const ApprovalRiskSchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

export const ApprovalCardToolSchema = Type.Object(
  {
    title: Type.String({ description: "审批标题文案，例如'Agent 申请执行终端命令'" }),
    detail: Type.Optional(Type.String({ description: "补充背景或风险提示说明" })),
    risk: Type.Optional(ApprovalRiskSchema),
    preview: Type.Optional(Type.String({ description: "命令、代码或关键操作详情预览（等宽展示）" })),
    confirmLabel: Type.Optional(Type.String({ description: "批准按钮文案，默认为'批准'" })),
    denyLabel: Type.Optional(Type.String({ description: "拒绝按钮文案，默认为'拒绝'" })),
    countdown: Type.Optional(Type.Number({ description: "倒计时秒数，到期未确认自动拒绝；0 或不传表示不限时" })),
    shortcuts: Type.Optional(Type.Boolean({ description: "是否显示键盘快捷键提示 (Enter / Esc)" })),
  },
  {
    $id: "ui_approval_card",
    description: "涉及敏感操作或高风险动作时调用此工具，挂起并等待人工审批决策",
  }
);

export type ApprovalCardToolArgs = Static<typeof ApprovalCardToolSchema>;

// HITL 用户审批回传载荷
export const ApprovalActionPayloadSchema = Type.Object({
  approved: Type.Boolean({ description: "用户是否批准执行" }),
  reason: Type.Optional(
    Type.Union([Type.Literal("manual"), Type.Literal("timeout")], {
      description: "决策成因（人工操作或超时）",
    })
  ),
  note: Type.Optional(Type.String({ description: "人工填写的驳回原因或附加备注" })),
});

export type ApprovalActionPayload = Static<typeof ApprovalActionPayloadSchema>;

// ==========================================
// 2. 轨迹/台账工具 (Trajectory)
// ==========================================
export const TrajLaneSchema = Type.Union([
  Type.Literal("input"),
  Type.Literal("model"),
  Type.Literal("tool"),
]);

export const TrajRoleSchema = Type.Union([
  Type.Literal("user"),
  Type.Literal("assistant"),
  Type.Literal("tool"),
  Type.Literal("system"),
  Type.Literal("context"),
]);

export const TrajEventSchema = Type.Object({
  id: Type.String({ description: "事件唯一 ID" }),
  at: Type.Number({ description: "开始时间戳 (毫秒)" }),
  endAt: Type.Optional(Type.Number({ description: "结束时间戳 (毫秒)" })),
  lane: TrajLaneSchema,
  role: TrajRoleSchema,
  title: Type.String({ description: "正文片段或调用的工具名" }),
  detail: Type.Optional(Type.String({ description: "入参 JSON 或详细上下文" })),
  result: Type.Optional(Type.String({ description: "工具执行结果或错误信息" })),
  turn: Type.Number({ description: "属于第几轮对话 (从 1 开始)" }),
});

export const TrajectoryToolSchema = Type.Object(
  {
    events: Type.Array(TrajEventSchema, { description: "轨迹流中的事件集合" }),
    ledgerMaxHeight: Type.Optional(Type.Number({ description: "台账区最大高度 (px)" })),
  },
  {
    $id: "ui_trajectory",
    description: "多步骤复杂任务时展示三泳道执行时间线与台账流水",
  }
);

export type TrajectoryToolArgs = Static<typeof TrajectoryToolSchema>;
export type TrajEventItem = Static<typeof TrajEventSchema>;

// ==========================================
// 3. 代码 Diff 工具 (CodeDiff)
// ==========================================
export const CodeDiffToolSchema = Type.Object(
  {
    oldText: Type.String({ description: "原始内容文本" }),
    newText: Type.String({ description: "变更后的新文本" }),
    fileName: Type.Optional(Type.String({ description: "文件路径或文件名" })),
    context: Type.Optional(Type.Number({ description: "上下文折叠保留行数，默认 3" })),
    wordLevel: Type.Optional(Type.Boolean({ description: "是否开启词级别精细高亮" })),
    defaultExpandAll: Type.Optional(Type.Boolean({ description: "是否默认展开全部未变更行" })),
    maxHeight: Type.Optional(Type.Number({ description: "容器最大高度 px" })),
    layout: Type.Optional(
      Type.Union([Type.Literal("unified"), Type.Literal("side")], {
        description: "展示模式：unified 统一行模式，side 左右并排模式",
      })
    ),
  },
  {
    $id: "ui_code_diff",
    description: "向用户展示代码修改、文本配置变更或补丁对比",
  }
);

export type CodeDiffToolArgs = Static<typeof CodeDiffToolSchema>;

// ==========================================
// 4. 指标图表卡片工具 (MetricChart)
// ==========================================
export const MetricSeriesItemSchema = Type.Object({
  label: Type.String({ description: "数据项标签或时间点" }),
  value: Type.Number({ description: "具体数值" }),
});

export const MetricChartToolSchema = Type.Object(
  {
    title: Type.String({ description: "图表标题" }),
    chartType: Type.Union([Type.Literal("line"), Type.Literal("bar")], {
      description: "图表类型：line 折线图，bar 柱状图",
    }),
    unit: Type.Optional(Type.String({ description: "数值单位，如'ms'、'%'、'次'" })),
    series: Type.Array(MetricSeriesItemSchema, { description: "数据序列" }),
  },
  {
    $id: "ui_metric_chart",
    description: "展示统计趋势、KPI 指标、耗时或对比数据",
  }
);

export type MetricChartToolArgs = Static<typeof MetricChartToolSchema>;

// ==========================================
// 5. Agent 计划卡片工具 (AgentPlan)
// ==========================================
export const PlanStepStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("done"),
  Type.Literal("error"),
]);

export const PlanStepSchema = Type.Object({
  id: Type.String({ description: "步骤 ID" }),
  title: Type.String({ description: "步骤名称" }),
  detail: Type.Optional(Type.String({ description: "步骤详细说明" })),
  status: Type.Optional(PlanStepStatusSchema),
  startedAt: Type.Optional(Type.Number({ description: "执行开始时间戳" })),
  duration: Type.Optional(Type.Number({ description: "执行耗时毫秒" })),
});

export const AgentPlanToolSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ description: "执行计划标题" })),
    steps: Type.Array(PlanStepSchema, { description: "计划任务步骤列表" }),
    editable: Type.Optional(Type.Boolean({ description: "是否允许用户在界面编辑修改步骤" })),
  },
  {
    $id: "ui_agent_plan",
    description: "展示任务执行规划、待办清单或步骤进展",
  }
);

export type AgentPlanToolArgs = Static<typeof AgentPlanToolSchema>;
export type PlanStepItem = Static<typeof PlanStepSchema>;

// ==========================================
// 6. 文件树结构卡片工具 (FileTree)
// ==========================================
export const FileStatusSchema = Type.Union([
  Type.Literal("modified"),
  Type.Literal("added"),
  Type.Literal("deleted"),
  Type.Literal("untracked"),
]);

export const FileNodeSchema = Type.Recursive((This) =>
  Type.Object({
    path: Type.String({ description: "相对路径或文件名" }),
    type: Type.Optional(Type.Union([Type.Literal("file"), Type.Literal("dir")])),
    status: Type.Optional(FileStatusSchema),
    children: Type.Optional(Type.Array(This)),
  })
);

export const FileTreeToolSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ description: "文件树卡片标题，如'工作区文件列表'或'变更文件概览'" })),
    tree: Type.Array(FileNodeSchema, { description: "工作区目录树或文件节点数组" }),
    defaultExpandDepth: Type.Optional(Type.Number({ description: "默认展开层数，默认 1" })),
  },
  {
    $id: "ui_file_tree",
    description: "展示工作区代码目录结构、项目文件树或近期修改的文件列表",
  }
);

export type FileTreeToolArgs = Static<typeof FileTreeToolSchema>;

// ==========================================
// 工具 Schema 汇总映射表
// ==========================================
export const VuagentToolSchemas = {
  ui_approval_card: ApprovalCardToolSchema,
  ui_trajectory: TrajectoryToolSchema,
  ui_code_diff: CodeDiffToolSchema,
  ui_metric_chart: MetricChartToolSchema,
  ui_agent_plan: AgentPlanToolSchema,
  ui_file_tree: FileTreeToolSchema,
} as const;

export type VuagentToolName = keyof typeof VuagentToolSchemas;
