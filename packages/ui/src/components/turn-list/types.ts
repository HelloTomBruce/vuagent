import type { ActionCardItem, TurnBlockItem } from "../assistant-turn/types";
import type { UserAttachment } from "../user-bubble/types";

export interface TurnItem {
  id: string;
  role: "user" | "assistant" | "system";
  content?: string;
  attachments?: UserAttachment[];
  thought?: string;
  thoughtDuration?: number;
  thoughtExpanded?: boolean;
  processCollapsed?: boolean;
  streaming?: boolean;
  aborted?: boolean;
  abortReason?: string;
  blocks?: TurnBlockItem[];
  cards?: ActionCardItem[];
  avatar?: string;
  toolCount?: number;
}

export interface TurnListProps {
  /** 消息轮次列表 */
  turns: TurnItem[];
  /** 空状态提示文案 */
  emptyText?: string;
}

export interface TurnListEvents {
  (e: "regenerate", turnId: string): void;
  (e: "copy", text: string, turnId: string): void;
  (e: "feedback", turnId: string, kind: "up" | "down" | null, reason?: string): void;
  (e: "updateThoughtExpanded", turnId: string, expanded: boolean): void;
  (e: "updateProcessCollapsed", turnId: string, collapsed: boolean): void;
}
