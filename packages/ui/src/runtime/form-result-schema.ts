/**
 * @vuagent/ui - form resultSchema 派生器（vendored 副本，TASK-092）
 *
 * 逐字同步自 @vuagent/protocol/src/form.ts 的 `FormFieldSpec` 与
 * `deriveFormResultSchema`（见该文件头注释「单一事实来源；ui 侧为文本同步的
 * vendored 副本」）。为什么 vendored：@vuagent/ui 以 npm 包分发且必须零
 * workspace 依赖（peer 仅 vue，见 ./protocol-types.ts 头注释），不能引入
 * protocol/typebox 运行时——派生器刻意不依赖 TypeBox（输出普通 JSON Schema
 * 对象字面量），得以文本级分发到 ui 侧。
 *
 * 同步保障：两侧函数文本由 scripts/check-protocol-sync.mjs 的函数级比对
 * （FUNCTION_CORPUS）机械锁死——任何一侧改动（哪怕一行）都会让卡口失败，
 * 杜绝双事实来源漂移。本文件不得新增 protocol 侧没有的声明。
 */

/** 结构别名占位（npm 自包含：不引入 @sinclair/typebox） */
type TSchema = Record<string, unknown>;

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
