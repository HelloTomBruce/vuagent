/** VaTerminalLog 的类型定义 */

export type TerminalLineKind = "cmd" | "out" | "err" | "warn" | "ok";

/** 一行终端输出；字符串行等价于 { text }（kind: out） */
export interface TerminalLine {
  text: string;
  /** 行语义着色（与 ANSI 色共存：语义色优先打底，ANSI span 覆盖） */
  kind?: TerminalLineKind;
  /** 行 id；缺省用下标，流式追加时建议宿主自带 id */
  id?: string;
}

export interface TerminalLogProps {
  /** 输出行；含 ANSI 转义序列的 text 会被自动解析着色 */
  lines: (string | TerminalLine)[];
  /** 终端窗口标题栏文案，如 "bash — pnpm test" */
  title?: string;
  /** 新行到达时自动滚到底部（用户向上翻阅时暂停，滚回底部恢复）；默认 true */
  autoScroll?: boolean;
  /** 环形上限：超过后丢弃最旧行，默认 1000 */
  maxLines?: number;
  /** 显示行号 */
  showLineNumbers?: boolean;
  /** 内容区最大高度 px；不设则随内容撑开 */
  maxHeight?: number;
}

export interface TerminalLogEvents {
  /** 行复制按钮（携带该行纯文本） */
  copy: [text: string];
}
