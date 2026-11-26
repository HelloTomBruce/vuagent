/**
 * @vuagent/protocol
 * ui_form（L2 首个落地组件）契约（TASK-092 / 实施方案 TASK-E）
 *
 * 设计文档：docs/design/ui-llm-interaction-contract.md §7（参考契约）。
 *
 * 本模块包含两部分：
 * 1. FormToolSchema / FormFieldSchema：模型 → UI 方向的工具入参 Schema
 *    （六型字段 text/textarea/number/boolean/select/date + required/default/
 *    options/unit/secret/placeholder）。刻意保持扁平结构、不用 Type.Recursive
 *    （FileNodeSchema 先例：兼容 Moonshot/Kimi、OpenAI 等 Function Calling
 *    参数校验器）。
 * 2. deriveFormResultSchema(fields)：resultSchema 派生器——UI → LLM 方向的
 *    回传值校验 Schema 由服务端从模型给的 fields **推导**（§7：模型给的 fields
 *    是输入，resultSchema 是推导结果，防止模型通过自定义 resultSchema 放宽校验）。
 *
 * 派生器刻意不依赖 TypeBox 运行时（输出普通 JSON Schema 对象字面量，仅在返回
 * 类型标注为 TSchema）：@vuagent/ui 因 npm 自包含约束（DEC-1795656818956-b696c8）
 * 不能引入 protocol/typebox 运行时，派生逻辑以 vendored 副本分发
 * （ui/src/runtime/form-result-schema.ts），两侧函数文本由
 * scripts/check-protocol-sync.mjs 的函数级比对机械锁死，避免双事实来源漂移。
 *
 * 消费方约定：
 * - server：handleResolveAction 用派生 Schema 做边界校验（validateEnvelopeValues），
 *   result-digest 用其字段 description/unit/secret 驱动摘要与附录打码；
 * - ui：vendored 副本驱动提交前本地预校验（runtime/interaction-validation.ts
 *   的最简 JSON Schema 子集），权威校验永远在 server 边界。
 */

import { Type, type Static, type TSchema } from "@sinclair/typebox";

// ==========================================
// 1. 字段 Schema（设计文档 §7 FormFieldSchema）
// ==========================================

export const FormFieldTypeSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("textarea"),
  Type.Literal("number"),
  Type.Literal("boolean"),
  Type.Literal("select"),
  Type.Literal("date"),
]);

export const FormFieldOptionSchema = Type.Object({
  value: Type.String({ description: "机器值（回传 values 中的取值）" }),
  label: Type.String({ description: "人类文案（界面展示与摘要回映）" }),
});

export const FormFieldSchema = Type.Object({
  key: Type.String({ description: "字段标识，回传 values 的 key" }),
  label: Type.String({ description: "字段显示名" }),
  type: FormFieldTypeSchema,
  description: Type.Optional(
    Type.String({ description: "字段含义说明——同时进入摘要词汇表" })
  ),
  required: Type.Optional(Type.Boolean({ description: "是否必填" })),
  default: Type.Optional(Type.Unknown({ description: "预填默认值" })),
  options: Type.Optional(
    Type.Array(FormFieldOptionSchema, {
      description: "select 类型的可选项（value 为机器值，label 为人类文案）",
    })
  ),
  unit: Type.Optional(Type.String({ description: "数值单位，摘要中附带" })),
  secret: Type.Optional(
    Type.Boolean({ description: "敏感字段：值不进模型上下文，走 §5 敏感值通道" })
  ),
  placeholder: Type.Optional(Type.String({ description: "输入占位提示" })),
});

export type FormField = Static<typeof FormFieldSchema>;
export type FormFieldType = Static<typeof FormFieldTypeSchema>;
export type FormFieldOption = Static<typeof FormFieldOptionSchema>;

// ==========================================
// 2. 工具入参 Schema（设计文档 §7 FormToolSchema）
// ==========================================

