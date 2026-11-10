/** VaComposer 的类型定义 */

export interface ComposerProps {
  placeholder?: string;
  disabled?: boolean;
  /** agent 运行中：禁发并隐藏发送钮 */
  busy?: boolean;
  /** 输入区最大高度 px（超过后内部滚动） */
  maxHeight?: number;
  /** 输入为空时也允许发送 */
  allowEmpty?: boolean;
}

export interface ComposerEvents {
  "update:text": [text: string];
  send: [text: string];
}
