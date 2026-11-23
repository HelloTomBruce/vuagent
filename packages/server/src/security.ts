/**
 * 安全基线 (TASK-011)：本地单用户开发工具的默认信任边界
 *
 * 威胁模型：恶意网页驱动 localhost 服务（DNS rebinding / 跨站请求伪造）形成 RCE 链
 * （POST /api/workspaces 任意 rootPath → permission:"auto" bash_run 任意命令）。
 *
 * 三层防线：
 * 1. CORS/Origin 白名单：未配置令牌时仅允许本地前端 Origin（vite dev 5173 / preview 4173）
 * 2. Bearer 鉴权：配置 VUAGENT_TOKEN 后全部 /api/*（除 /api/health）要求令牌
 * 3. providerConfig 信任边界：默认拒绝前端自备 baseUrl/apiKey（SSRF 面），
 *    VUAGENT_ALLOW_BYO_PROVIDER=1 显式开启自备供应商模式
 */
import type { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { cors } from "hono/cors";
import type { ModelProfileEntity, ProviderEntity } from "./storage/interfaces.js";

/** 默认本地前端白名单（vite dev 5173 / vite preview 4173） */
export const DEFAULT_LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "http://localhost:6991",
  "http://127.0.0.1:6991",
];

export interface SecurityConfig {
  /** Bearer 鉴权令牌；空串表示未启用鉴权（来源：VUAGENT_TOKEN） */
  authToken: string;
  /** 是否允许前端自备供应商配置（来源：VUAGENT_ALLOW_BYO_PROVIDER=1） */
  allowByoProvider: boolean;
  /** 白名单外追加允许的 Origin（来源：VUAGENT_CORS_ORIGINS，逗号分隔） */
  extraOrigins: string[];
}

/** 解析安全配置：显式入参 > 环境变量 > 默认（全关，本地白名单兜底） */
export function resolveSecurityConfig(overrides: Partial<SecurityConfig> = {}): SecurityConfig {
  const rawExtra = (process.env.VUAGENT_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    authToken: overrides.authToken ?? (process.env.VUAGENT_TOKEN || "").trim(),
    allowByoProvider:
      overrides.allowByoProvider ?? ["1", "true"].includes(process.env.VUAGENT_ALLOW_BYO_PROVIDER || ""),
    extraOrigins: overrides.extraOrigins ?? rawExtra,
  };
}

/** Origin 是否在允许列表内；无 Origin 头（同源/非浏览器客户端）视为允许 */
export function isAllowedOrigin(origin: string, config: SecurityConfig): boolean {
  if (!origin) return true;
  if (DEFAULT_LOCAL_ORIGINS.includes(origin)) return true;
  return config.extraOrigins.includes(origin);
}

/** 恒时字符串比较（避免令牌校验引入时序侧信道） */
/** 常数时间字符串比较（防令牌逐字节探测）；鉴权中间件与 /metrics 出口共用 */
export function secureEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * 在 Hono 应用上注册安全基线中间件（CORS → Origin 主动拒绝 → Bearer 鉴权）。
 * 说明：hono cors 对 OPTIONS 预检短路返回 204，因此预检无需令牌；
 * /api/health 无敏感数据，免鉴权免 Origin 检查，供存活探针使用。
 */
export function applySecurityBaseline(app: Hono, config: SecurityConfig): void {
  // 1) CORS：未启用令牌时仅白名单 Origin 下发 CORS 头；启用令牌后允许任意 Origin（访问由令牌把守）
  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        if (!origin) return null; // 同源/非浏览器请求无需 CORS 头
        if (config.authToken) return origin;
        return isAllowedOrigin(origin, config) ? origin : null;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 86400,
    })
  );

  // 2) Origin 主动拒绝（纵深防御：CORS 头缺失只阻止浏览器读响应，这里直接拒绝处理请求）
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin") || "";
    if (
      origin &&
      !config.authToken &&
      !isAllowedOrigin(origin, config) &&
      c.req.path !== "/api/health"
    ) {
      return c.json(
        {
          error: `Forbidden: Origin "${origin}" 不在白名单内。本地开发请使用 ${DEFAULT_LOCAL_ORIGINS.join(" / ")}；远程访问请配置 VUAGENT_TOKEN 启用 Bearer 鉴权。`,
        },
        403
      );
    }
    await next();
  });

  // 3) Bearer 鉴权：配置 VUAGENT_TOKEN 后启用；/api/health 免检
  if (config.authToken) {
    app.use("/api/*", async (c, next) => {
      if (c.req.path === "/api/health") return next();
      const header = c.req.header("Authorization") || "";
      const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
      if (provided && secureEqual(provided, config.authToken)) return next();
      return c.json(
        { error: "Unauthorized: 缺少或错误的 Bearer 令牌，请携带 Authorization: Bearer <VUAGENT_TOKEN>" },
        401,
        { "WWW-Authenticate": "Bearer" }
      );
    });
  }
}

/* ==========================================================================
   apiKey 脱敏
   ========================================================================== */

/** 掩码 apiKey：保留末 4 位，前缀固定 ****；无密钥返回 undefined，短密钥不回显任何真实片段 */
export function maskApiKey(apiKey?: string): string | undefined {
  if (!apiKey) return undefined;
  return apiKey.length > 4 ? `****${apiKey.slice(-4)}` : "****";
}

/**
 * 脱敏模型 profile：剥离 apiKey 明文，替换为 maskedApiKey（查询/回显用）
 */
export function sanitizeModelProfile<T extends ModelProfileEntity>(
  profile: T
): Omit<T, "apiKey"> & { maskedApiKey?: string } {
  const { apiKey, ...rest } = profile;
  const masked = maskApiKey(apiKey);
  return masked ? { ...rest, maskedApiKey: masked } : { ...rest };
}

/**
 * 脱敏供应商：凭证只存在供应商层，回显同样只给掩码。
 */
export function sanitizeProvider<T extends ProviderEntity>(
  provider: T
): Omit<T, "apiKey"> & { maskedApiKey?: string } {
  const { apiKey, ...rest } = provider;
  const masked = maskApiKey(apiKey);
  return masked ? { ...rest, maskedApiKey: masked } : { ...rest };
}

/* ==========================================================================
   providerConfig / modelOverride 信任边界
   ========================================================================== */

export const BYO_FORBIDDEN_MESSAGE =
  "Forbidden: 默认安全基线禁止前端携带 providerConfig/baseUrl 自定义模型配置。" +
  "如需自备供应商模式，请以 VUAGENT_ALLOW_BYO_PROVIDER=1 启动服务；" +
  "或将 modelOverride 限定为服务端已登记的 profile（如 { \"id\": \"prof-xxx\" }），或直接使用 modelProfileId。";

/**
 * modelOverride 是否仅做「切换服务端已登记 profile」：形如 { id } 且不含任何覆盖字段。
 * 任何 baseUrl/apiKey/model/provider/parameters 等字段都视为前端自备配置，需要 BYO 开关。
 */
export function isProfileSelectionOnly(override: unknown): override is { id: string } {
  if (typeof override !== "object" || override === null || Array.isArray(override)) return false;
  const keys = Object.keys(override as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every((k) => k === "id" && typeof (override as Record<string, unknown>).id === "string");
}
