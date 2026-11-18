/**
 * 存储层核心领域实体定义 (Domain Entities)
 */

export type WorkspacePermission = "read-only" | "read-write" | "danger";

export interface WorkspaceEntity {
  id: string;
  name: string;
  rootPath: string; // 绝对路径
  permission: WorkspacePermission;
  ignorePatterns?: string[];
  systemInstruction?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ModelProfileEntity {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "deepseek" | "qwen" | "ollama" | "custom";
  model: string;
  baseUrl?: string;
  apiKey?: string; // 服务端安全存储；HTTP 查询/回显接口一律经 sanitizeModelProfile 脱敏（maskedApiKey，保留末 4 位），明文只在服务端内部使用
  contextWindow?: number;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    [key: string]: unknown;
  };
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = "active" | "paused" | "finished" | "error";

export interface CheckpointEntity {
  id: string;
  turnId: string;
  stepIndex: number;
  messagesSnapshot: unknown[];
  variableSnapshot?: Record<string, unknown>;
  snapshotAt: number;
}

export interface TurnEntity {
  id: string;
  sessionId: string;
  prompt: string;
  content?: string; // 助手回答正文 Markdown
  thought?: string; // 思考过程
  cards?: Array<{
    id: string;
    type: string;
    data: any;
  }>;
  plan?: {
    title: string;
    steps: Array<{
      id: string;
      title: string;
      status: "pending" | "running" | "done" | "error";
      duration?: number;
    }>;
  };
  status: "running" | "suspended" | "done" | "error";
  stepCount: number;
  checkpoints: CheckpointEntity[];
  telemetry?: {
    durationMs: number;
    ttftMs?: number;
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    /** 本 turn 最后一步的真实上下文占用（最后一步 prompt + completion），供前端加载历史时水合仪表 */
    contextTokens?: number;
    laneEventsCount: number;
    /** 三泳道轨迹事件明细（detail/result 已截断），供前端 turn 内联轨迹渲染 */
    events?: Array<{
      id: string;
      at: number;
      endAt?: number;
      lane: "input" | "model" | "tool";
      role: "user" | "assistant" | "tool" | "system" | "context";
      title: string;
      detail?: string;
      result?: string;
      turn: number;
      durationMs?: number;
    }>;
  };
  createdAt: number;
  completedAt?: number;
}

/**
 * 手动压缩记录（TASK-008）：一次「压缩对话」操作的持久化元数据。
 * 下一轮 runTurn 重建历史时，前 compactedTurnCount 轮不入上下文，
 * 改为注入 summary 占位消息，使上下文占用断崖回落。
 */
export interface SessionCompactionEntity {
  /** 累计被折叠为摘要的轮次数（session.turns 前 N 轮） */
  compactedTurnCount: number;
  /** 注入到上下文开头的摘要文本（role:user 占位消息内容） */
  summary: string;
  /** 本次压缩落库的 compaction checkpoint id */
  checkpointId: string;
  /** 压缩前上下文占用估算（tokens） */
  beforeTokens: number;
  /** 压缩后上下文占用估算（tokens） */
  afterTokens: number;
  /** 压缩时间戳 */
  compactedAt: number;
}

export interface SessionEntity {
  id: string;
  workspaceId: string;
  title: string;
  status: SessionStatus;
  activeModelProfileId?: string;
  /** 本会话生效的权限模式（review | auto | readonly），随会话持久化 */
  permission?: string;
  systemContext?: string;
  turns: TurnEntity[];
  /** 最近一次手动压缩记录（TASK-008），历史重建时据此折叠轮次并注入摘要 */
  compaction?: SessionCompactionEntity;
  createdAt: number;
  updatedAt: number;
}
