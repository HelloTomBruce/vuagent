/**
 * @vuagent/ui - L2 组件家族 resultSchema 派生器（vendored 副本，0.9.0 W3）
 *
 * 逐字同步自 @vuagent/protocol/src/l2-components.ts 的派生器与结构输入：
 * - `OptionSpec` + `deriveOptionPickerResultSchema`（ui_option_picker）
 * - `ColumnSpec` + `deriveDataTableResultSchema`（ui_data_table）
 * - `flattenWizardFields`（ui_wizard——resultSchema 复用本文件的
 *   deriveFormResultSchema，flatten 逻辑随行）
 *
 * 为什么 vendored：@vuagent/ui 以 npm 包分发且必须零 workspace 依赖，不能引入
 * protocol/typebox 运行时——派生器刻意输出普通 JSON Schema 对象字面量，得以文本级
 * 分发到 ui 侧（机制同 form-result-schema.ts 头注释）。
 *
 * 同步保障：两侧函数文本由 scripts/check-protocol-sync.mjs 的 FUNCTION_CORPUS
 * 函数级比对机械锁死。本文件不得新增 protocol 侧没有的声明。
 */

/** 结构别名占位（npm 自包含：不引入 @sinclair/typebox） */
type TSchema = Record<string, unknown>;

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

/** wizard 步字段 flatten：resultSchema 复用 form 派生器（key 冲突：后步覆盖前步） */
export function flattenWizardFields(steps: ReadonlyArray<{ fields?: ReadonlyArray<unknown> }>): unknown[] {
  const out: unknown[] = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    if (step && Array.isArray(step.fields)) out.push(...step.fields);
  }
  return out;
}
