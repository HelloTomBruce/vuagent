/**
 * @vuagent/protocol
 * L2 组件家族契约（0.9.0 W3，docs/design/v0.9-plan.md §4）：
 * ui_option_picker（方案拍板）/ ui_wizard（多步表单）/ ui_data_table（结构化采集）。
 *
 * 沿用 ui_form 确立的 L2 模式（docs/design/ui-llm-interaction-contract.md §7）：
 * 1. 工具入参 Schema：模型 → UI 方向（模型给的是输入）；
 * 2. derive*ResultSchema：UI → LLM 方向的回传校验 Schema 由服务端从模型入参**推导**
 *    （防止模型通过自定义 resultSchema 放宽校验）。
 *
 * 组件间复用与语义边界：
 * - ui_wizard 的 steps[].fields 复用 FormFieldSchema；resultSchema 直接复用
 *   deriveFormResultSchema（flatten 全部步字段）——wizard 是「表单的分步 UI」，
 *   一次挂起一次回传，不做步间服务端挂起（L2=一次采集、L3=多轮协作的边界，plan §4.2）；
 * - ui_option_picker / ui_data_table 的派生器为新增（enum 回映 / 行对象形状各自不同），
 *   与 form 派生器同约定：输出普通 JSON Schema（不依赖 TypeBox 运行时，ui vendored
 *   副本经 scripts/check-protocol-sync.mjs 函数级比对锁死）。
 */

import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { FormFieldSchema } from "./form.js";

// ==========================================
// 1. ui_option_picker（方案拍板：单选/多选）
// ==========================================

export const OptionPickerToolSchema = Type.Object(
  {
    title: Type.String({ description: "选择器标题（如「采用哪个方案」）" }),
    description: Type.Optional(Type.String({ description: "决策背景说明（展示给用户）" })),
    options: Type.Array(
      Type.Object({
        id: Type.String({ description: "机器值（回传 selected 的取值）" }),
        label: Type.String({ description: "人类文案" }),
        description: Type.Optional(Type.String({ description: "该选项的展开说明（副作用/代价）" })),
        recommended: Type.Optional(
          Type.Boolean({ description: "推荐标记：界面加「推荐」徽标，不影响校验" })
        ),
      }),
      { minItems: 2, maxItems: 12, description: "选项列表（2-12 个）" }
    ),
    multiple: Type.Optional(
      Type.Boolean({ description: "是否多选（缺省单选；单选回传 selected 长度恒为 1）" })
    ),
    submitLabel: Type.Optional(Type.String({ description: "提交按钮文案" })),
  },
  {
    $id: "ui_option_picker",
    description:
      "有多个候选方案需要用户拍板时调用（技术选型 / 方向决策）：渲染选项卡片并挂起等待选择。比 ui_approval_card（approve/deny 二选一）表达力强，比 ui_form 轻量",
  }
);

export type OptionPickerToolArgs = Static<typeof OptionPickerToolSchema>;

/** 派生器结构输入（与 OptionPickerToolArgs.options 结构化兼容） */
interface OptionSpec {
  id: string;
  label?: string;
  description?: string;
}

/**
 * 从 options 派生回传校验 Schema：
 * - selected 恒为 string[]（单选归一为长度 1——调用方消费侧不用分支）；
 * - 元素 anyOf[{const, label, description}]（枚举约束与 label 回映同体，对齐 form select）；
 * - multiple=false 时 minItems=maxItems=1。
 */
