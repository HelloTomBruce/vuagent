/** VaMemoryPanel 的类型定义 */

export interface MemoryItem {
  id: string;
  text: string;
  /** 分组，如 "偏好" / "项目" */
  category: string;
  paused?: boolean;
}

export interface MemoryPanelProps {
  memories: MemoryItem[];
  title?: string;
  /** 遗忘托盘的可撤销时长 ms */
  undoMs?: number;
}

export interface MemoryPanelEvents {
  edit: [id: string, text: string];
  pause: [id: string, paused: boolean];
  forget: [id: string];
  restore: [items: MemoryItem[]];
}
