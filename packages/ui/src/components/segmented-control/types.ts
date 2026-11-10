/** VaSegmentedControl 的类型定义 */

export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentOption[];
  size?: "sm" | "md";
  /** 等分撑满容器 */
  fullWidth?: boolean;
  /** 无 visible label 时的可访问名称 */
  ariaLabel?: string;
}

export interface SegmentedControlEvents {
  "update:modelValue": [value: string];
}
