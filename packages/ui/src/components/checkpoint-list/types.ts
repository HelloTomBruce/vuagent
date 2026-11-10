/** VaCheckpointList 的类型定义 */

export interface Checkpoint {
  id: string;
  /** 检查点名称，如"安装依赖后" */
  label: string;
  /** 创建时间（ms 时间戳） */
  createdAt?: number;
  /** 变更摘要，如 "3 个文件 · +12 −4"；不传则用 files/additions/deletions 合成 */
  summary?: string;
  files?: number;
  additions?: number;
  deletions?: number;
  /** 该检查点是否为当前所在位置 */
  current?: boolean;
}

export interface CheckpointListProps {
  checkpoints: Checkpoint[];
  /** 正在恢复的检查点 id（对应项显示进行态）；新→旧排列由宿主决定 */
  restoring?: string;
  /** 恢复按钮的二次确认文案；空字符串关闭确认 */
  confirmLabel?: string;
  /** 内容区最大高度 px，超出滚动 */
  maxHeight?: number;
}

export interface CheckpointListEvents {
  /** 点击恢复（携带检查点 id） */
  restore: [id: string];
  /** 点击 diff 预览 */
  preview: [id: string];
}
