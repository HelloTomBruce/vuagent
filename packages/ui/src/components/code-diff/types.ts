/** VaCodeDiff 的类型定义 */

export interface CodeDiffProps {
  /** 旧版本文本（按行 diff） */
  oldText: string;
  /** 新版本文本 */
  newText: string;
  /** 文件名/路径，头部展示（等宽） */
  fileName?: string;
  /** 变更行前后保留的上下文行数，其余折叠；0 = 只显示变更行 */
  context?: number;
  /** 行内词级高亮（配对的 del/add 行做词级 diff） */
  wordLevel?: boolean;
  /** 初始全部展开（不折叠上下文） */
  defaultExpandAll?: boolean;
  /** 内容区最大高度 px，超出滚动 */
  maxHeight?: number;
}

export interface CodeDiffStats {
  additions: number;
  deletions: number;
}

export interface CodeDiffEvents {
  /** 点击复制按钮（携带复制的完整新文本） */
  copy: [text: string];
}
