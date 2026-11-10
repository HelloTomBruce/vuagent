/** VaStreamAnswer 的类型定义 */

export interface StreamAnswerProps {
  /** 完整回答文本（按节奏逐字吐出） */
  source: string;
  /** 挂载即播放 */
  autoPlay?: boolean;
  /** 逐字间隔 ms */
  interval?: number;
  /** 每次吐出的字符数 */
  chunk?: number;
}
