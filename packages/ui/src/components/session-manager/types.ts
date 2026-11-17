/** VaSessionManager 的类型定义（结构与协议 SessionMeta 保持一致） */

export interface SessionItem {
  id: string;
  /** 空串 = 未命名 */
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

export interface SessionManagerProps {
  sessions: SessionItem[];
  /** 当前活跃会话 id */
  activeId: string;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface SessionManagerEvents {
  /** 点击行（非当前会话）→ 切换 */
  select: [id: string];
  /** 新建会话 */
  create: [];
  /** 重命名完成 */
  rename: [id: string, title: string];
  /** 归档（true）/ 恢复（false） */
  archive: [id: string, archived: boolean];
  /** 删除（面板内已二次确认） */
  remove: [id: string];
}
