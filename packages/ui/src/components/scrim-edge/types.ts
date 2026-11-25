/** VaScrimEdge 的类型定义 */

/** 渐变依附边：bottom = 底边向上渐隐，其余三向同理 */
export type ScrimEdgeDirection = "bottom" | "top" | "left" | "right";

export interface ScrimEdgeProps {
  /** 渐变依附边（默认 bottom） */
  direction?: ScrimEdgeDirection;
  /** scrim 颜色（CSS 色）；缺省取 --va-scrim 遮罩色（亮暗自适应） */
  scrimColor?: string;
  /** 渐变厚度 px（bottom/top 为高、left/right 为宽，默认 72） */
  height?: number;
  /** 全色起点 / 全透明终点（%，默认 [0, 100] 线性渐隐） */
  stops?: [number, number];
}
