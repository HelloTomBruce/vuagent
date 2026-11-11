/** VaAgentRun 的类型定义 */

export interface AgentRunProps {
  /** 运行标题 */
  title?: string;
  /** 状态徽章：running/success/error */
  status?: "running" | "success" | "error";
  /** 状态文案（如「正在执行第 3/5 步」） */
  statusLabel?: string;
  /** 已运行 ms（配合 startedAt 由宿主计算后传入） */
  duration?: number;
  /** 布局密度：三栏（默认，≥1200px）/ 单栏顺排 */
  compact?: boolean;
}

export interface AgentRunEvents {
  /* 无：各区内容由插槽注入（plan / stream / aside / actions） */
}
