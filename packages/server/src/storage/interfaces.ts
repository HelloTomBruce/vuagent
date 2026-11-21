/**
 * 存储层核心领域实体定义 (Domain Entities)
 */

import type {
  InputModality,
  ModelCapabilities,
  ModelParameters,
  ProviderKind,
} from "@vuagent/protocol";

// 能力契约的唯一事实源在 @vuagent/protocol；这里 re-export 保持既有 import 路径可用
export type { InputModality, ModelCapabilities, ModelParameters, ProviderKind };
export { PROVIDER_KINDS, isProviderKind } from "@vuagent/protocol";

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

/**
 * 供应商实体：端点 + 凭证 + 协议，1:N 挂载多个模型。
 * 凭证只在此层存储一次，同供应商下的所有模型复用。
 */
export interface ProviderEntity {
  id: string;
  /** 显示名，如「DeepSeek 官方」 */
  name: string;
  /** 供应商类型：决定默认 baseUrl 与协议路由 */
  provider: ProviderKind;
  baseUrl?: string;
  apiKey?: string; // 服务端安全存储；HTTP 回显一律经 sanitizeProvider 脱敏
  /** 该供应商下所有模型的默认参数（模型可覆盖） */
  parameters?: ModelParameters;
  createdAt: number;
  updatedAt: number;
}

/**
 * 模型实体（沿用 model_profiles 集合名以兼容存量数据）。
 *
 * 与 ProviderEntity 的关系：providerId 存在时，baseUrl/apiKey 从 provider 继承
 * （模型上即便残留也以 provider 为准）；providerId 缺失表示「遗留内联配置」，
 * 由迁移逻辑在首次读取时归并到自动创建的 provider 下。
 */
export interface ModelProfileEntity {
  id: string;
  /** 所属供应商；缺失 = 遗留内联配置（等待迁移归并） */
  providerId?: string;
  name: string;
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  apiKey?: string; // 服务端安全存储；HTTP 查询/回显接口一律经 sanitizeModelProfile 脱敏（maskedApiKey，保留末 4 位），明文只在服务端内部使用
  /** 生效上下文窗口（capabilities.contextWindow 的扁平镜像，兼容既有读取方） */
  contextWindow?: number;
  /**
   * @deprecated 只用于兼容早期落库数据。
   * 写入路径统一归一到 parameters.temperature（由 SettingsRepository 的
   * normalizeProfileInput 处理），读取时 hydrateProfile 会把它并入 parameters。
   * 新代码请读 parameters.temperature。
   */
  temperature?: number;
  /** 结构化能力元数据（P0） */
  capabilities?: ModelCapabilities;
  parameters?: ModelParameters;
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
  /** 终态成因说明：执行错误消息 / process_restart（进程重启恢复标记，TASK-049）等 */
  errorMessage?: string;
  /** R8：中止成因（user/timeout/preempt/process_restart/token_budget），历史恢复呈现中止徽标；
   *  与 status 正交——优雅中止以 done 落库、异常中止以 error 落库，均有此标记 */
  abortedReason?: "user" | "timeout" | "preempt" | "process_restart" | "token_budget";
  /** 轮次收尾形态：explicit（finish_task 显式宣告）/ natural（自然停机）/ truncated（步数耗尽）；中止时无此标记 */
  finishReason?: "explicit" | "natural" | "truncated";
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
  /** 已置顶（前端会话列表排序用，随会话持久化） */
  pinned?: boolean;
  systemContext?: string;
  turns: TurnEntity[];
  /** 最近一次手动压缩记录（TASK-008），历史重建时据此折叠轮次并注入摘要 */
  compaction?: SessionCompactionEntity;
  createdAt: number;
  updatedAt: number;
}
