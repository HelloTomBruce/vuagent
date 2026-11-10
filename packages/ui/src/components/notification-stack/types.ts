/** VaNotificationStack 的类型定义 */

export type NotificationKind = "info" | "success" | "warning" | "danger" | "agent";

export interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  kind?: NotificationKind;
  /** ms 时间戳 */
  createdAt?: number;
  unread?: boolean;
  /** 点击通知主体 */
  href?: string;
}

export interface NotificationStackProps {
  notifications: NotificationItem[];
  /** 标题，默认"通知" */
  title?: string;
  /** 显示相对时间 */
  relativeTime?: boolean;
  /** 空态文案 */
  emptyLabel?: string;
  /** 列表最大高度 px */
  maxHeight?: number;
}

export interface NotificationStackEvents {
  /** 点击通知（href 存在时也会触发） */
  open: [item: NotificationItem];
  /** 单条标记已读 */
  read: [id: string];
  /** 全部标记已读 */
  allRead: [];
}
