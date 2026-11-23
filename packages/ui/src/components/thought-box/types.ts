export interface ThoughtBoxProps {
  /** 思考链或过程文本 */
  thought?: string;
  /** 是否展开详细思考内容（支持 v-model:expanded） */
  expanded?: boolean;
  /** 思考耗时（秒） */
  duration?: number;
  /** 是否处于流式思考状态中 */
  streaming?: boolean;
  /** 是否处于统一过程收起的单行摘要条模式（如：已完成 · 耗时 2.4s · 3 次工具调用） */
  summaryMode?: boolean;
  /** 工具调用次数（用于摘要条文案） */
  toolCount?: number;
}

export interface ThoughtBoxEvents {
  (e: "update:expanded", value: boolean): void;
  (e: "update:summaryMode", value: boolean): void;
  (e: "toggle", value: boolean): void;
}
