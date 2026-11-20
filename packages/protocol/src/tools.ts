/**
 * @vuagent/protocol
 * TypeBox 定义的共享 UI Tools Schema 与类型推导
 * 兼做大模型 Tool Parameters 规范和前端组件 Props 类型单一事实来源
 */

import { Type, type Static } from "@sinclair/typebox";
import { VuagentSystemToolSchemas, type VuagentSystemToolName } from "./system-tools.js";

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
// 7. 任务看板卡片工具 (TaskBoard)
// ==========================================
export const BoardColumnSchema = Type.Object({
  id: Type.String({ description: "列 ID" }),
  title: Type.String({ description: "列标题，如'待办 / 进行中 / 已完成'" }),
  hint: Type.Optional(Type.String({ description: "列头徽标文案，缺省自动为列内任务数" })),
});

export const TaskPrioritySchema = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
]);

export const BoardTaskSchema = Type.Object({
  id: Type.String({ description: "任务 ID" }),
  columnId: Type.String({ description: "所属列 ID" }),
  title: Type.String({ description: "任务标题" }),
  assignee: Type.Optional(Type.String({ description: "负责人" })),
  priority: Type.Optional(TaskPrioritySchema),
  meta: Type.Optional(Type.String({ description: "截止/耗时等角标文案" })),
});

export const TaskBoardToolSchema = Type.Object(
  {
    columns: Type.Array(BoardColumnSchema, { description: "看板列定义" }),
    tasks: Type.Array(BoardTaskSchema, { description: "任务条目集合" }),
  },
  {
    $id: "ui_task_board",
    description: "把任务拆解/分工/状态流转展示为多列看板（列 + 任务卡）",
  }
);

export type TaskBoardToolArgs = Static<typeof TaskBoardToolSchema>;

// ==========================================
// 8. 变更摘要卡片工具 (ChangeSummary)
// ==========================================
export const SummaryFileSchema = Type.Object({
  path: Type.String({ description: "文件相对路径" }),
  status: Type.Optional(FileStatusSchema),
  additions: Type.Optional(Type.Number({ description: "新增行数" })),
  deletions: Type.Optional(Type.Number({ description: "删除行数" })),
});

export const ChangeSummaryToolSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ description: "本轮工作标题，如'重构用户列表页'" })),
    files: Type.Array(SummaryFileSchema, { description: "本轮变更的文件清单" }),
    duration: Type.Optional(Type.Number({ description: "总耗时毫秒" })),
    toolCalls: Type.Optional(Type.Number({ description: "使用的工具调用次数" })),
    finishedAt: Type.Optional(Type.Number({ description: "完成时间（毫秒时间戳）" })),
  },
  {
    $id: "ui_change_summary",
    description: "agent 一轮工作收尾时展示变更摘要卡：N 文件 +adds −dels、耗时与工具调用次数",
  }
);

export type ChangeSummaryToolArgs = Static<typeof ChangeSummaryToolSchema>;

// ==========================================
// 9. 评论线程卡片工具 (CommentThread)
// ==========================================
export const CommentItemSchema = Type.Object({
  id: Type.String({ description: "评论 ID" }),
  author: Type.String({ description: "作者名" }),
  avatar: Type.Optional(Type.String({ description: "头像图片地址，缺省用首字母色块" })),
  initials: Type.Optional(Type.String({ description: "首字母色块文案，缺省取 author 首字符" })),
  role: Type.Optional(Type.String({ description: "身份标注，如 'Agent' / '工程师'" })),
  text: Type.String({ description: "评论正文（保留换行）" }),
  createdAt: Type.Optional(Type.Number({ description: "创建时间（毫秒时间戳）" })),
  pending: Type.Optional(
    Type.Boolean({ description: "agent 起草待审条目（展示采纳/重写操作条）" })
  ),
});

export const CommentThreadToolSchema = Type.Object(
  {
    comments: Type.Array(CommentItemSchema, { description: "评论线程（含 agent 草稿条目）" }),
    maxHeight: Type.Optional(Type.Number({ description: "线程最大高度 px，超出滚动" })),
  },
  {
    $id: "ui_comment_thread",
    description: "展示 agent 起草的评论/评审意见线程，待审条目与正式评论视觉区分",
  }
);

export type CommentThreadToolArgs = Static<typeof CommentThreadToolSchema>;

// ==========================================
// 10. 引用回答卡片工具 (AiAnswer)
// ==========================================
export const AnswerSourceSchema = Type.Object({
  id: Type.String({ description: "来源 ID，与正文 [n] 角标对应" }),
  title: Type.String({ description: "来源标题，如'Vuagent 文档 · 快速开始'" }),
  url: Type.Optional(Type.String({ description: "链接，不设则为纯文本来源" })),
  origin: Type.Optional(Type.String({ description: "域名/出处短标，如 'vuagent.dev'" })),
});

export const AiAnswerToolSchema = Type.Object(
  {
    question: Type.Optional(Type.String({ description: "用户问题（小字展示在答案上方）" })),
    answer: Type.String({
      description: "回答正文；支持引用标记 [1] [2]（与 sources 下标对应）渲染为可点击上标角标",
    }),
    sources: Type.Array(AnswerSourceSchema, { description: "引用来源列表" }),
  },
  {
    $id: "ui_ai_answer",
    description: "结论性回答需要给出引用出处时使用：正文角标 + 来源列表",
  }
);

export type AiAnswerToolArgs = Static<typeof AiAnswerToolSchema>;

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
  ui_task_board: TaskBoardToolSchema,
  ui_change_summary: ChangeSummaryToolSchema,
  ui_comment_thread: CommentThreadToolSchema,
  ui_ai_answer: AiAnswerToolSchema,
} as const;

export type VuagentToolName = keyof typeof VuagentToolSchemas;

/**
 * 全量工具聚合（TASK-055 工具契约收口）：ui_* + 系统工具。
 * VuagentToolName 保持 ui 组件名子集语义（UiComponentRenderResult.component 消费）；
 * 需要覆盖全部工具名时使用 VuagentAllToolName。
 */
export const AllToolSchemas = {
  ...VuagentToolSchemas,
  ...VuagentSystemToolSchemas,
} as const;

export type VuagentAllToolName = VuagentToolName | VuagentSystemToolName;