export const FormToolSchema = Type.Object(
  {
    title: Type.String({ description: "表单标题" }),
    description: Type.Optional(
      Type.String({ description: "为什么需要这些信息（展示给用户）" })
    ),
    fields: Type.Array(FormFieldSchema, {
      minItems: 1,
      maxItems: 32,
      description: "表单字段列表（1-32 个字段）",
    }),
    submitLabel: Type.Optional(Type.String({ description: "提交按钮文案" })),
  },
  {
    $id: "ui_form",
    description:
      "需要用户补充结构化信息（参数、配置、凭证）时调用：渲染表单并挂起等待填写提交",
  }
);

export type FormToolArgs = Static<typeof FormToolSchema>;

// ==========================================
// 3. resultSchema 派生器（单一事实来源；ui 侧为文本同步的 vendored 副本）
// ==========================================

/**
 * 派生器的结构输入（两侧文件各自本地声明同名结构，函数文本保持逐字一致）。
 * 与 FormFieldSchema 的 Static 类型结构化兼容（key 之外全部可选读取）。
 */
interface FormFieldSpec {
  key: string;
  label?: string;
  type: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: ReadonlyArray<{ value: string; label: string }>;
  unit?: string;
  secret?: boolean;
}

/**
 * 从 fields 派生回传值校验 Schema（resultSchema 一身三任：边界校验规则 /
 * 模型词汇表 / 摘要生成模板）。
 *
 * 映射规则（设计文档 §7 + §4.1 摘要规则表）：
 * - text/textarea/date → string；number → number；boolean → boolean；
 * - select → string + anyOf[{const, label, description}]（枚举约束与 label 回映
 *   同体：result-digest 的 enumLabelOf 读 anyOf 分支的 label/description）；
 * - required:true → 顶层 required 数组；
 * - description（缺省回退 label）/ unit / secret / default 作为自定义关键字
 *   透传——TypeBox Value.Check 忽略未知关键字（不影响校验），result-digest
 *   与 ui 本地预校验读取它们驱动摘要打码与本地提示。
 */
export function deriveFormResultSchema(fields: ReadonlyArray<FormFieldSpec>): TSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const field of fields) {
    const property: Record<string, unknown> = {};
    switch (field.type) {
      case "number":
        property.type = "number";
        break;
      case "boolean":
        property.type = "boolean";
        break;
      case "select":
        property.type = "string";
        if (Array.isArray(field.options) && field.options.length > 0) {
          property.anyOf = field.options.map((option) => ({
            const: option.value,
            label: option.label,
            description: option.label,
          }));
        }
        break;
      default:
        // text / textarea / date（date 以 ISO 字符串回传，格式校验属业务规则层）
        property.type = "string";
        break;
    }
    property.description = field.description || field.label;
    // 字符串类字段统一 2000 字符上限（模型 args 可直打 DOM/上下文，§8 边界收紧）
    if (property.type === "string") property.maxLength = 2000;
    if (typeof field.unit === "string" && field.unit) property.unit = field.unit;
    if (field.secret === true) property.secret = true;
    if (field.default !== undefined) property.default = field.default;
    properties[field.key] = property;
    if (field.required === true) required.push(field.key);
  }
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  } as unknown as TSchema;
}

// ==========================================
// 4. TypeBox 提升（server 边界校验消费的机械转换）
// ==========================================

/**
 * 把 deriveFormResultSchema 输出的普通 JSON Schema 提升为 TypeBox Schema。
 *
 * 背景：ui vendored 副本与 protocol 的派生器逐字同源（check-protocol-sync 锁死），
 * 故派生器本身不 import TypeBox（ui 自包含约束）；而 server 边界校验口径是
 * TypeBox Value.Check（0.34 起按 Kind 标记分派，不认普通 JSON Schema）——
 * 本函数是两者之间的**纯机械转换**：不携带任何语义决策（类型映射规则全部
 * 在派生器内），只把派生结果重新组装为带 Kind 标记的 TypeBox 对象。
 *
 * 自定义关键字（description/unit/secret/default 与 anyOf 分支的 label）
 * 经 TypeBox options 透传——Value.Check 忽略未知关键字，result-digest 读取它们
 * 驱动摘要词汇表与打码。
 */
