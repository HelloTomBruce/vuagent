/** VaCombobox 的类型定义 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** 右侧提示文案 */
  hint?: string;
  disabled?: boolean;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  /** 受控选中值（配合 @update:modelValue 实现 v-model） */
  modelValue?: string;
  /** 允许把输入内容创建为新值（触发 @create） */
  creatable?: boolean;
  placeholder?: string;
  /** 无匹配时文案；creatable 时显示"创建 xxx" */
  emptyLabel?: string;
  /** 触发输入框的 aria-label */
  label?: string;
}

export interface ComboboxEvents {
  "update:modelValue": [value: string];
  /** creatable 下创建新值 */
  create: [value: string];
  /** 从列表选中某项（create 不触发此事件） */
  select: [option: ComboboxOption];
}