export function deriveOptionPickerResultSchema(
  options: ReadonlyArray<OptionSpec>,
  multiple?: boolean
): TSchema {
  const valid = (Array.isArray(options) ? options : []).filter(
    (o) => o && typeof o === "object" && typeof o.id === "string" && typeof o.label === "string"
  );
  const branches = valid.map((o) => ({
    const: o.id,
    ...(typeof o.label === "string" ? { title: o.label } : {}),
    ...(typeof o.description === "string" ? { description: o.description } : {}),
  }));
  // 单选：min=max=1（长度恒 1，语义归一）；多选：上限=选项数。
  // 展开顺序：bounds 必须整体生效（先 maxItems=选项数 再被单选钳制覆盖会出「单选可多值」漏洞）
  const bounds = multiple
    ? { maxItems: Math.max(valid.length, 1) }
    : { minItems: 1, maxItems: 1 };
  return {
    type: "object",
    properties: {
      selected: {
        type: "array",
        ...(branches.length > 0
          ? { items: { anyOf: branches } }
          : { items: { type: "string" } }),
        description: multiple ? "用户选中的选项 id 列表（多选）" : "用户选中的选项 id（单选，长度恒为 1）",
        ...bounds,
      },
    },
    required: ["selected"],
  } as unknown as TSchema;
}

/**
 * 把 deriveOptionPickerResultSchema 的普通 JSON Schema 提升为 TypeBox（server
 * 边界校验的机械转换，语义同 liftFormResultSchema；不携带语义决策）。
 */
export function liftOptionPickerResultSchema(schema: TSchema): TSchema {
  const node = schema as Record<string, unknown>;
  const selected = (node.properties as Record<string, Record<string, unknown>> | undefined)?.selected ?? {};
  const anyOf = Array.isArray(selected.items ? (selected.items as Record<string, unknown>).anyOf : undefined)
    ? ((selected.items as Record<string, unknown>).anyOf as Array<Record<string, unknown>>)
    : undefined;
  const item = anyOf
    ? Type.Union(
        anyOf.map((b) =>
          Type.Literal(b.const as string, {
            ...(typeof b.title === "string" ? { title: b.title } : {}),
            ...(typeof b.description === "string" ? { description: b.description } : {}),
          })
        )
      )
    : Type.String();
  const isArrayType = ((selected.items as Record<string, unknown>)?.type as string) === "array" || !!anyOf;
  if (!isArrayType) {
    // 派生器输出恒为 array items 形态；防御分支（不该发生）
    return Type.Object({ selected: Type.Array(item) });
  }
  const bounds: { minItems?: number; maxItems?: number } = {};
  if (typeof selected.minItems === "number") bounds.minItems = selected.minItems;
  if (typeof selected.maxItems === "number") bounds.maxItems = selected.maxItems;
  return Type.Object({
    selected: Type.Array(item, { description: typeof selected.description === "string" ? selected.description : undefined, ...bounds }),
  });
}

// ==========================================
// 2. ui_wizard（多步表单：复用 FormFieldSchema，无新派生器）
// ==========================================

export const WizardStepSchema = Type.Object({
  title: Type.String({ description: "步骤标题" }),
  description: Type.Optional(Type.String({ description: "步骤说明（展示给用户）" })),
  fields: Type.Array(FormFieldSchema, {
    minItems: 1,
    maxItems: 16,
    description: "该步骤的表单字段（复用 ui_form 的字段类型）",
  }),
});

export const WizardToolSchema = Type.Object(
  {
    title: Type.String({ description: "向导标题" }),
    description: Type.Optional(Type.String({ description: "整体说明（为什么需要多步信息）" })),
    steps: Type.Array(WizardStepSchema, {
      minItems: 2,
      maxItems: 8,
      description: "步骤列表（2-8 步；用户按顺序填写，一次提交全部）",
    }),
    submitLabel: Type.Optional(Type.String({ description: "提交按钮文案" })),
  },
  {
    $id: "ui_wizard",
    description:
      "需要用户分步补充较多结构化信息时调用（配置向导 / 多环节设置）：渲染分步表单，一次提交全部步骤值。语义为「一个 L2」——单次挂起单次回传，无步间服务端交互",
  }
);

export type WizardToolArgs = Static<typeof WizardToolSchema>;

/** flatten 全部步字段（key 冲突：后步覆盖前步——同 key 的后定义胜出，模型侧约束由提示承担）。
 *  字段结构入参刻意为 unknown 形状（ui vendored 副本无 FormField 类型可引，文本级同步锁死）：
 *  元素合法性由 coerceFormFields 兜底（wizard 的 resultSchema 派生链路同 form 口径）。 */
