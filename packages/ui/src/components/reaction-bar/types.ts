/** VaReactionBar 的类型定义 */

export interface ReactionItem {
  id: string;
  /** emoji 本体，如 "👍" */
  emoji: string;
  /** 附加文案（如 "有帮助"） */
  label?: string;
  count?: number;
  /** 当前用户已选中 */
  active?: boolean;
  disabled?: boolean;
}

export interface ReactionBarProps {
  reactions: ReactionItem[];
  /** 单选模式（再点一次取消）；默认可多选 */
  single?: boolean;
}

export interface ReactionBarEvents {
  /** 切换某项（携带目标态） */
  toggle: [item: ReactionItem, nextActive: boolean];
}
