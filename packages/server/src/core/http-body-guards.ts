/**
 * HTTP 路由入参校验（TASK-086）：POST/PATCH body 白名单 + 字段级 400 错误。
 *
 * 背景：POST /api/workspaces 与 /api/sessions 曾把 body 直通仓储层——
 * 任意 rootPath 直通使 fs/bash 沙箱随路径迁移（RCE 面），客户端可指定 id /
 * status / turns 等服务端属主字段。本模块延续路由层 pick 白名单惯例
 * （pickProviderPatch / pickModelPatch 同款）：未列字段一律丢弃，出现即校验、
 * 非法类型直接 400（不静默归一成空值，避免脏输入被吞成「清空字段」）。
 *
 * 与 config-schema（配置中心命名空间校验）分层：本模块只管实体路由的
 * 创建/部分更新入参，schema 演进随 storage/interfaces.ts 实体走。
 */
import path from "node:path";
import type { ProviderKind, WorkspacePermission } from "../storage/interfaces.js";

export type BodyGuardResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 实体路由允许的权限/状态枚举（与 storage/interfaces.ts 注释口径一致） */
const WORKSPACE_PERMISSIONS = new Set(["read-only", "read-write", "danger"]);
const SESSION_PERMISSIONS = new Set(["review", "auto", "readonly"]);
/**
 * 会话状态枚举：SessionStatus 四值 + 「archived」（playground 归档切换的事实协议值，
 * 存量前端 patchSession 发送 {status:"archived", archived:true}——严格按类型联合会破坏归档功能）。
 */
const SESSION_STATUSES = new Set(["active", "paused", "finished", "error", "archived"]);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** 只接受 http(s)：baseUrl 会被服务端拿去发请求，file:// 等协议须挡在门外 */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/* ==========================================================================
   工作区（POST /api/workspaces）
   ========================================================================== */

export interface CreateWorkspaceInput {
  name: string;
  /** 已 resolve 归一的绝对路径 */
  rootPath: string;
  permission?: WorkspacePermission;
  ignorePatterns?: string[];
  systemInstruction?: string;
}

