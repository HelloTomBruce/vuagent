/**
 * @vuagent/ui - VaForm 类型定义（TASK-092，设计文档 §7）
 */

export type FormFieldType = "text" | "textarea" | "number" | "boolean" | "select" | "date";

export interface FormFieldOption {
  /** 机器值（回传 values 中的取值） */
  value: string;
  /** 人类文案（界面展示与摘要回映） */
  label: string;
}

/** 表单字段（与 @vuagent/protocol FormFieldSchema 结构化兼容；args 为不可信输入，渲染前已由 propAdapter 守卫收敛） */
export interface FormFieldItem {
  key: string;
  label: string;
  type: FormFieldType;
  /** 字段含义说明（摘要词汇表同源） */
  description?: string;
  required?: boolean;
  /** 预填默认值（模型上一轮 values 回显的载体） */
  default?: unknown;
  options?: FormFieldOption[];
  /** 数值单位后缀 */
  unit?: string;
  /** 敏感字段：密码态输入，值走 secret 通道（模型只见 ref/masked 占位） */
  secret?: boolean;
  placeholder?: string;
}

export interface VaFormProps {
  title?: string;
  /** 为什么需要这些信息（模型给用户的说明） */
  description?: string;
  fields: FormFieldItem[];
  submitLabel?: string;
  cancelLabel?: string;
  /** 非 executing 态禁用整表（渲染层守卫的双保险视觉位） */
  disabled?: boolean;
  loading?: boolean;
  /** server 422 / 本地预校验回填的逐字段错误（form-errors 通道） */
  fieldErrors?: Record<string, string>;
}

export interface VaFormEvents {
  /** 用户提交：values 为类型收敛后的值集合；editedFields 为用户亲自修改过的字段 key（meta.editedFields 同源） */
  (e: "submit", values: Record<string, unknown>, editedFields: string[]): void;
  (e: "cancel"): void;
}
