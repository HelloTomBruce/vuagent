/** VaGridBackground 的类型定义 */

export type GridDirection = "up" | "down" | "left" | "right" | "diagonal";

export interface GridBackgroundProps {
  /** 格子边长 px */
  size?: number;
  /** 每格漂移秒数；0 静止 */
  speed?: number;
  /** 漂移方向 */
  direction?: GridDirection;
  /** 线条颜色；默认取当前主题的弱描边 */
  color?: string;
  /** 边缘渐隐强度 0-100 */
  fade?: number;
}
