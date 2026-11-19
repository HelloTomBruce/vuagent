/** VaSelect 的类型定义 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** 分组名：同组选项渲染在 role=group 容器内并带组标题 */
  group?: string;
  /** 选项辅助描述（次要文本） */
  description?: string;
}

/** 单选为 string，多选为 string[] */
export type SelectValue = string | string[];

export type SelectSize = "sm" | "md" | "lg";

export interface SelectProps {
  options: SelectOption[];
  /** 受控选中值（配合 @update:modelValue 实现 v-model） */
  modelValue?: SelectValue;
  /** 非受控初始值 */
  defaultValue?: SelectValue;
  /** 多选：值为 string[]，选项前显示勾选框 */
  multiple?: boolean;
  /** 弹层顶部搜索输入（无匹配显示 emptyLabel） */
  searchable?: boolean;
  /** hover 显示清除按钮 */
  clearable?: boolean;
  size?: SelectSize;
  disabled?: boolean;
  /** 错误态：红色边框 + aria-invalid */
  invalid?: boolean;
  /** 加载态：触发器显示 spinner */
  loading?: boolean;
  placeholder?: string;
  /** 搜索无匹配文案 */
  emptyLabel?: string;
  /** 触发器 aria-label */
  label?: string;
  /** 非受控初始打开（SSR/演示用） */
  defaultOpen?: boolean;
}

export interface SelectEvents {
  "update:modelValue": [value: SelectValue];
  /** 选中某项后触发（携带新值与被选项） */
  change: [value: SelectValue, option: SelectOption];
  /** 清除按钮清空选中 */
  clear: [];
  /** 弹层开关变化 */
  visibleChange: [open: boolean];
}

export interface SelectSlots {
  /** 自定义选项渲染 */
  option?: (props: { option: SelectOption; selected: boolean; active: boolean }) => unknown;
  /** 无匹配项内容 */
  empty?: () => unknown;
  /** 自定义选中回显 */
  value?: (props: { options: SelectOption[]; values: string[] }) => unknown;
}