export function flattenWizardFields(steps: ReadonlyArray<{ fields?: ReadonlyArray<unknown> }>): unknown[] {
  const out: unknown[] = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    if (step && Array.isArray(step.fields)) out.push(...step.fields);
  }
  return out;
}

// ==========================================
// 3. ui_data_table（结构化行采集）
// ==========================================

export const DataTableColumnSchema = Type.Object({
  key: Type.String({ description: "列标识（行对象的属性名）" }),
  label: Type.String({ description: "列显示名" }),
  type: Type.Optional(
    Type.Union([
      Type.Literal("text"),
      Type.Literal("number"),
      Type.Literal("boolean"),
      Type.Literal("select"),
    ])
  ),
  description: Type.Optional(Type.String({ description: "列含义说明" })),
  required: Type.Optional(Type.Boolean({ description: "行内该列是否必填" })),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        value: Type.String({ description: "机器值" }),
        label: Type.String({ description: "人类文案" }),
      }),
      { description: "select 列的可选项" }
    )
  ),
});

export const DataTableToolSchema = Type.Object(
  {
    title: Type.String({ description: "表格标题" }),
    description: Type.Optional(Type.String({ description: "为什么要这些数据（展示给用户）" })),
    columns: Type.Array(DataTableColumnSchema, {
      minItems: 1,
      maxItems: 12,
      description: "列定义（1-12 列）",
    }),
    rows: Type.Optional(
      Type.Array(Type.Record(Type.String(), Type.Unknown()), {
        description: "预填初始行（模型侧已知数据可直接预填）",
      })
    ),
    minRows: Type.Optional(Type.Number({ description: "最少行数（缺省 0——允许空表提交）" })),
    maxRows: Type.Optional(Type.Number({ description: "最多行数（缺省 50）" })),
    submitLabel: Type.Optional(Type.String({ description: "提交按钮文案" })),
  },
  {
    $id: "ui_data_table",
    description:
      "需要用户批量提供结构化行数据时调用（名单 / 映射表 / 配置项清单）：渲染可增删行的表格并挂起等待提交",
  }
);

export type DataTableToolArgs = Static<typeof DataTableToolSchema>;

/** 列结构输入（与 DataTableColumnSchema 结构化兼容） */
interface ColumnSpec {
  key: string;
  label?: string;
  type?: string;
  description?: string;
  required?: boolean;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

/**
 * 从 columns 派生回传校验 Schema：{ values: Row[] }——
 * Row = 按 columns 组装的行对象（类型映射与 select 枚举同 deriveFormResultSchema 规则）。
 */
export function deriveDataTableResultSchema(
  columns: ReadonlyArray<ColumnSpec>,
  bounds?: { minRows?: number; maxRows?: number }
): TSchema {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const col of Array.isArray(columns) ? columns : []) {
    if (!col || typeof col !== "object" || typeof col.key !== "string" || !col.key) continue;
    if (/^(?:__proto__|constructor|prototype)$/.test(col.key)) continue; // 原型污染防御（同 form）
    const property: Record<string, unknown> = {};
    switch (col.type) {
      case "number":
        property.type = "number";
        break;
      case "boolean":
        property.type = "boolean";
        break;
      case "select":
        property.type = "string";
        if (Array.isArray(col.options) && col.options.length > 0) {
          property.anyOf = col.options.map((o: { value: string; label: string }) => ({
            const: o.value,
            label: o.label,
            description: o.label,
          }));
        }
        break;
      default:
        property.type = "string";
    }
    property.description = col.description || col.label;
    if (property.type === "string") property.maxLength = 2000;
    properties[col.key] = property;
    if (col.required === true) required.push(col.key);
  }
  const minRows = Math.max(0, Math.floor(bounds?.minRows ?? 0));
  const maxRows = Math.max(minRows, Math.floor(bounds?.maxRows ?? 50));
  return {
    type: "object",
    properties: {
      values: {
        type: "array",
        items: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        description: "用户编辑后的行数据（按 columns 组装的行对象数组）",
        minItems: minRows,
        maxItems: maxRows,
      },
    },
    required: ["values"],
  } as unknown as TSchema;
}

