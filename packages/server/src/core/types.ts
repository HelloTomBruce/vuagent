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
  /**
   * 声明式元数据：该工具是否会写工作区（写文件 / 执行命令等副作用）。
   * read-only 模式与 read-only 工作区的权限闸门据此判定（TASK-012），
   * 取代按工具名字符串黑名单的脆弱实现 —— 带写副作用的工具必须显式声明 true。
   */
  writesWorkspace?: boolean;
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
  /**
   * TASK-058：轮次 ID 单一事实来源。经 hub 开轮时由 spawnRun 生成后传入，
   * 使 hub aborted/ops 事件、loop turn_start/落库 turnId、ops 台账全链路一致；
   * 缺省（直接调用 runTurn）时 agent-loop 回落自生成，兼容旧调用方。
   */
  turnId?: string;
}
