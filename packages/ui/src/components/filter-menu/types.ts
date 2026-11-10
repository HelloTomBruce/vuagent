/** VaFilterMenu 的类型定义 */

export type FilterGroupType = "checkbox" | "radio";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  type?: FilterGroupType;
  options: FilterOption[];
}

/** 过滤值：checkbox 组为 string[]，radio 组为 string（单值） */
export type FilterValue = Record<string, string[] | string>;

export interface FilterMenuProps {
  groups: FilterGroup[];
  /** 受控过滤值（配合 @update:modelValue 实现 v-model） */
  modelValue?: FilterValue;
  /** 触发按钮文案 */
  triggerLabel?: string;
  /** 非受控初始值 */
  defaultValue?: FilterValue;
}

export interface FilterMenuEvents {
  "update:modelValue": [value: FilterValue];
  /** 点击"清除"（携带空值，组件已同步） */
  clear: [];
}
