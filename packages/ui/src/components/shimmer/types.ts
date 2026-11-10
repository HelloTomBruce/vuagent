/** VaSkeleton / VaShimmerText 的类型定义 */

export interface SkeletonProps {
  /** 数字按 px，字符串按任意 CSS 长度；默认 100% */
  width?: number | string;
  /** 默认 12px */
  height?: number | string;
  /** 圆角；默认 6px */
  radius?: number | string;
  /** 圆形（头像等），取 height 为直径 */
  circle?: boolean;
}

export interface ShimmerTextProps {
  /** 一次扫光的秒数 */
  duration?: number;
}
