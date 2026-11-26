/**
 * @vuagent/protocol
 * UI 注册组件 ↔ LLM 交互契约（TASK-088）
 *
 * 设计文档：docs/design/ui-llm-interaction-contract.md（§2 分级 / §3 信封 / §4 双层结果）
 * 本模块是「UI → LLM」方向回传载荷的单一事实来源：
 * - 信封形状（UIActionEnvelope）：submit / cancel / patch 判别联合；
 * - 组件交互能力声明（UIComponentInteraction）：分级 + resultSchema + 超时语义；
 * - 规范化解析器（parseUIActionPayload）：信封直通 + 旧审批形态兼容映射。
 *
 * 消费方约定：
 * - @vuagent/server：路由边界调用 parseUIActionPayload 解析回传体（不可信输入）；
 * - @vuagent/ui：因 npm 自包含约束（见 ui/src/runtime/protocol-types.ts 头注释）
 *   只内联（vendor）本文件的类型，信封在组件侧以类型化对象字面量构造，
 *   不引入本模块的运行时值——解析只发生在 server 侧。
 */

import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// ==========================================
// 1. 交互元信息（Action Meta）
// ==========================================

export const ActionMetaSchema = Type.Object({
  editedFields: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "用户实际修改过的字段 key（区别于组件预填默认值）——模型据此区分『用户确认过』与『默认值透传』",
    })
  ),
  durationMs: Type.Optional(Type.Number({ description: "用户交互耗时（毫秒）" })),
  clientValidated: Type.Optional(
    Type.Boolean({ description: "前端是否已过本地校验（服务端仍必须复核）" })
  ),
});

export type ActionMeta = Static<typeof ActionMetaSchema>;

// ==========================================
// 2. 回传信封（UI Action Envelope）
// ==========================================

/**
 * 设计文档 §3：回传信封是判别联合。
 * - submit：用户提交结构化值（values 形状由组件 resultSchema 约束）；
 * - cancel：用户主动取消——一等公民而非错误（设计文档 §3：混为 error 会诱导模型重试轰炸）；
 * - patch：L3 预留的增量编辑，不终结挂起（运行时本阶段不实现，仅定义语义）。
 *
 * timeout 不进信封：超时由 ActionHub 服务端裁决生成，不允许客户端伪造。
 */
export const UIActionEnvelopeSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("submit"),
    values: Type.Record(Type.String(), Type.Unknown(), {
      description: "用户提交的字段值集合，形状由组件 resultSchema 约束",
    }),
    meta: Type.Optional(ActionMetaSchema),
  }),
  Type.Object({
    kind: Type.Literal("cancel"),
    reason: Type.Optional(
      Type.String({ description: "用户主动取消的原因（若界面提供输入）" })
    ),
    meta: Type.Optional(ActionMetaSchema),
  }),
  Type.Object({
    kind: Type.Literal("patch"),
    values: Type.Record(Type.String(), Type.Unknown(), {
      description: "L3 预留：增量编辑值集合，不终结挂起",
    }),
    meta: Type.Optional(ActionMetaSchema),
  }),
]);

export type UIActionEnvelope = Static<typeof UIActionEnvelopeSchema>;
export type UIActionKind = UIActionEnvelope["kind"];

/** submit 信封（values 载体的窄化类型，便于消费方 switch 后直接使用） */
export type UIActionSubmitEnvelope = Extract<UIActionEnvelope, { kind: "submit" }>;
export type UIActionCancelEnvelope = Extract<UIActionEnvelope, { kind: "cancel" }>;
export type UIActionPatchEnvelope = Extract<UIActionEnvelope, { kind: "patch" }>;

// ==========================================
// 3. 组件交互能力声明（Interaction Declaration）
// ==========================================

/**
 * 交互能力分级（设计文档 §2）：
 * - L0 presentational：纯展示，无回传通道（缺省等级）；
 * - L1 decision：有限决策集（approve/deny），枚举型 payload；
 * - L2 form：结构化值采集——必须声明 resultSchema；
 * - L3 collaborative：多次增量 patch，终态由显式 submit/cancel 触发——必须声明 resultSchema。
 */
export type UIInteractionLevel = "L0" | "L1" | "L2" | "L3";

/**
 * 组件交互声明（挂在 UIComponentDefinition.interaction）。
 *
 * 刻意用 TS interface 而非 TypeBox Schema：resultSchema 本身是 TSchema
 * （schema 的 schema 在 TypeBox 里只能退化为 Unknown，失去校验意义），
 * 且该声明是定义期契约（server 注册/工具转换时消费），不是线格式。
 * 定义期合法性由 assertValidInteraction() 把关。
 */
