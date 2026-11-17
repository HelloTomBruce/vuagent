/**
 * Console 统一 API 客户端
 * 约定：业务码非 2xx 时返回 null（由调用方决定兜底行为），网络异常向上抛出（由调用方记录上下文日志）。
 */
import type { ModelProfileItem, SessionItem, WorkspaceItem } from "../types";

const JSON_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

async function httpGet<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
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
    headers: body === undefined ? undefined : JSON_HEADERS,
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
  baseUrl?: string;
  apiKey?: string;
  model: string;
}): Promise<ModelProbeResult> {
  const res = await fetch("/api/settings/models/test", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`探测请求失败 [${res.status}] ${res.statusText}`);
  }
  return (await res.json()) as ModelProbeResult;
}

/* ==========================================================================
   HITL 审批 / 中止
   ========================================================================== */

export async function submitAction(
  actionId: string,
  payload: { approved: boolean; note?: string }
): Promise<boolean> {
  const res = await fetch(`/api/action/${actionId}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function abortSession(sessionId: string): Promise<void> {
  try {
    await fetch(`/api/sessions/${sessionId}/abort`, { method: "POST" });
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
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`服务器返回错误 [${res.status}] ${res.statusText}`);
  }
  return res;
}

export async function openSessionStream(sessionId: string): Promise<Response> {
  const res = await fetch(`/api/sessions/${sessionId}/stream`);
  if (!res.ok) {
    throw new Error(`服务器返回错误 [${res.status}] ${res.statusText}`);
  }
  return res;
}
