/**
 * @vuagent/protocol
 * HarnessStreamEvent 的 TypeBox Schema —— 事件契约的唯一事实来源（TASK-053）
 *
 * stream.ts 的 HarnessStreamEvent 类型由本文件 Static<> 推导（消除手写 interface
 * 与 schema 的双事实来源漂移）。SSE 是序列化边界：服务端漏字段/类型漂移在此
 * 被运行时校验拦截，而非前端 reducer 静默错乱。
 *
 * 校验策略：默认非严格（不设 additionalProperties:false）——服务端新增字段对
 * 旧校验器前向兼容；字段漏发/类型错发立即拒绝。
 *
 * 生产运行时路径（StreamOrchestrator.formatSSE）不挂校验（零开销）；校验供
 * 测试契约回归与下游消费方自行把关。
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TrajLaneSchema, TrajRoleSchema, PlanStepStatusSchema } from "./tools.js";

// ==========================================
// 共享子结构
// ==========================================

export const UsageContextPartSchema = Type.Object({
  id: Type.String(),
  /** 悬停 tooltip 的分段名称，如 "系统提示" */
  label: Type.String(),
  tokens: Type.Number(),
  kind: Type.Union([
    Type.Literal("system"),
    Type.Literal("history"),
    Type.Literal("tools"),
  ]),
});

export type UsageContextPart = Static<typeof UsageContextPartSchema>;

/** traj 事件内联轨迹形状（与 tools.ts TrajEventSchema 的差异：多 durationMs 可选字段） */
const TrajStreamEventSchema = Type.Object({
  id: Type.String(),
  at: Type.Number(),
  endAt: Type.Optional(Type.Number()),
  lane: TrajLaneSchema,
  role: TrajRoleSchema,
  title: Type.String(),
  detail: Type.Optional(Type.String()),
  result: Type.Optional(Type.String()),
  turn: Type.Number(),
  durationMs: Type.Optional(Type.Number()),
});

// ==========================================
// 逐事件 Schema（type literal 判别）
// ==========================================

