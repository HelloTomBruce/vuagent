/** VaAgentInbox 的类型定义 */

export type AgentTaskStatus = "queued" | "running" | "waiting" | "done" | "error";
export type InboxFilter = "all" | "active" | "waiting" | "done";

export interface AgentTask {
  id: string;
  title: string;
  /** 执行该任务的 agent 名 */
  agent?: string;
  status: AgentTaskStatus;
  startedAt?: number;
  /** 结束任务（done/error）的最终耗时 ms */
  duration?: number;
  /** 最近步骤摘要（按数组顺序展示） */
  steps?: string[];
  error?: string;
}

export interface AgentInboxProps {
  tasks: AgentTask[];
}

export interface AgentInboxEvents {
  open: [task: AgentTask];
  retry: [task: AgentTask];
  cancel: [task: AgentTask];
}

/** 状态的中文标签 */
export const AGENT_STATUS_LABEL: Record<AgentTaskStatus, string> = {
  queued: "排队中",
  running: "进行中",
  waiting: "待审",
  done: "已完成",
  error: "失败",
};
