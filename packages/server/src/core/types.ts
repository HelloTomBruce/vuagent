import type { TSchema } from "@sinclair/typebox";
import type { WorkspaceEntity, ModelProfileEntity } from "../storage/interfaces.js";
import type { ActionHub } from "./action-hub.js";

/**
 * Harness 标准事件流 (HarnessStreamEvent)
 * 契约统一：事件定义迁移至 @vuagent/protocol（TASK-002），此处 re-export 保持既有导入路径兼容
 */
export type {
  HarnessStreamEvent,
  UiComponentRenderResult,
} from "@vuagent/protocol";

/**
 * 工具风险等级
 */
export type ToolRiskLevel = "low" | "medium" | "high";

/**
 * 工具上下文
 */
export interface ToolExecutionContext<T = Record<string, unknown>> {
  toolCallId: string;
  args: T;
  workspace: WorkspaceEntity;
  actionHub: ActionHub;
  abortSignal: AbortSignal;
}

/**
 * 工具定义规范
 */
export interface HarnessTool<T = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: TSchema | Record<string, unknown>;
  riskLevel?: ToolRiskLevel;
  requiresApproval?: boolean;
  execute: (ctx: ToolExecutionContext<T>) => Promise<unknown>;
}

/**
 * 单轮执行请求入参
 */
export interface AgentTurnRequest {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  permission?: "auto" | "review" | "read-only" | "readonly";
  modelProfileId?: string;
  modelOverride?: Partial<ModelProfileEntity>;
  maxSteps?: number;
  timeoutMs?: number;
}
