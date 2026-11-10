/** VaFileTree 的类型定义 */

export type FileStatus = "modified" | "added" | "deleted" | "untracked";

/** 状态单字母徽章 */
export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "U",
};

export interface FileNode {
  /** 完整路径（默认作为 id 与选中值） */
  path: string;
  /** 节点类型；缺省按有无 children 推断 */
  type?: "file" | "dir";
  /** 变更标记（目录上通常不设，由子节点聚合展示计数） */
  status?: FileStatus;
  children?: FileNode[];
}

export interface FileTreeProps {
  /** 顶层节点：根目录单元素，或直接的文件/目录列表 */
  tree: FileNode[];
  /** 初始展开深度：0 = 只显示第一层，默认 1 */
  defaultExpandDepth?: number;
  /** 受控选中路径（配合 @update:selected 实现 v-model:selected） */
  selected?: string;
  /** 非受控默认选中 */
  defaultSelected?: string;
  /** 头部统计条文案；空字符串隐藏 */
  title?: string;
  /** 内容区最大高度 px，超出滚动 */
  maxHeight?: number;
}

export interface FileTreeEvents {
  "update:selected": [path: string | undefined];
  select: [node: FileNode];
  toggle: [node: FileNode, expanded: boolean];
}