/** 解析 VUAGENT_WORKSPACE_ROOTS（逗号分隔绝对路径前缀白名单；未配置 = 空数组） */
export function parseWorkspaceRoots(raw: string | undefined): string[] {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

/** resolved 是否位于 prefix 内（含等于）；两侧均需已 path.resolve 归一 */
export function isPathUnderPrefix(resolved: string, prefix: string): boolean {
  return resolved === prefix || resolved.startsWith(prefix + path.sep);
}

/**
 * 创建工作区校验。rootPath 策略（TASK-086）：
 * 1. 必须绝对路径（相对路径会被 path.resolve 悄悄挂到进程 cwd 上，拒绝）；
 * 2. 可选 VUAGENT_WORKSPACE_ROOTS 前缀白名单——配置后工作区沙箱只能落在
 *    允许目录内（fs/bash 全部跟随 rootPath，此闸门即沙箱边界）。
 * 不做存在性检查（创建时目录可尚不存在；诚实错误留给 fs/bash 首次访问）。
 */
export function validateCreateWorkspaceBody(
  body: unknown,
  env: Record<string, string | undefined> = process.env
): BodyGuardResult<CreateWorkspaceInput> {
  if (!isPlainObject(body)) return { ok: false, error: "body 必须是 JSON 对象" };
  if (!nonEmptyString(body.name)) return { ok: false, error: "name 必须是非空字符串" };
  if (body.name.trim().length > 200) return { ok: false, error: "name 长度不能超过 200" };
  if (!nonEmptyString(body.rootPath)) return { ok: false, error: "rootPath 必须是非空字符串" };
  const rawRoot = body.rootPath.trim();
  if (!path.isAbsolute(rawRoot)) {
    return { ok: false, error: `rootPath 必须是绝对路径（收到「${rawRoot}」）` };
  }
  const resolvedRoot = path.resolve(rawRoot);
  const roots = parseWorkspaceRoots(env.VUAGENT_WORKSPACE_ROOTS);
  if (roots.length > 0 && !roots.some((p) => isPathUnderPrefix(resolvedRoot, p))) {
    return {
      ok: false,
      error: `rootPath「${resolvedRoot}」不在 VUAGENT_WORKSPACE_ROOTS 白名单内（允许前缀：${roots.join("、")}）`,
    };
  }
  if (body.permission !== undefined) {
    if (typeof body.permission !== "string" || !WORKSPACE_PERMISSIONS.has(body.permission)) {
      return {
        ok: false,
        error: `permission 只支持 ${[...WORKSPACE_PERMISSIONS].join(" / ")}（收到「${String(body.permission)}」）`,
      };
    }
  }
  let ignorePatterns: string[] | undefined;
  if (body.ignorePatterns !== undefined) {
    if (!Array.isArray(body.ignorePatterns) || body.ignorePatterns.some((p) => typeof p !== "string")) {
      return { ok: false, error: "ignorePatterns 必须是字符串数组" };
    }
    ignorePatterns = body.ignorePatterns as string[];
  }
  if (body.systemInstruction !== undefined && typeof body.systemInstruction !== "string") {
    return { ok: false, error: "systemInstruction 必须是字符串" };
  }
  return {
    ok: true,
    value: {
      name: body.name.trim(),
      rootPath: resolvedRoot,
      permission: body.permission as WorkspacePermission | undefined,
      ignorePatterns,
      systemInstruction: body.systemInstruction as string | undefined,
    },
  };
}

/* ==========================================================================
   会话（POST /api/sessions · PATCH /api/sessions/:id）
   ========================================================================== */

export interface CreateSessionInput {
  workspaceId: string;
  title?: string;
  activeModelProfileId?: string;
  permission?: string;
  systemContext?: string;
}

export function validateCreateSessionBody(body: unknown): BodyGuardResult<CreateSessionInput> {
  if (!isPlainObject(body)) return { ok: false, error: "body 必须是 JSON 对象" };
  if (!nonEmptyString(body.workspaceId)) return { ok: false, error: "workspaceId 必须是非空字符串" };
  if (body.title !== undefined) {
    if (typeof body.title !== "string") return { ok: false, error: "title 必须是字符串" };
    if (body.title.length > 200) return { ok: false, error: "title 长度不能超过 200" };
  }
  if (body.activeModelProfileId !== undefined && !nonEmptyString(body.activeModelProfileId)) {
    return { ok: false, error: "activeModelProfileId 出现时必须是非空字符串" };
  }
  if (body.permission !== undefined) {
    if (typeof body.permission !== "string" || !SESSION_PERMISSIONS.has(body.permission)) {
      return {
        ok: false,
        error: `permission 只支持 ${[...SESSION_PERMISSIONS].join(" / ")}（收到「${String(body.permission)}」）`,
      };
    }
  }
  if (body.systemContext !== undefined && typeof body.systemContext !== "string") {
    return { ok: false, error: "systemContext 必须是字符串" };
  }
  return {
    ok: true,
    value: {
      workspaceId: body.workspaceId.trim(),
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      activeModelProfileId: body.activeModelProfileId as string | undefined,
      permission: body.permission as string | undefined,
      systemContext: body.systemContext as string | undefined,
    },
  };
}

export interface UpdateSessionInput {
  title?: string;
  /** SessionStatus 四值 + 存量「archived」（见 SESSION_STATUSES 注释） */
  status?: string;
  pinned?: boolean;
  archived?: boolean;
  activeModelProfileId?: string;
  permission?: string;
  systemContext?: string;
}

/**
 * 会话部分更新校验：白名单外字段（turns / workspaceId / compaction / id /
 * createdAt 等）一律丢弃——会话正文与归属是服务端属主数据，客户端只能改元数据。
 * presence 语义：字段出现即校验（与 pickModelPatch 的「显式传了就必须合法」同规）。
 */
export function validateUpdateSessionBody(body: unknown): BodyGuardResult<UpdateSessionInput> {
  if (!isPlainObject(body)) return { ok: false, error: "body 必须是 JSON 对象" };
  const out: UpdateSessionInput = {};
  if ("title" in body) {
    if (!nonEmptyString(body.title)) return { ok: false, error: "title 出现时必须是非空字符串" };
    if (body.title.length > 200) return { ok: false, error: "title 长度不能超过 200" };
    out.title = body.title.trim();
  }
  if ("status" in body) {
    if (typeof body.status !== "string" || !SESSION_STATUSES.has(body.status)) {
      return {
        ok: false,
        error: `status 只支持 ${[...SESSION_STATUSES].join(" / ")}（收到「${String(body.status)}」）`,
      };
    }
    out.status = body.status;
  }
  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") return { ok: false, error: "pinned 必须是布尔值" };
    out.pinned = body.pinned;
  }
  if ("archived" in body) {
    if (typeof body.archived !== "boolean") return { ok: false, error: "archived 必须是布尔值" };
    out.archived = body.archived;
  }
  if ("activeModelProfileId" in body) {
    if (!nonEmptyString(body.activeModelProfileId)) {
      return { ok: false, error: "activeModelProfileId 出现时必须是非空字符串" };
    }
    out.activeModelProfileId = body.activeModelProfileId;
  }
  if ("permission" in body) {
    if (typeof body.permission !== "string" || !SESSION_PERMISSIONS.has(body.permission)) {
      return {
        ok: false,
        error: `permission 只支持 ${[...SESSION_PERMISSIONS].join(" / ")}（收到「${String(body.permission)}」）`,
      };
    }
    out.permission = body.permission;
  }
  if ("systemContext" in body) {
    if (typeof body.systemContext !== "string") return { ok: false, error: "systemContext 必须是字符串" };
    out.systemContext = body.systemContext;
  }
  return { ok: true, value: out };
}

