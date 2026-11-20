/**
 * Console 统一 API 客户端
 * 约定：业务码非 2xx 时返回 null（由调用方决定兜底行为），网络异常向上抛出（由调用方记录上下文日志）。
 */
import type { ModelProfileItem, SessionItem, WorkspaceItem } from "../types";
import type { UsageContextPart } from "@vuagent/protocol";

const JSON_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

/**
 * TASK-011 安全基线：服务端配置 VUAGENT_TOKEN 后要求 Bearer 鉴权。
 * 令牌来源：localStorage("vuagent_token") 优先，其次构建期注入的 VITE_VUAGENT_TOKEN。
 * dev 场景走 vite 代理（同源），令牌随请求头透传到后端。
 */
function resolveAuthToken(): string {
  let token = "";
  try {
    token = localStorage.getItem("vuagent_token") || "";
  } catch {
    // 非浏览器环境忽略
  }
  return token || (import.meta.env?.VITE_VUAGENT_TOKEN as string | undefined) || "";
}

function authHeaders(): Record<string, string> {
  const token = resolveAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function httpGet<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

async function httpSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T | null> {
  const res = await fetch(url, {
    method,
    headers: { ...authHeaders(), ...(body === undefined ? {} : JSON_HEADERS) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/* ==========================================================================
   类型
   ========================================================================== */

export interface SessionDetail extends SessionItem {
  turns?: any[];
  isRunning?: boolean;
  activeRun?: {
    turnId: string;
    prompt: string;
    startedAt: number;
  };
}

export interface ChatRequestBody {
  sessionId: string;
  workspaceId: string;
  prompt: string;
  modelProfileId?: string;
  permission?: string;
}

export interface PickDirectoryResult extends Partial<WorkspaceItem> {
  cancelled?: boolean;
}

export interface ModelProfilePayload {
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number;
  temperature?: number;
  isDefault?: boolean;
}

/* ==========================================================================
   工作区
   ========================================================================== */

export function listWorkspaces(): Promise<WorkspaceItem[] | null> {
  return httpGet<WorkspaceItem[]>("/api/workspaces");
}

export function createWorkspace(body: {
  name: string;
  rootPath: string;
  permission: string;
}): Promise<WorkspaceItem | null> {
  return httpSend<WorkspaceItem>("/api/workspaces", "POST", body);
}

/** 工作区文件树节点（结构与 @vuagent/ui 的 FileNode 对齐，path 为相对 rootPath 的 POSIX 路径） */
export interface WorkspaceFileNode {
  path: string;
  type: "file" | "dir";
  children?: WorkspaceFileNode[];
}

/** 工作区文件树（只读、有界：深度 4 / 节点 2000；truncated=true 表示超限截断） */
export function fetchWorkspaceFiles(id: string): Promise<{ tree: WorkspaceFileNode[]; truncated: boolean } | null> {
  return httpGet<{ root: string; tree: WorkspaceFileNode[]; truncated: boolean }>(
    `/api/workspaces/${id}/files`,
  );
}

export function deleteWorkspaceById(id: string): Promise<{ success: boolean } | null> {
  return httpSend<{ success: boolean }>(`/api/workspaces/${id}`, "DELETE");
}

export function pickDirectory(): Promise<PickDirectoryResult | null> {
  return httpSend<PickDirectoryResult>("/api/workspaces/pick-directory", "POST");
}

/* ==========================================================================
   会话
   ========================================================================== */

export function listSessions(): Promise<SessionItem[] | null> {
  return httpGet<SessionItem[]>("/api/sessions");
}

export function getSessionDetail(id: string): Promise<SessionDetail | null> {
  return httpGet<SessionDetail>(`/api/sessions/${id}`);
}

export function createSessionApi(body: {
  workspaceId: string;
  title: string;
  activeModelProfileId?: string;
  permission?: string;
}): Promise<SessionItem | null> {
  return httpSend<SessionItem>("/api/sessions", "POST", body);
}

export function patchSession(
  id: string,
  body: Record<string, unknown>
): Promise<SessionItem | null> {
  return httpSend<SessionItem>(`/api/sessions/${id}`, "PATCH", body);
}

export function deleteSessionById(id: string): Promise<{ success: boolean } | null> {
  return httpSend<{ success: boolean }>(`/api/sessions/${id}`, "DELETE");
}

/* ==========================================================================
   会话手动压缩（TASK-008）
   ========================================================================== */

export interface CompactSessionResult {
  success: boolean;
  /** false 表示历史不足以折叠（返回原占用），前端提示无需压缩 */
  compacted?: boolean;
  checkpointId?: string;
  beforeTokens: number;
  afterTokens: number;
  /** 释放的 token 估算（beforeTokens - afterTokens） */
  freed: number;
  /** 压缩后的上下文占用（前端仪表直接覆盖展示） */
  totalTokens: number;
  /** 压缩后的分段估算（system/history/tools），与 usage 事件 parts 同形 */
  parts?: UsageContextPart[];
  /** 累计折叠为摘要的轮次数 */
  compactedTurnCount: number;
}

/**
 * 手动压缩会话历史：服务端把早期轮次摘要化折叠（system + 摘要占位 + 最近 N 轮），
 * 直接返回压缩后的新占用。非 2xx 时抛出携带服务端错误信息的异常（供 toast 展示）。
 */
export async function compactSession(id: string): Promise<CompactSessionResult> {
  const res = await fetch(`/api/sessions/${id}/compact`, {
    method: "POST",
    headers: authHeaders(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (json as { error?: string })?.error || `压缩请求失败 [${res.status}] ${res.statusText}`
    );
  }
  return json as CompactSessionResult;
}

/* ==========================================================================
   模型配置
   ========================================================================== */

export function listModelProfiles(): Promise<ModelProfileItem[] | null> {
  return httpGet<ModelProfileItem[]>("/api/settings/models");
}

export function createModelProfileApi(
  body: ModelProfilePayload
): Promise<ModelProfileItem | null> {
  return httpSend<ModelProfileItem>("/api/settings/models", "POST", body);
}

export function updateModelProfileApi(
  id: string,
  body: ModelProfilePayload
): Promise<ModelProfileItem | null> {
  return httpSend<ModelProfileItem>(`/api/settings/models/${id}`, "PATCH", body);
}

export function deleteModelProfileById(id: string): Promise<{ success: boolean } | null> {
  return httpSend<{ success: boolean }>(`/api/settings/models/${id}`, "DELETE");
}

export interface ModelProbeResult {
  ok: boolean;
  latencyMs: number;
  endpoint: string;
  model: string;
  error?: string;
}

/** 连通性真探测（TASK-005）：发起最小 chat completion，返回首响应时延或真实错误 */
export async function testModelConnectionApi(body: {
  profileId?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
}): Promise<ModelProbeResult> {
  const res = await fetch("/api/settings/models/test", {
    method: "POST",
    headers: { ...authHeaders(), ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`探测请求失败 [${res.status}] ${res.statusText}`);
  }
  return (await res.json()) as ModelProbeResult;
}

/* ==========================================================================
   配置中心（TASK-024 服务端 /api/config；TASK-028 面板消费）
   ========================================================================== */

/** 配置字段描述（服务端 CONFIG_SCHEMA 下发；locked = env 部署级强制锁命中） */
export interface ConfigField {
  key: string;
  title: string;
  description: string;
  type: "boolean" | "number" | "string" | "text" | "select";
  default: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
  risk?: "high" | "medium" | "low";
  envLock?: string;
  /** env 显式设置时由服务端标记 true：UI 只读 + 锁标记，PATCH 会被 400 拒绝 */
  locked?: boolean;
}

/** 配置命名空间（schema 表驱动；values 为生效值，含 env 锁定覆盖） */
export interface ConfigNamespace {
  id: string;
  title: string;
  description: string;
  fields: ConfigField[];
  values: Record<string, unknown>;
  isDefault: boolean;
}

/** GET /api/config：schema + 各命名空间生效值 */
export function getConfig(): Promise<{ namespaces: ConfigNamespace[] } | null> {
  return httpGet<{ namespaces: ConfigNamespace[] }>("/api/config");
}

/** PATCH /api/config/:namespace：部分更新，返回落库后的生效值（含钳制/截断结果） */
export function patchConfig(
  namespace: string,
  values: Record<string, unknown>
): Promise<{ namespace: string; values: Record<string, unknown>; updatedAt: number } | null> {
  return httpSend(`/api/config/${encodeURIComponent(namespace)}`, "PATCH", values);
}

/** POST /api/config/:namespace/reset：恢复该命名空间全默认 */
export function resetConfig(
  namespace: string
): Promise<{ namespace: string; values: Record<string, unknown>; isDefault: boolean } | null> {
  return httpSend(`/api/config/${encodeURIComponent(namespace)}/reset`, "POST");
}

/* ==========================================================================
   工具启停（TASK-020；服务端 TASK-019 /api/tools）
   ========================================================================== */

/** GET /api/tools 单条工具描述（registry 元数据 ∪ 全局启用状态） */
export interface ToolItem {
  name: string;
  description: string;
  /** 服务端风险等级；缺省时服务端已兜底 "medium" */
  riskLevel: "high" | "medium" | "low";
  /** 是否具备写工作区副作用（写文件 / 执行命令） */
  writesWorkspace: boolean;
  /** 调用前是否强制 HITL 审批 */
  requiresApproval: boolean;
  /** 全局启用状态；缺配置记录 = 启用 */
  enabled: boolean;
  /** per-tool 超时覆盖（TASK-026）；null 表示未覆盖 */
  timeoutMs?: number | null;
  source: "builtin";
}

/** 拉取内置工具清单（含启停状态），非 2xx 返回 null */
export function listTools(): Promise<ToolItem[] | null> {
  return httpGet<ToolItem[]>("/api/tools");
}

/** PATCH /api/tools/:name：提交启停，返回服务端落库后的最新状态（实体含 timeoutMs/requiresApproval 覆盖字段） */
export function patchToolEnabled(
  name: string,
  enabled: boolean
): Promise<{ name: string; enabled: boolean; updatedAt: number } | null> {
  return httpSend<{ name: string; enabled: boolean; updatedAt: number }>(
    `/api/tools/${encodeURIComponent(name)}`,
    "PATCH",
    { enabled }
  );
}

/* ==========================================================================
   HITL 审批 / 中止
   ========================================================================== */

/** 跨会话待审批列表（审批收件箱数据源） */
export interface SuspendedActionItem {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  sessionId?: string;
  createdAt: number;
  timeoutMs: number;
  expiresAt: number;
}

export async function listSuspendedActions(): Promise<SuspendedActionItem[] | null> {
  return httpGet<SuspendedActionItem[]>("/api/action/suspended");
}

export async function submitAction(
  actionId: string,
  payload: { approved: boolean; note?: string }
): Promise<boolean> {
  const res = await fetch(`/api/action/${actionId}`, {
    method: "POST",
    headers: { ...authHeaders(), ...JSON_HEADERS },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function abortSession(sessionId: string): Promise<void> {
  try {
    await fetch(`/api/sessions/${sessionId}/abort`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {
    // 与原实现一致：中止请求失败静默吞掉
  }
}

/* ==========================================================================
   SSE 流（返回原始 Response，由 useChatStream 消费 reader）
   ========================================================================== */

export async function openChatStream(body: ChatRequestBody): Promise<Response> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { ...authHeaders(), ...JSON_HEADERS },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`服务器返回错误 [${res.status}] ${res.statusText}`);
  }
  return res;
}

export async function openSessionStream(sessionId: string): Promise<Response> {
  const res = await fetch(`/api/sessions/${sessionId}/stream`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`服务器返回错误 [${res.status}] ${res.statusText}`);
  }
  return res;
}

/* ==========================================================================
   成本观测（TASK-075：/api/finops/summary 首次前端消费）
   ========================================================================== */

/** 窗口用量（tokens = prompt + completion；costUsd 计价表命中才记钱） */
export interface FinopsWindowUsage {
  tokens: number;
  costUsd: number;
  recordCount: number;
}

export interface FinopsSummary extends FinopsWindowUsage {
  windowMs: number;
  since?: number;
  until?: number;
  byModel: Record<string, FinopsWindowUsage>;
}

/** GET /api/finops/summary：windowMs 滚动窗口（至此刻、无上界）或 since/until 自定义区间 */
export function fetchFinopsSummary(
  params: { windowMs?: number; since?: number; until?: number } = {}
): Promise<FinopsSummary | null> {
  const qs = new URLSearchParams();
  if (params.since && params.until) {
    qs.set("since", String(params.since));
    qs.set("until", String(params.until));
  } else if (params.windowMs) {
    qs.set("windowMs", String(params.windowMs));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return httpGet<FinopsSummary>(`/api/finops/summary${suffix}`);
}

/** finops 配额生效值（UsageMeter 分母；0 = 不限） */
export interface FinopsLimits {
  windowTokenLimit: number;
  windowUsdLimit: number;
  windowMs: number;
}

/** 从配置中心取 finops 配额生效值；结构异常回退 0（不限，配额条隐藏） */
export async function fetchFinopsLimits(): Promise<FinopsLimits> {
  const cfg = await getConfig();
  const ns = cfg?.namespaces.find((n) => n.id === "finops");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    windowTokenLimit: num(ns?.values.windowTokenLimit),
    windowUsdLimit: num(ns?.values.windowUsdLimit),
    windowMs: num(ns?.values.windowMs) || 86_400_000,
  };
}
