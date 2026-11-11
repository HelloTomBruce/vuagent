/** VaBlurCrossfade 的类型定义 */

export interface BlurCrossfadeProps {
  /** 切换键：值变化时旧内容 blur-out、新内容 blur-in */
  target: string | number;
  /** 过渡毫秒（默认 300） */
  duration?: number;
  /** 初始模糊半径 px（默认 8） */
  blur?: number;
  /** 垂直微移 px（默认 8，新内容从下方浮起） */
  rise?: number;
}