export function liftFormResultSchema(schema: TSchema): TSchema {
  const node = schema as Record<string, unknown>;
  const required = Array.isArray(node.required) ? (node.required as string[]) : [];

  const liftProperty = (prop: Record<string, unknown>): TSchema => {
    const custom: Record<string, unknown> = {};
    for (const key of ["description", "unit", "secret", "default", "maxLength"]) {
      if (key in prop) custom[key] = prop[key];
    }
    const anyOf = prop.anyOf;
    if (Array.isArray(anyOf) && anyOf.length > 0) {
      const branches = anyOf.map((branch) => {
        const b = branch as Record<string, unknown>;
        return Type.Literal(b.const as string, {
          ...(typeof b.label === "string" ? { label: b.label } : {}),
          ...(typeof b.description === "string" ? { description: b.description } : {}),
        });
      });
      return Type.Union(branches, custom);
    }
    switch (prop.type) {
      case "number":
        return Type.Number(custom);
      case "boolean":
        return Type.Boolean(custom);
      default:
        return Type.String(custom);
    }
  };

  const properties: Record<string, TSchema> = {};
  for (const [key, prop] of Object.entries(
    (node.properties ?? {}) as Record<string, Record<string, unknown>>
  )) {
    const lifted = liftProperty(prop);
    properties[key] = required.includes(key) ? lifted : Type.Optional(lifted);
  }
  return Type.Object(properties);
}

// ==========================================
// 5. 入参防御解析（模型 args 是不可信输入的防线副本）
// ==========================================

const FORM_FIELD_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "date",
]);

/**
 * 把不可信 args.fields 收敛为结构合法的字段列表。
 * 工具入参闸门（validateParams 按 FormToolSchema 校验）是权威防线；
 * 本函数服务于「挂起参数回放/孤儿记录」等绕过闸门后再派生的兜底场景，
 * 非法条目直接丢弃（宁缺毋滥——坏字段不应让整张表单不可校验）。
 */
export function coerceFormFields(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) return [];
  const fields: FormField[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.key !== "string" || !record.key) continue;
    // 保留键防御（评审 N-12）：__proto__/constructor/prototype 作为字段键会在
    // 前端 values 赋值与 resultSchema properties 组装处产生原型污染
    if (/^(?:__proto__|constructor|prototype)$/.test(record.key)) continue;
    if (typeof record.label !== "string" || !record.label) continue;
    if (typeof record.type !== "string" || !FORM_FIELD_TYPES.has(record.type)) continue;
    const field: FormField = {
      key: record.key,
      label: record.label,
      type: record.type as FormField["type"],
    };
    if (typeof record.description === "string") field.description = record.description;
    if (typeof record.required === "boolean") field.required = record.required;
    if (record.default !== undefined) field.default = record.default;
    if (Array.isArray(record.options)) {
      field.options = record.options
        .filter(
          (o): o is { value: string; label: string } =>
            o !== null &&
            typeof o === "object" &&
            typeof (o as Record<string, unknown>).value === "string" &&
            typeof (o as Record<string, unknown>).label === "string"
        )
        .map((o) => ({ value: o.value, label: o.label }));
    }
    if (typeof record.unit === "string") field.unit = record.unit;
    if (typeof record.secret === "boolean") field.secret = record.secret;
    if (typeof record.placeholder === "string") field.placeholder = record.placeholder;
    fields.push(field);
  }
  // 上限收紧（与 FormToolSchema.fields.maxItems 同口径）
  return fields.slice(0, 32);
}
