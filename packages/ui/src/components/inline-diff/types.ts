/** VaInlineDiff 的类型定义 */

export interface InlineDiffProps {
  /** 原文 */
  original: string;
  /** AI 修改稿 */
  revised: string;
  title?: string;
}

export interface InlineDiffEvents {
  /** 全部决断后应用，携带合成后的最终文本 */
  apply: [result: string];
}
