/** VaGradientBorder 的类型定义 */

export interface GradientBorderProps {
  /** "static" 双色渐变描边（默认）| "running" conic 光环慢速旋转（Agent Ops「运行中」语义） */
  variant?: "static" | "running";
  /** 渐变起色（缺省 --va-grad-accent-from） */
  from?: string;
  /** 渐变止色（缺省 --va-grad-accent-to） */
  to?: string;
  /** 边框宽度 px（默认 1） */
  width?: number;
  /** running 光环周期：CSS 时长（"2.4s"）或毫秒数（1800）；缺省 var(--va-dur-loop, 1.8s) */
  speed?: string | number;
}
