/** VaToaster 的类型定义 */

export type ToastKind = "info" | "success" | "warning" | "danger";

export interface ToastInput {
  title: string;
  description?: string;
  kind?: ToastKind;
  /** 自动消失毫秒数；0 表示不自动消失。默认 4200 */
  duration?: number;
}

export interface ToastItem extends ToastInput {
  kind: ToastKind;
  duration: number;
  id: number;
}

export interface ToasterProps {
  position?: "bottom-right" | "top-center";
}