/* ==========================================================================
   模型档案（POST /api/settings/models，遗留内联创建路径）
   ========================================================================== */

export interface CreateModelProfileInput {
  name: string;
  model: string;
  /** 已过 isProviderKind 闸门 */
  provider: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number;
  capabilities?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  temperature?: number;
  isDefault?: boolean;
  providerId?: string;
}

/**
 * 遗留内联模型档案创建校验（供应商下建模型走 /api/settings/providers/:id/models，
 * 已有 pickModelPatch + 必填校验）。id 不在白名单：资源标识是服务端属主字段。
 */
export function validateCreateModelProfileBody(
  body: unknown,
  isProviderKind: (v: unknown) => boolean
): BodyGuardResult<CreateModelProfileInput> {
  if (!isPlainObject(body)) return { ok: false, error: "body 必须是 JSON 对象" };
  if (!nonEmptyString(body.name)) return { ok: false, error: "name 必须是非空字符串" };
  if (body.name.trim().length > 200) return { ok: false, error: "name 长度不能超过 200" };
  if (!nonEmptyString(body.model)) return { ok: false, error: "model 必须是非空字符串" };
  if (!nonEmptyString(body.provider)) return { ok: false, error: "provider 必须是非空字符串" };
  if (!isProviderKind(body.provider)) {
    return { ok: false, error: `未知的 provider 类型「${String(body.provider)}」` };
  }
  let baseUrl: string | undefined;
  if (body.baseUrl !== undefined && body.baseUrl !== "") {
    if (typeof body.baseUrl !== "string" || !isHttpUrl(body.baseUrl)) {
      return { ok: false, error: "baseUrl 必须是合法的 http(s) 地址" };
    }
    baseUrl = body.baseUrl.trim();
  }
  if (body.apiKey !== undefined && typeof body.apiKey !== "string") {
    return { ok: false, error: "apiKey 必须是字符串" };
  }
  if (body.contextWindow !== undefined) {
    if (typeof body.contextWindow !== "number" || !Number.isFinite(body.contextWindow) || body.contextWindow <= 0) {
      return { ok: false, error: "contextWindow 必须是正数" };
    }
  }
  if (body.capabilities !== undefined && !isPlainObject(body.capabilities)) {
    return { ok: false, error: "capabilities 必须是对象" };
  }
  if (body.parameters !== undefined && !isPlainObject(body.parameters)) {
    return { ok: false, error: "parameters 必须是对象" };
  }
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== "number" || !Number.isFinite(body.temperature)) {
      return { ok: false, error: "temperature 必须是数字" };
    }
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== "boolean") {
    return { ok: false, error: "isDefault 必须是布尔值" };
  }
  if (body.providerId !== undefined && !nonEmptyString(body.providerId)) {
    return { ok: false, error: "providerId 出现时必须是非空字符串" };
  }
  return {
    ok: true,
    value: {
      name: body.name.trim(),
      model: body.model.trim(),
      provider: body.provider as ProviderKind,
      baseUrl,
      apiKey: body.apiKey as string | undefined,
      contextWindow: body.contextWindow as number | undefined,
      capabilities: body.capabilities as Record<string, unknown> | undefined,
      parameters: body.parameters as Record<string, unknown> | undefined,
      temperature: body.temperature as number | undefined,
      isDefault: body.isDefault as boolean | undefined,
      providerId: body.providerId as string | undefined,
    },
  };
}
