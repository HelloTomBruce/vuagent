export interface TurnBlockItem {
  kind: "text" | "card";
  content?: string;
  cardId?: string;
}

export interface ActionCardItem {
  id: string;
  type: string;
  data?: any;
}

export interface AssistantTurnProps {
  /** 正文回答内容（无 blocks 时直接渲染） */
  content?: string;
  /** 思考链文本 */
  thought?: string;
  /** 是否展开详细思考内容（支持 v-model:thoughtExpanded） */
  thoughtExpanded?: boolean;
  /** 思考耗时（秒） */
  thoughtDuration?: number;
  /** 统一过程是否已折叠为摘要条（支持 v-model:processCollapsed） */
  processCollapsed?: boolean;
  /** 是否在回答结束时支持折叠为过程摘要条 */
  canCollapseProcess?: boolean;
  /** 工具调用次数（用于摘要条统计展示） */
  toolCount?: number;
  /** 是否处于流式响应中 */
  streaming?: boolean;
  /** 助手头像（支持图片链接、文字或 'bot'） */
  avatar?: string;
  /** 任务是否被中止 */
  aborted?: boolean;
  /** 中止成因文案（如：手动停止、超时等） */
  abortReason?: string;
  /** 时序交错块列表（文本与卡片穿插渲染） */
  blocks?: TurnBlockItem[];
  /** 卡片数据列表（与 blocks.cardId 对应） */
  cards?: ActionCardItem[];
  /** 是否启用底部消息操作条（复制/重发/反馈） */
  actionsEnabled?: boolean;
}

export interface AssistantTurnEvents {
  (e: "regenerate"): void;
  (e: "copy", text: string): void;
  (e: "feedback", kind: "up" | "down" | null, reason?: string): void;
  (e: "update:thoughtExpanded", value: boolean): void;
  (e: "update:processCollapsed", value: boolean): void;
}
