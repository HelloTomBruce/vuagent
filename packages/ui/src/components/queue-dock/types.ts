/** VaQueueDock 的类型定义：排队消息 dock（G11：编辑/移除/插队） */

export interface QueueItem {
  id: string;
  text: string;
}

export interface QueueDockProps {
  items: QueueItem[];
  disabled?: boolean;
}

export interface QueueDockEvents {
  remove: [index: number];
  /** 插队：移动到队首（run 结束后立即下发） */
  sendNow: [index: number];
  /** 行内编辑文本（空串不提交） */
  edit: [index: number, text: string];
}
