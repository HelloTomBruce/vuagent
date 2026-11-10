/** VaTextReveal 的类型定义 */

export interface TextRevealProps {
  /** 要入场的文本 */
  text: string;
  /** 切分粒度：逐词 / 逐字（中文自动逐字效果好） */
  by?: "word" | "char";
  /** 两段之间的间隔 ms */
  stagger?: number;
  /** 首段等待 ms */
  delay?: number;
  /** 单段浮现时长 ms */
  duration?: number;
  /** 渲染标签 */
  as?: "span" | "p" | "h1" | "h2" | "h3";
  /** 只在首次进入视口时播放 */
  once?: boolean;
}
