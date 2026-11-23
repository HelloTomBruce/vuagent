export interface MarkdownProps {
  /** Markdown 原始字符串 */
  content?: string;
  /** 是否处于流式生成中（结尾追加呼吸感光标） */
  streaming?: boolean;
  /** 自动将 URL 识别为可点击超链接，默认 true */
  linkify?: boolean;
  /** 将 \n 转换为 <br>（对话场景友好），默认 true */
  breaks?: boolean;
}
