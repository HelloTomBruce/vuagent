/** VaOtpInput 的类型定义 */

export interface OtpInputProps {
  /** 格子数，默认 6 */
  length?: number;
  /** 受控值（配合 @update:modelValue 实现 v-model） */
  modelValue?: string;
  placeholder?: string;
  /** 禁用 */
  disabled?: boolean;
  /** 完成后是否自动把焦点移出 */
  autofocusLeave?: boolean;
  /** 输入框组 aria-label */
  label?: string;
}

export interface OtpInputEvents {
  "update:modelValue": [v: string];
  /** 全部填满时触发一次（重新编辑后再满会再次触发） */
  complete: [v: string];
}
