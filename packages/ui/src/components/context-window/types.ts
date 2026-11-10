/** VaContextWindow 的类型定义 */

export type ContextKind = "system" | "file" | "history" | "tools";

export interface ContextPart {
  id: string;
  /** 悬停提示的名称，如 "router.ts" */
  label: string;
  tokens: number;
  kind: ContextKind;
}

export interface ContextWindowProps {
  parts: ContextPart[];
  /** 模型上下文容量（tokens），如 128_000 */
  capacity: number;
  /** 压缩中：历史格子微光收缩，结束后父层替换 parts */
  compacting?: boolean;
  /** 是否允许移除文件格子 */
  removable?: boolean;
}

export interface ContextWindowEvents {
  remove: [part: ContextPart];
  compact: [];
}

export const CONTEXT_KIND_LABEL: Record<ContextKind, string> = {
  system: "系统提示",
  file: "文件",
  history: "对话历史",
  tools: "工具结果",
};