export const ThoughtDeltaEventSchema = Type.Object({
  type: Type.Literal("thought_delta"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  messageId: Type.Optional(Type.String()),
  delta: Type.String(),
});

export const TextDeltaEventSchema = Type.Object({
  type: Type.Literal("text_delta"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  messageId: Type.String(),
  delta: Type.String(),
});

export const UiAgentPlanEventSchema = Type.Object({
  type: Type.Literal("ui_agent_plan"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  title: Type.String(),
  steps: Type.Array(
    Type.Object({
      id: Type.String(),
      title: Type.String(),
      status: PlanStepStatusSchema,
      duration: Type.Optional(Type.Number()),
      startedAt: Type.Optional(Type.Number()),
    })
  ),
});

export const UiCodeDiffEventSchema = Type.Object({
  type: Type.Literal("ui_code_diff"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  file: Type.String(),
  oldCode: Type.String(),
  newCode: Type.String(),
  additions: Type.Optional(Type.Number()),
  deletions: Type.Optional(Type.Number()),
});

export const UiTerminalLogEventSchema = Type.Object({
  type: Type.Literal("ui_terminal_log"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  title: Type.Optional(Type.String()),
  lines: Type.Array(
    Type.Object({
      text: Type.String(),
      kind: Type.Optional(
        Type.Union([
          Type.Literal("cmd"),
          Type.Literal("stdout"),
          Type.Literal("stderr"),
          Type.Literal("ok"),
          Type.Literal("warn"),
        ])
      ),
    })
  ),
});

export const UiMetricChartEventSchema = Type.Object({
  type: Type.Literal("ui_metric_chart"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  title: Type.Optional(Type.String()),
  points: Type.Array(
    Type.Object({
      time: Type.String(),
      value: Type.Number(),
    })
  ),
});

export const ToolCallStartEventSchema = Type.Object({
  type: Type.Literal("tool_call_start"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  messageId: Type.String(),
  toolCallId: Type.String(),
  toolName: Type.String(),
});

export const ToolCallArgsDeltaEventSchema = Type.Object({
  type: Type.Literal("tool_call_args_delta"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  toolCallId: Type.String(),
  partialArgs: Type.Record(Type.String(), Type.Unknown()),
});

export const ToolCallExecutingEventSchema = Type.Object({
  type: Type.Literal("tool_call_executing"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  toolCallId: Type.String(),
  toolName: Type.String(),
  args: Type.Record(Type.String(), Type.Unknown()),
});

export const ToolCallResultEventSchema = Type.Object({
  type: Type.Literal("tool_call_result"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  toolCallId: Type.String(),
  toolName: Type.String(),
  status: Type.Union([Type.Literal("done"), Type.Literal("error")]),
  data: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
});

export const UsageEventSchema = Type.Object({
  type: Type.Literal("usage"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  /** 本步发送的全部上下文（含重发历史）——窗口占用口径，非跨步累加的计费口径 */
  promptTokens: Type.Number(),
  /** 本步模型输出 token */
  completionTokens: Type.Number(),
  /** promptTokens + completionTokens（本步完成后的上下文占用） */
  totalTokens: Type.Number(),
  /** 生效模型配置声明的上下文窗口（若有） */
  contextWindow: Type.Optional(Type.Number()),
  /** 协议级分段估算（system/history/tools），前端仪表据此渲染分段格子；旧版本服务端可缺省 */
  parts: Type.Optional(Type.Array(UsageContextPartSchema)),
});

export const SuspendedEventSchema = Type.Object({
  type: Type.Literal("suspended"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  actionId: Type.String(),
  toolName: Type.String(),
  args: Type.Record(Type.String(), Type.Unknown()),
  timeoutMs: Type.Number(),
});

export const TrajStreamEnvelopeSchema = Type.Object({
  type: Type.Literal("traj"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  /** 单条轨迹事件（对齐 dsh 三泳道台账），实时追加到当前 assistant turn */
  event: TrajStreamEventSchema,
});

export const ResumedEventSchema = Type.Object({
  type: Type.Literal("resumed"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  actionId: Type.String(),
  payload: Type.Unknown(),
});

export const TurnEndEventSchema = Type.Object({
  type: Type.Literal("turn_end"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  stepCount: Type.Number(),
  durationMs: Type.Number(),
});

/** TASK-054：轮次开始控制事件（先于首个数据事件，前端据此进入 loading 态） */
export const TurnStartEventSchema = Type.Object({
  type: Type.Literal("turn_start"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  turnId: Type.String(),
  startedAt: Type.Number(),
});

/** TASK-054：中止控制事件（取代假 text_delta 斜体文案；reason 对齐看门狗/顶替/恢复标记） */
export const AbortedEventSchema = Type.Object({
  type: Type.Literal("aborted"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  turnId: Type.Optional(Type.String()),
  reason: Type.Union([
    Type.Literal("user"),
    Type.Literal("timeout"),
    Type.Literal("preempt"),
    Type.Literal("process_restart"),
  ]),
});

export const ErrorEventSchema = Type.Object({
  type: Type.Literal("error"),
  seq: Type.Optional(Type.Number({ description: "hub 广播序号（1 起），增量重连去重用（TASK-054）" })),
  message: Type.String(),
  code: Type.Optional(Type.String()),
});

// ==========================================
// 事件 Schema 注册表与联合
// ==========================================

/** 事件名 → schema 注册表：新增事件必须在此登记（类型与运行时校验同步生效） */
export const HarnessStreamEventSchemas = {
  thought_delta: ThoughtDeltaEventSchema,
  text_delta: TextDeltaEventSchema,
  ui_agent_plan: UiAgentPlanEventSchema,
  ui_code_diff: UiCodeDiffEventSchema,
  ui_terminal_log: UiTerminalLogEventSchema,
  ui_metric_chart: UiMetricChartEventSchema,
  tool_call_start: ToolCallStartEventSchema,
  tool_call_args_delta: ToolCallArgsDeltaEventSchema,
  tool_call_executing: ToolCallExecutingEventSchema,
  tool_call_result: ToolCallResultEventSchema,
  usage: UsageEventSchema,
  suspended: SuspendedEventSchema,
  traj: TrajStreamEnvelopeSchema,
  resumed: ResumedEventSchema,
  turn_end: TurnEndEventSchema,
  turn_start: TurnStartEventSchema,
  aborted: AbortedEventSchema,
  error: ErrorEventSchema,
} as const;

export type HarnessStreamEventType = keyof typeof HarnessStreamEventSchemas;

export const HarnessStreamEventSchema = Type.Union([
  ThoughtDeltaEventSchema,
  TextDeltaEventSchema,
  UiAgentPlanEventSchema,
  UiCodeDiffEventSchema,
  UiTerminalLogEventSchema,
  UiMetricChartEventSchema,
  ToolCallStartEventSchema,
  ToolCallArgsDeltaEventSchema,
  ToolCallExecutingEventSchema,
  ToolCallResultEventSchema,
  UsageEventSchema,
  SuspendedEventSchema,
  TrajStreamEnvelopeSchema,
  ResumedEventSchema,
  TurnEndEventSchema,
  TurnStartEventSchema,
  AbortedEventSchema,
  ErrorEventSchema,
]);

/** 事件契约类型（唯一事实来源 = schema） */
export type HarnessStreamEvent = Static<typeof HarnessStreamEventSchema>;

// ==========================================
// 运行时校验入口
// ==========================================

export interface StreamEventValidationError {
  /** JSON Pointer 形态的错误路径，如 "/promptTokens" */
  path: string;
  message: string;
}

/** 事件是否满足流契约（非严格：允许多余字段，拒绝漏字段/类型错发） */
export function validateHarnessStreamEvent(event: unknown): boolean {
  return Value.Check(HarnessStreamEventSchema, event);
}

/**
 * 校验失败详情（供测试断言与日志），通过时返回空数组。
 * 已知事件名时按注册表成员 schema 精确校验（错误路径到字段级，
 * 如 "/promptTokens"）；未知事件名回落 union 级校验（根路径）。
 */
export function getHarnessStreamEventErrors(event: unknown): StreamEventValidationError[] {
  const member =
    typeof event === "object" && event !== null && "type" in event
      ? HarnessStreamEventSchemas[(event as { type: string }).type as HarnessStreamEventType]
      : undefined;
  const schema = member ?? HarnessStreamEventSchema;
  return [...Value.Errors(schema, event)].map((e) => ({
    path: e.path,
    message: e.message,
  }));
}
