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
  apiKey?: string; // 服务端安全存储，查询时脱敏
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
    laneEventsCount: number;
  };
  createdAt: number;
  completedAt?: number;
}

export interface SessionEntity {
  id: string;
  workspaceId: string;
  title: string;
  status: SessionStatus;
  activeModelProfileId?: string;
  systemContext?: string;
  turns: TurnEntity[];
  createdAt: number;
  updatedAt: number;
}
