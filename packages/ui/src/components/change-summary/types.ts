/** VaChangeSummary 的类型定义 */

import type { FileStatus } from "../file-tree/types";

export interface SummaryFile {
  path: string;
  status?: FileStatus;
  additions?: number;
  deletions?: number;
}

export interface ChangeSummaryProps {
  /** 本轮运行的标题，如"重构用户列表页" */
  title?: string;
  files: SummaryFile[];
  /** 总耗时 ms */
  duration?: number;
  /** 使用的工具调用次数 */
  toolCalls?: number;
  /** 完成时间（ms 时间戳） */
  finishedAt?: number;
  /** 折叠展示文件列表（超过该数量时；默认全部展示） */
  maxFiles?: number;
}

export interface ChangeSummaryEvents {
  /** 点击文件行（配合 FileTree/CodeDiff 联动） */
  openFile: [file: SummaryFile];
  /** 展开/收起长列表 */
  toggleAll: [];
}
