/**
 * 配置解析器（TASK-024）
 *
 * 两条路径的校验口径不同：
 * - 读路径 resolveNamespaceValues：永不抛异常——未知 key 忽略、类型不符回落默认、
 *   number 越界钳制、text 超长截断（存储数据可能来自旧版本/手工改库，必须容错）；
 * - 写路径 validateNamespacePatch：严格——未知 key / 类型不符 / select 非法 /
 *   env 锁定项一律拒绝（路由据此返回 400），number 越界钳制、text 超长截断后落库。
 *
 * envLock（部署级强制锁）：环境变量显式设置时该字段由 env 决定，
 * 读路径 env 优先、写路径拒绝修改（与 security.ts 的 env 信任边界一致）。
 */
import {
  getNamespaceSchema,
  type ConfigFieldSchema,
  type ConfigNamespaceSchema,
} from "./config-schema.js";
import type { HarnessConfigRepository } from "../storage/repositories/harness-config.repository.js";

/** env 布尔解析口径与 security.ts resolveSecurityConfig 一致（"1"/"true" 为真） */
function parseEnvBoolean(raw: string): boolean | null {
  if (["1", "true"].includes(raw)) return true;
  if (["0", "false"].includes(raw)) return false;
  return null;
}

function clampNumber(v: number, field: ConfigFieldSchema): number {
  if (field.min !== undefined && v < field.min) return field.min;
  if (field.max !== undefined && v > field.max) return field.max;
  return v;
}

function clampString(v: string, field: ConfigFieldSchema): string {
  if (field.maxLength !== undefined && v.length > field.maxLength) {
    return v.slice(0, field.maxLength);
  }
  return v;
}

/** envLock 命中（环境变量显式设置即锁定，与可否解析无关） */
export function isEnvLocked(field: ConfigFieldSchema): boolean {
  if (!field.envLock) return false;
  const raw = process.env[field.envLock];
  return raw !== undefined && raw !== "";
}

/**
 * env 锁定时的生效值：可解析取 env 值；不可解析回落字段默认（fail-closed，
 * 对安全类标记尤为关键——管理员的拼写错误不应静默放行存储层配置）。
 * 仅在 isEnvLocked(field) 为 true 时调用。
 */
function envLockedValue(field: ConfigFieldSchema): unknown {
  const raw = process.env[field.envLock!]!;
  if (field.type === "boolean") return parseEnvBoolean(raw) ?? field.default;
  if (field.type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? clampNumber(n, field) : field.default;
  }
  return raw; // string/text/select 直接使用
}

/** 读路径单字段净化：类型不符/缺值回落默认，number 钳制，string/text 截断 */
function sanitizeFieldValue(field: ConfigFieldSchema, raw: unknown): unknown {
  if (raw === undefined || raw === null) return field.default;
  switch (field.type) {
    case "boolean":
      return typeof raw === "boolean" ? raw : field.default;
    case "number":
      return typeof raw === "number" && Number.isFinite(raw) ? clampNumber(raw, field) : field.default;
    case "string":
    case "text":
      return typeof raw === "string" ? clampString(raw, field) : field.default;
    case "select":
      return typeof raw === "string" && field.options?.some((o) => o.value === raw)
        ? raw
        : field.default;
  }
}

/**
 * 读路径：生效值 = 默认值 ∪ 存储覆盖（经逐字段净化），envLock 项 env 优先。
 * 存储中的未知 key（旧版本残留/手改库）忽略。
 */
export function resolveNamespaceValues(
  ns: ConfigNamespaceSchema,
  stored: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of ns.fields) {
    out[field.key] = isEnvLocked(field)
      ? envLockedValue(field)
      : sanitizeFieldValue(field, stored?.[field.key]);
  }
  return out;
}

export type PatchValidation =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * 写路径严格校验：unknown key / 类型不符 / select 非法 / env 锁定 → 拒绝；
 * number 越界钳制、text 超长截断后作为待落库值返回。
 */
export function validateNamespacePatch(ns: ConfigNamespaceSchema, patch: unknown): PatchValidation {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return { ok: false, error: "body 必须是 { key: value } 对象" };
  }
  const values: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    const field = ns.fields.find((f) => f.key === key);
    if (!field) {
      return { ok: false, error: `未知配置项 [${key}]（命名空间 ${ns.id}）` };
    }
    if (isEnvLocked(field)) {
      return { ok: false, error: `配置项 [${key}] 由环境变量 ${field.envLock} 锁定，不可修改` };
    }
    switch (field.type) {
      case "boolean":
        if (typeof raw !== "boolean") return { ok: false, error: `配置项 [${key}] 需要 boolean` };
        values[key] = raw;
        break;
      case "number":
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          return { ok: false, error: `配置项 [${key}] 需要有限数值` };
        }
        values[key] = clampNumber(raw, field);
        break;
      case "string":
      case "text":
        if (typeof raw !== "string") return { ok: false, error: `配置项 [${key}] 需要字符串` };
        values[key] = clampString(raw, field);
        break;
      case "select":
        if (typeof raw !== "string" || !field.options?.some((o) => o.value === raw)) {
          return { ok: false, error: `配置项 [${key}] 需要可选值之一` };
        }
        values[key] = raw;
        break;
    }
  }
  return { ok: true, values };
}

/**
 * 配置中心门面：包一层仓库，供 agent-loop / 工具 / 路由逐次 resolve。
 * 无内部缓存——PATCH 后立刻读到新值（运行中生效口径）。
 */
export class ConfigResolver {
  constructor(private repo: HarnessConfigRepository) {}

  /** 解析命名空间生效值；未知命名空间返回 null（路由据此 404） */
  async resolve(namespace: string): Promise<Record<string, unknown> | null> {
    const ns = getNamespaceSchema(namespace);
    if (!ns) return null;
    const stored = await this.repo.getNamespace(namespace);
    return resolveNamespaceValues(ns, stored?.values);
  }

  /** 该命名空间是否处于全默认状态（无记录或无覆盖项） */
  async isDefault(namespace: string): Promise<boolean> {
    const stored = await this.repo.getNamespace(namespace);
    return !stored || Object.keys(stored.values).length === 0;
  }
}
