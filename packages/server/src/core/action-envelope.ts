/**
 * TASK-089（实施方案 TASK-B）：server 路由边界的回传信封处理。
 *
 * 设计文档 docs/design/ui-llm-interaction-contract.md §3（信封）/§8（威胁边界）：
 * - 回传值是不可信输入，在 server 边界完成「解析 → 校验 → 摘要化」后才进入模型上下文；
 * - 解析复用 @vuagent/protocol 的 parseUIActionPayload（信封直通 + 旧审批形态兼容映射）；
 * - L2/L3 声明组件的 submit/patch values 按 interaction.resultSchema 做 TypeBox Value.Check
 *   边界校验（与 tool-registry validateParams 同口径），失败返回结构化 fieldErrors——
 *   不唤醒挂起协程、不落账（设计文档 §4.2：校验失败不是终态，是前端重填的新输入）；
 * - 幂等契约化：actionId 为幂等键，同键异体 422（防误重试覆盖）——由 hashEnvelope
 *   对规范化信封做键序无关的哈希比较。
 */

import {
  parseUIActionPayload,
  UIActionParseError,
  type UIActionEnvelope,
  type UIComponentInteraction,
} from "@vuagent/protocol";
import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

/**
 * 解析组件声明的回传值校验 Schema（TASK-092）：
 * resultSchema 静态声明优先；缺省时按 deriveResultSchema 以工具入参推导
 * （ui_form：resultSchema 由 fields 派生，不允许模型自行声明，设计文档 §7）。
 * 路由边界（挂起 args 回放）与执行器（摘要词汇表）共用同一解析口径。
 */
export function resolveInteractionResultSchema(
  interaction: UIComponentInteraction,
  args?: Record<string, unknown>
): TSchema | undefined {
  if (interaction.resultSchema) return interaction.resultSchema;
  return interaction.deriveResultSchema?.(args ?? {});
}

// ==========================================
// 1. 摘要截断常量（设计文档 §8「上下文膨胀」行）
// ==========================================

/** 摘要中单字段渲染值的最大字符数（超出折叠为 …[+N 字符]） */
export const DIGEST_MAX_FIELD_CHARS = 500;

/** 结构化附录（```json 代码块内 JSON）的最大字符数（超出整体折叠为说明行） */
export const DIGEST_MAX_APPENDIX_CHARS = 4 * 1024;

/** 单字段值截断：保留前 max 字符，追加 …[+N 字符] 标记（防注入面自由文本刷屏） */
export function truncateFieldText(text: string, max: number = DIGEST_MAX_FIELD_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[+${text.length - max} 字符]`;
}

// ==========================================
// 2. 信封解析（protocol 解析器的 server 侧入口别名）
// ==========================================

export { UIActionParseError };

/**
 * 规范化解析回传体：合法信封直通；无 kind 的旧审批形态映射为 L1 submit 兼容信封；
 * 无法识别抛 UIActionParseError（路由层映射 400）。
 */
export function parseActionEnvelope(
  raw: unknown,
  interaction?: UIComponentInteraction
): UIActionEnvelope {
  return parseUIActionPayload(raw, interaction);
}

// ==========================================
// 3. L2/L3 values 边界校验
// ==========================================

export interface EnvelopeFieldError {
  /** TypeBox 错误路径（如 /replicas；根路径为 /） */
  path: string;
  /** TypeBox 校验消息原文 */
  message: string;
}

export type EnvelopeValuesValidation =
  | { ok: true }
  | { ok: false; fieldErrors: EnvelopeFieldError[] };

/**
 * 按 interaction.resultSchema 校验 submit/patch 信封的 values。
 * 仅对声明了 resultSchema 的 L2/L3 组件生效；cancel 信封与未声明组件直接放行
 * （cancel 语义不读取 values——协议层非严格 Schema 容忍的多余 values 在此层被忽略）。
 */
export function validateEnvelopeValues(
  envelope: UIActionEnvelope,
  interaction: UIComponentInteraction
): EnvelopeValuesValidation {
  if (envelope.kind === "cancel") return { ok: true };
  const resultSchema = interaction.resultSchema;
  if (!resultSchema) return { ok: true };
  if (Value.Check(resultSchema, envelope.values)) return { ok: true };
  const fieldErrors = [...Value.Errors(resultSchema, envelope.values)].map((e) => ({
    path: e.path || "/",
    message: e.message,
  }));
  return { ok: false, fieldErrors };
}

// ==========================================
// 4. 幂等哈希（同键异体 422 的比较源）
// ==========================================

/** 键序无关的规范化 JSON：对象键递归排序后序列化，用于信封内容哈希 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(",")}}`;
}

/**
 * 信封内容哈希（同键异体判定）：对规范化后的信封做键序无关序列化。
 * 同 actionId 重放同体（键序可不同）哈希一致；异体必不同。
 */
export function hashEnvelope(envelope: UIActionEnvelope): string {
  return canonicalize(envelope);
}

/**
 * 已落账决策（ActionResponse 形态）的信封哈希：
 * - 本版本落账的决策携带 envelope 字段，直接哈希；
 * - 兼容窗口内经旧形态落账的决策（{approved, reason, note}）按旧审批映射解析后哈希；
 * - 无法解析（更早期数据）返回 undefined——调用方按「无法判定」回落旧幂等行为。
 */
export function decisionPayloadHash(prior: Record<string, unknown>): string | undefined {
  const embedded = prior.envelope as UIActionEnvelope | undefined;
  if (
    embedded &&
    (embedded.kind === "submit" || embedded.kind === "cancel" || embedded.kind === "patch")
  ) {
    return hashEnvelope(embedded);
  }
  try {
    return hashEnvelope(parseUIActionPayload(prior));
  } catch {
    return undefined;
  }
}