export interface UIComponentInteraction {
  level: UIInteractionLevel;
  /**
   * UI → LLM 方向的回传值 Schema（L2/L3 必填，或与 deriveResultSchema 二选一）：
   * 一身三任——服务端边界校验规则 / 模型词汇表（字段 description）/ 摘要生成模板。
   */
  resultSchema?: TSchema;
  /**
   * args 驱动的 resultSchema 派生器（TASK-092，与 resultSchema 二选一）：
   * resultSchema 不允许模型自行声明（设计文档 §7——模型给的 fields 是输入，
   * resultSchema 是推导结果，防止模型通过自定义 resultSchema 放宽校验），
   * ui_form 这类「Schema 由模型入参决定」的组件通过本回调在服务端/前端
   * 按同一份 fields 推导（派生逻辑本体见 form.ts deriveFormResultSchema）。
   * 定义期合法性由 assertValidInteraction() 把关（L2/L3 两者至少其一）。
   */
  deriveResultSchema?: (args: Record<string, unknown>) => TSchema;
  /**
   * 挂起超时的语义归属：deny（L1 缺省，视为拒绝）/ cancel（L2 缺省，视为放弃）。
   * 超时不允许映射为 submit（半成品值不得当作用户意图，设计文档 §6）。
   */
  timeoutMeaning?: "cancel" | "deny";
}

/** 交互声明不合法时抛出的定义期错误（如 L2 缺 resultSchema） */
export class UIComponentInteractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UIComponentInteractionError";
  }
}

/**
 * 定义期校验：声明了 interaction 的组件必须自洽。
 * 在 server 注册（UIComponentRegistry.register / 内建工具装配）时调用，
 * 把错误拦截在定义期而非首次交互时。
 */
export function assertValidInteraction(
  componentName: string,
  interaction: UIComponentInteraction
): void {
  if (
    interaction.level !== "L0" &&
    interaction.level !== "L1" &&
    interaction.level !== "L2" &&
    interaction.level !== "L3"
  ) {
    throw new UIComponentInteractionError(
      `组件 ${componentName} 的 interaction.level 非法：${String(interaction.level)}`
    );
  }
  if (
    (interaction.level === "L2" || interaction.level === "L3") &&
    !interaction.resultSchema &&
    !interaction.deriveResultSchema
  ) {
    throw new UIComponentInteractionError(
      `组件 ${componentName} 声明为 ${interaction.level}（值采集/协作型）但未提供 resultSchema 或 deriveResultSchema——` +
        `回传值的校验规则与模型词汇表不可缺省（设计文档 §2/§4/§7）`
    );
  }
  if (
    interaction.timeoutMeaning !== undefined &&
    interaction.timeoutMeaning !== "cancel" &&
    interaction.timeoutMeaning !== "deny"
  ) {
    throw new UIComponentInteractionError(
      `组件 ${componentName} 的 timeoutMeaning 非法：${String(
        interaction.timeoutMeaning
      )}（仅允许 "cancel" | "deny"，超时不得映射为提交语义）`
    );
  }
}

/** 组件未声明 interaction 时的缺省等级（纯展示，无回传通道） */
export function interactionLevelOf(interaction?: UIComponentInteraction): UIInteractionLevel {
  return interaction?.level ?? "L0";
}

// ==========================================
// 4. 规范化解析器（Envelope Parser）
// ==========================================

/** 回传体既不是合法信封也不是可识别的旧形态时抛出 */
export class UIActionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UIActionParseError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * 旧审批形态（TASK-088 兼容窗口，设计文档 §8「旧客户端兼容」）：
 * ui_approval_card 历史回传体为 { approved: boolean, reason?: "manual"|"timeout", note?: string }，
 * 映射为 L1 submit 兼容信封，values 原样保留 approved/reason/note 三键。
 */
function parseLegacyApprovalPayload(raw: Record<string, unknown>): UIActionEnvelope | null {
  if (typeof raw.approved !== "boolean") return null;
  const values: Record<string, unknown> = { approved: raw.approved };
  if (typeof raw.reason === "string") values.reason = raw.reason;
  if (typeof raw.note === "string") values.note = raw.note;
  return { kind: "submit", values };
}

/**
 * 规范化解析回传体（server 路由边界的唯一入口）：
 * 1. 合法信封 → 原样返回（TypeBox 校验把关形状）；
 * 2. 无 kind 的旧审批形态 → 映射为 submit 兼容信封；
 * 3. 其余 → 抛 UIActionParseError（路由层映射为 400）。
 *
 * interaction 参数预留给按组件声明收紧解析（如 L0 组件收到回传应直接拒绝）；
 * 本阶段先做通用解析，组件级收紧在 server 侧（TASK-B）结合组件定义完成。
 */
export function parseUIActionPayload(
  raw: unknown,
  interaction?: UIComponentInteraction
): UIActionEnvelope {
  if (interaction !== undefined) {
    assertValidInteraction("（调用方未具名）", interaction);
  }

  if (!isRecord(raw)) {
    throw new UIActionParseError(
      `回传体必须是对象（信封或旧审批形态），实际收到 ${Array.isArray(raw) ? "array" : String(raw)}`
    );
  }

  if (raw.kind === "submit" || raw.kind === "cancel" || raw.kind === "patch") {
    if (Value.Check(UIActionEnvelopeSchema, raw)) {
      return raw;
    }
    const firstError = Value.Errors(UIActionEnvelopeSchema, raw).First();
    throw new UIActionParseError(
      `回传信封形状非法（kind=${raw.kind}）：${firstError?.path ?? ""} ${firstError?.message ?? "schema 校验失败"}`
    );
  }

  const legacy = parseLegacyApprovalPayload(raw);
  if (legacy) return legacy;

  throw new UIActionParseError(
    "回传体无法识别：既不是合法信封（缺少 kind: submit|cancel|patch），也不是旧审批形态（缺少 boolean approved）"
  );
}
