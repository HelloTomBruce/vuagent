/** mock 引擎的事件与状态类型 */
import type {
  AgentTask,
  AnswerSource,
  ApprovalRisk,
  Checkpoint,
  NotificationItem,
  PlanStep,
  SummaryFile,
  TerminalLine,
} from "@vuagent/ui";

/* ---------- 消息模型（比 ChatMessage 富：支持内嵌工具卡/审批/引用回答） ---------- */

export type AgentMessage =
  | { id: string; role: "user"; text: string; at: number }
  | { id: string; role: "agent"; kind: "text"; text: string; at: number }
  | { id: string; role: "agent"; kind: "thinking"; label: string; at: number }
  | {
      id: string;
      role: "agent";
      kind: "tools";
      /** 本条 agent 回复内聚的工具调用（ToolCallGroup 渲染） */
      calls: Array<{ name: string; summary: string; status: "running" | "success" | "error"; result?: unknown; ms: number }>;
      at: number;
    }
  | { id: string; role: "agent"; kind: "answer"; text: string; sources: AnswerSource[]; at: number }
  | { id: string; role: "agent"; kind: "recommend"; title: string; description: string; impact: string; at: number };

/* ---------- 审批门（ApprovalCard） ---------- */

export interface PendingApproval {
  title: string;
  preview: string;
  risk: ApprovalRisk;
  /** 秒；到 0 自动拒绝 */
  countdown?: number;
}

/* ---------- 洞察数据 ---------- */

export interface KpiState {
  label: string;
  value: number;
  format?: Intl.NumberFormatOptions;
  delta?: number;
  series: number[];
  invertDelta?: boolean;
}

/* ---------- 剧本时间线事件 ---------- */

export type ScenarioEvent =
  | { t: "thinking"; label: string; ms: number }
  | { t: "tool"; name: string; summary: string; ms: number; result?: unknown }
  | { t: "plan"; steps: Array<Pick<PlanStep, "id" | "title">> }
  | { t: "approval"; title: string; preview: string; risk: ApprovalRisk; countdown?: number }
  | { t: "stream"; text: string; cps?: number }
  | { t: "answer"; text: string; sources: AnswerSource[] }
  | { t: "recommend"; title: string; description: string; impact: string }
  | { t: "checkpoint"; label: string; files: number; additions: number; deletions: number }
  | { t: "diff"; file: string; oldText: string; newText: string }
  | { t: "tree"; changes: Array<{ path: string; status: "modified" | "added" | "deleted" | "untracked" }> }
  | { t: "terminal"; lines: (string | TerminalLine)[] }
  | { t: "summary"; files: SummaryFile[]; durationMs: number; toolCalls: number }
  | { t: "task"; task: AgentTask }
  | { t: "usage"; segment: string; add: number }
  | { t: "kpi"; key: "runs" | "done" | "fail"; push: number; delta?: number; bumpValue?: number }
  | { t: "experiment"; title: string; confidence: number; a: { value: number }; b: { value: number; delta: number } }
  | { t: "notify"; item: Omit<NotificationItem, "id" | "createdAt"> };

export interface Scenario {
  id: string;
  /** 触发关键词（命中任一即路由到该剧本） */
  keywords: string[];
  /** 剧本开场 agent 说的一句话（可空） */
  events: ScenarioEvent[];
}

/* ---------- 引擎状态 ---------- */

export interface EngineState {
  messages: AgentMessage[];
  busy: boolean;
  pendingApproval: PendingApproval | null;
  /** 审批等待的 resolver（deny 时用） */
  model: string;
  plan: PlanStep[];
  tasks: AgentTask[];
  checkpoints: Checkpoint[];
  changeSummary: { files: SummaryFile[]; durationMs: number; toolCalls: number } | null;
  diff: { file: string; oldText: string; newText: string } | null;
  tree: Array<{ path: string; status: "modified" | "added" | "deleted" | "untracked" }>;
  terminal: (string | TerminalLine)[];
  usage: { segments: Array<{ label: string; used: number }>; limit: number };
  kpis: Record<"runs" | "done" | "fail", KpiState>;
  breakdown: Array<{ label: string; value: number }>;
  experiment: { title: string; confidence: number; a: number; b: number; bDelta: number } | null;
  notifications: NotificationItem[];
  /** PromptLibrary「使用」写入 → Chat composer 读取 */
  promptDraft: string;
}
