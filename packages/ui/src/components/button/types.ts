/** VaButton 的类型定义 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  /** primary: 墨色实心 · secondary: 卡片+描边 · ghost: 纯文字 · destructive: 危险红 */
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  /** 标签进入微光态并阻止点击 */
  loading?: boolean;
  /** 占满一行 */
  block?: boolean;
}

export interface ButtonSlots {
  default?: () => unknown;
  icon?: () => unknown;
  "icon-right"?: () => unknown;
}
