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
  /**
   * 能力驱动的推理档位（能力运行时 P1）：请求级用户选择。
   * 保守策略——仅当生效档案声明 capabilities.reasoning.supported 且档位
   * 在 supportedEfforts 集合内时注入请求（reasoning_effort / thinking budget），
   * 否则静默忽略，行为与未携带时完全一致。
   */
  reasoningEffort?: string;
  /**
   * 本轮图片附件（能力运行时 P2 视觉通道）：base64（无 data: 前缀）。
   * 路由层已做结构校验与能力门禁（未声明图片输入的模型直接 400）；
   * agent-loop 将其组装为本轮 user 消息的 content parts。
   */
  images?: TurnImageInput[];
  /**
   * 附件元数据（TASK-050 回显）：全部附件（图片 + 文本文件）的名字/类型/大小，
   * 仅用于 TurnEntity 落库与前端历史占位渲染，不参与请求构造。
   */
  attachments?: Array<{ name: string; kind: "image" | "file"; size: number }>;
  /**
   * TASK-101 实验原型（VUAGENT_EXPERIMENT_RESUME=1 门控，不进默认路径）：
   * 从指定 checkpoint 快照重建历史起点续跑（resumed 归因）。语义与边界见
   * docs/design/mid-turn-resume.md——仅程序化宿主可用，HTTP 路由不暴露该字段。
   */
  resumeFromCheckpointId?: string;
}

/** 图片附件入参：结构校验见 /api/chat 路由（张数/大小/类型白名单） */
export interface TurnImageInput {
  name: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** base64 编码内容（不带 data: 前缀），解码后 ≤5MB */
  data: string;
}
