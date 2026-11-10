/** VaMessageActions / VaMessageText 的类型定义 */

export type MessageActionKind = "copy" | "regenerate" | "feedback";
export type FeedbackKind = "up" | "down";

export interface MessageActionsProps {
  /** 复制按钮携带的文本 */
  text?: string;
  /** 版本总数；≥ 2 时显示版本切换器 */
  versions?: number;
  /** 再生成进行中：按钮旋转 */
  regenerating?: boolean;
  /** 安静模式：默认半透明，悬停本组件时显现 */
  quiet?: boolean;
  /** 点踩的快捷原因（默认内置四项 + 其他） */
  reasons?: string[];
}

export interface MessageActionsEvents {
  copy: [text?: string];
  regenerate: [];
  versionChange: [index: number];
  /** kind=null 表示撤回反馈 */
  feedback: [kind: FeedbackKind | null, reason?: string];
}

export interface MessageTextProps {
  /** 版本 key：变化时交叉淡入 */
  version: string | number;
}

export const DEFAULT_FEEDBACK_REASONS = ["不够准确", "太啰嗦", "没听懂指令"];
