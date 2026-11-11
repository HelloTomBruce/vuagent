/** VaTiltCard 的类型定义 */

export interface TiltCardProps {
  /** 最大倾角（度，默认 8） */
  maxTilt?: number;
  /** 透视距离 px（默认 600） */
  perspective?: number;
  /** 悬停高光（跟随光斑） */
  glare?: boolean;
  /** 高光透明度 0-1（默认 0.18） */
  glareOpacity?: number;
  /** 缩放跟随（悬停轻微放大 1.02） */
  zoom?: boolean;
}
