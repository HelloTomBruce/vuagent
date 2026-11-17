/** VaConversationHeader 的类型定义：中央会话区头部（标题 + 视图 tabs + 状态） */

export interface HeaderView {
  id: string;
  label: string;
}

export interface ConversationHeaderProps {
  /** 会话标题（空串显示「未命名会话」） */
  title?: string;
  /** agent 运行中徽标 */
  running?: boolean;
  /** 运行计时文案（如 "00:42"），running 时展示 */
  elapsedLabel?: string;
  /** 待审批徽标 */
  waitingApproval?: boolean;
  /** 视图 tabs（聊天 / 轨迹…）；默认仅「聊天」 */
  views?: HeaderView[];
  /** 受控当前视图 */
  activeView?: string;
  /** 是否可重命名（默认 true） */
  renamable?: boolean;
}

export interface ConversationHeaderEvents {
  "update:activeView": [id: string];
  /** 提交重命名（空串/同名不触发） */
  rename: [title: string];
}
