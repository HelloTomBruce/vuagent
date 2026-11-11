/** VaGradientFloor / VaGradientText 的类型定义 */

export interface GradientFloorProps {
  /** 光晕主色（CSS 色），默认 accent */
  color?: string;
  /** 副色（混合渐变），默认 info */
  color2?: string;
  /** 高度 px（默认 320） */
  height?: number;
  /** 光晕中心水平位置 0-1（默认 0.5 居中） */
  position?: number;
  /** 不透明度 0-1（默认 0.5） */
  opacity?: number;
  /** 慢速呼吸（默认 true，reduced-motion 自动停） */
  breathing?: boolean;
}

/* ---------- GradientText ---------- */

export interface GradientTextProps {
  text?: string;
  /** 渐变起色（默认 accent） */
  from?: string;
  /** 渐变止色（默认 info） */
  to?: string;
  /** 渐变角度（默认 120deg） */
  angle?: number;
  /** 渐变缓慢流动（默认 false） */
  animated?: boolean;
}
