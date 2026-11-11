/** VaAiAnswer 的类型定义 */

export interface AnswerSource {
  id: string;
  /** 来源标题，如「Vuagent 文档 · 快速开始」 */
  title: string;
  /** 链接（不设则为纯文本来源） */
  url?: string;
  /** 域名/出处短标，如 "vuagent.dev" */
  origin?: string;
}

export interface AiAnswerProps {
  /** 用户问题（小字展示在答案上方） */
  question?: string;
  /**
   * 回答正文；支持引用标记 [1] [2]（与 sources 下标对应），
   * 渲染为可点击上标角标
   */
  answer: string;
  sources: AnswerSource[];
  /** 流式回答中（末尾光标动画） */
  streaming?: boolean;
  /** 流式光标间隔风格文案占位 */
  streamingLabel?: string;
}

export interface AiAnswerEvents {
  /** 点击正文中的引用角标或底部来源行 */
  source: [source: AnswerSource];
}
