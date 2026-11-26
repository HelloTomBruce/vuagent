/**
 * @vuagent/ui - 交互信封本地预校验（TASK-090）
 *
 * 设计文档 §3/§4.2：组件声明了 interaction.resultSchema 时，submit/patch 信封
 * 在发出前先过本地校验——失败不发请求（省一次必败往返，错误就地回显）。
 *
 * 边界声明：本模块是**最简 JSON Schema 子集**校验器（type/required/properties/
 * enum/const/anyOf），刻意不引入 @sinclair/typebox 运行时（npm 自包含约束，
 * 见 ./protocol-types.ts 头注释）。本地校验只是体验优化层，**权威校验永远在
 * server 边界**（设计文档 §8「UI 回传不可信」）——本地放行的值 server 仍复核。
 */

import type { UIComponentInteraction } from "./protocol-types";

/** 本地校验失败错误：携带逐字段错误信息，供组件回显（不发请求、不落乐观更新） */
export class UIActionLocalValidationError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) {
    super(
      `本地校验未通过：${Object.entries(fieldErrors)
        .map(([field, msg]) => `${field}（${msg}）`)
        .join("、")}`
    );
    this.name = "UIActionLocalValidationError";
    this.fieldErrors = fieldErrors;
  }
}

/** resultSchema 的 JSON Schema 结构视角（vendored TSchema 是宽松 Record，这里窄化读取） */
interface SchemaView {
  type?: string;
  properties?: Record<string, SchemaView>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: SchemaView[];
  items?: SchemaView;
}

const asSchemaView = (schema: unknown): SchemaView =>
  schema !== null && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as SchemaView)
    : {};

const PRIMITIVE_CHECKERS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};

const TYPE_LABEL: Record<string, string> = {
  string: "字符串",
  number: "数值",
  integer: "整数",
  boolean: "布尔值",
  array: "数组",
};

/** 单值对单 schema 的子集校验；返回错误信息（null = 通过） */
function checkValue(value: unknown, schema: SchemaView): string | null {
  if (schema.const !== undefined && value !== schema.const) {
    return `取值必须为 ${JSON.stringify(schema.const)}`;
  }
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    return `取值不在可选范围内（${schema.enum.map((o) => JSON.stringify(o)).join(" / ")}）`;
  }
  if (schema.anyOf && schema.anyOf.length > 0) {
    const pass = schema.anyOf.some((sub) => checkValue(value, asSchemaView(sub)) === null);
    if (!pass) return "取值不满足任一允许的形态";
  }
  if (schema.type) {
    const checker = PRIMITIVE_CHECKERS[schema.type];
    // 未识别的 type（如 TypeBox 组合子）本地不判，交 server 权威校验
    if (checker && !checker(value)) {
      return `应为${TYPE_LABEL[schema.type] ?? schema.type}`;
    }
  }
  return null;
}

/**
 * 按 resultSchema 校验 submit/patch 信封的 values。
 * 返回逐字段错误（空对象 = 通过）。schema 缺失/非对象时视为无本地校验能力，直接放行。
 */
export function validateValuesLocally(
  values: Record<string, unknown>,
  resultSchema: unknown
): Record<string, string> {
  const schema = asSchemaView(resultSchema);
  const errors: Record<string, string> = {};

  for (const key of schema.required ?? []) {
    if (values[key] === undefined || values[key] === null) {
      errors[key] = "必填字段未填写";
    }
  }

  const properties = schema.properties ?? {};
  for (const [key, value] of Object.entries(values)) {
    if (errors[key]) continue;
    const propSchema = properties[key];
    if (!propSchema) continue; // 未声明字段本地不判（additionalProperties 等交 server）
    if (value === undefined || value === null) continue; // 缺省未填由 required 层判定
    const message = checkValue(value, asSchemaView(propSchema));
    if (message) errors[key] = message;
  }

  return errors;
}

/**
 * 取组件声明的本地校验 Schema：仅 submit/patch 这类携带 values 的信封可校验；
 * 组件未声明 interaction.resultSchema 时返回 null（调用方跳过本地校验）。
 */
export function localValidationSchemaOf(
  interaction: UIComponentInteraction | undefined,
  kind: "submit" | "cancel" | "patch"
): unknown | null {
  if (kind !== "submit" && kind !== "patch") return null;
  return interaction?.resultSchema ?? null;
}