/**
 * 把 deriveDataTableResultSchema 提升为 TypeBox（机械转换，语义同 liftFormResultSchema）。
 */
export function liftDataTableResultSchema(schema: TSchema): TSchema {
  const node = schema as Record<string, unknown>;
  const values = (node.properties as Record<string, Record<string, unknown>> | undefined)?.values ?? {};
  const items = (values.items ?? {}) as Record<string, unknown>;
  const rowPropsRaw = (items.properties ?? {}) as Record<string, Record<string, unknown>>;
  const rowRequired = Array.isArray(items.required) ? (items.required as string[]) : [];

  const liftCell = (prop: Record<string, unknown>): TSchema => {
    const custom: Record<string, unknown> = {};
    for (const key of ["description", "maxLength"]) {
      if (key in prop) custom[key] = prop[key];
    }
    const anyOf = prop.anyOf;
    if (Array.isArray(anyOf) && anyOf.length > 0) {
      return Type.Union(
        anyOf.map((b) => {
          const branch = b as Record<string, unknown>;
          return Type.Literal(branch.const as string, {
            ...(typeof branch.label === "string" ? { label: branch.label } : {}),
          });
        }),
        custom
      );
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

  const rowProps: Record<string, TSchema> = {};
  for (const [key, prop] of Object.entries(rowPropsRaw)) {
    const lifted = liftCell(prop);
    rowProps[key] = rowRequired.includes(key) ? lifted : Type.Optional(lifted);
  }
  const bounds: { minItems?: number; maxItems?: number } = {};
  if (typeof values.minItems === "number") bounds.minItems = values.minItems;
  if (typeof values.maxItems === "number") bounds.maxItems = values.maxItems;
  return Type.Object({
    values: Type.Array(Type.Object(rowProps), {
      description: typeof values.description === "string" ? values.description : undefined,
      ...bounds,
    }),
  });
}

// ==========================================
// 4. 入参防御解析（模型 args 不可信的兜底，口径同 coerceFormFields）
// ==========================================

const PROTO_KEY = /^(?:__proto__|constructor|prototype)$/;

export function coerceOptionPickerOptions(raw: unknown): Array<{ id: string; label: string; description?: string; recommended?: boolean }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; label: string; description?: string; recommended?: boolean }> = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || PROTO_KEY.test(r.id)) continue;
    if (typeof r.label !== "string" || !r.label) continue;
    const opt: { id: string; label: string; description?: string; recommended?: boolean } = { id: r.id, label: r.label };
    if (typeof r.description === "string") opt.description = r.description;
    if (r.recommended === true) opt.recommended = true;
    out.push(opt);
  }
  return out.slice(0, 12);
}

export function coerceDataTableColumns(raw: unknown): Array<Required<Pick<ColumnSpec, "key" | "label" | "type">> & Partial<ColumnSpec>> {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set(["text", "number", "boolean", "select"]);
  const out: Array<Required<Pick<ColumnSpec, "key" | "label" | "type">> & Partial<ColumnSpec>> = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.key !== "string" || !r.key || PROTO_KEY.test(r.key)) continue;
    if (typeof r.label !== "string" || !r.label) continue;
    const type = typeof r.type === "string" && validTypes.has(r.type) ? r.type : "text";
    const col: Required<Pick<ColumnSpec, "key" | "label" | "type">> & Partial<ColumnSpec> = {
      key: r.key,
      label: r.label,
      type,
    };
    if (typeof r.description === "string") col.description = r.description;
    if (r.required === true) col.required = true;
    if (Array.isArray(r.options)) {
      col.options = r.options
        .filter(
          (o): o is { value: string; label: string } =>
            o !== null && typeof o === "object" && typeof (o as Record<string, unknown>).value === "string" && typeof (o as Record<string, unknown>).label === "string"
        )
        .map((o) => ({ value: o.value, label: o.label }));
    }
    out.push(col);
  }
  return out.slice(0, 12);
}
