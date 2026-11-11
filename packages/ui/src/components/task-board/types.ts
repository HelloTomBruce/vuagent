/** VaTaskBoard 的类型定义 */

export interface BoardColumn {
  id: string;
  title: string;
  /** 列头徽标文案（如计数），缺省自动为列内任务数 */
  hint?: string;
}

export type TaskPriority = "low" | "medium" | "high";

export interface BoardTask {
  id: string;
  columnId: string;
  title: string;
  assignee?: string;
  priority?: TaskPriority;
  /** 截止/耗时等角标文案 */
  meta?: string;
}

export interface TaskBoardProps {
  columns: BoardColumn[];
  tasks: BoardTask[];
  /** 受控选中任务 id */
  selected?: string;
  defaultSelected?: string;
}

export interface TaskBoardEvents {
  "update:selected": [id: string | undefined];
  /** 点击卡片（携带任务） */
  open: [task: BoardTask];
}
