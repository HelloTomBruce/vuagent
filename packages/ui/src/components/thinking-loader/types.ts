/** VaThinkingLoader 的类型定义 */

export interface ThinkingLoaderProps {
  /** 轮播的阶段文案 */
  phases?: string[];
  /** 每阶段毫秒数 */
  interval?: number;
  /** 完成态：spinner 转为对勾 */
  done?: boolean;
  /** 完成后的文案 */
  doneLabel?: string;
  /** 走完一轮后从头再来 */
  loop?: boolean;
  size?: "sm" | "md";
}
