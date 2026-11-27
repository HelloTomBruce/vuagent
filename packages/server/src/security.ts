/**
 * 安全基线 (TASK-011)：本地单用户开发工具的默认信任边界
 *
 * 威胁模型：恶意网页驱动 localhost 服务（DNS rebinding / 跨站请求伪造）形成 RCE 链
 * （POST /api/workspaces 任意 rootPath → permission:"auto" bash_run 任意命令）。
 *
 * 三层防线：
 * 0. 绑定闸门（TASK-085）：默认 127.0.0.1 回环绑定；对外绑定需 VUAGENT_TOKEN，
 *    否则 VUAGENT_ALLOW_UNSAFE_NETWORK=1 显式豁免，拒绝静默裸奔（见 resolveBindPlan）
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
  "http://localhost:6995",
  "http://127.0.0.1:6995",
  "http://localhost:6996",
  "http://127.0.0.1:6996",
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

/** 回环主机判断（含 IPv6 字面量） */
function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * 同源回环放行：CLI 自托管的 console 跑在 `127.0.0.1:<任意端口>`（默认 6880），
 * 浏览器对 POST/PATCH/DELETE 会带 `Origin: http://127.0.0.1:<port>`——旧实现只认
 * dev 端口白名单，导致**自托管 console 的写请求全部 403**（新建工作区/会话/发消息）。
 * 这里放行「Origin 的 host 与请求 Host 相同、且是回环地址」的同源请求。
 *
 * 为什么不会削弱 DNS rebinding 防护：rebinding 页面以攻击者域名打开时，
 * Host 与 Origin 都是该域名（如 evil.com），hostname 非回环 → 依然拒绝。
 */
export function isSameOriginLoopback(origin: string, hostHeader?: string): boolean {
  if (!origin || !hostHeader) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(url.hostname)) return false;
  // Host 形如 `127.0.0.1:6880` / `[::1]:6880`：去掉端口即可比较主机名
  if (!isLoopbackHostname(hostHeader.replace(/:\d+$/, ""))) return false;
  return url.host === hostHeader;
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
 * 入参放宽为 Hono<any>：宿主 app 的 Variables 泛型各异（如 server.ts 注入 requestId），
 * 本函数只用 req/header/json 等稳定 API，与泛型无关。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applySecurityBaseline(app: Hono<any>, config: SecurityConfig): void {
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
  //    /metrics 同口径：无令牌模式下 DNS-rebinding 页面（rebind 后同源、无 Origin 头
  //    校验）可读运维指标——Origin 主动拒绝同样覆盖。
  const rejectForeignOrigin = async (c: { req: { header: (n: string) => string | undefined; path: string }; json: (b: unknown, s: 403) => Response }, next: () => Promise<void>) => {
    const origin = c.req.header("Origin") || "";
    const host = c.req.header("Host") || c.req.header("host") || "";
    if (
      origin &&
      !config.authToken &&
      !isAllowedOrigin(origin, config) &&
      !isSameOriginLoopback(origin, host) &&
      c.req.path !== "/api/health"
    ) {
      return c.json(
        {
          error: `Forbidden: Origin "${origin}" 不在白名单内（同源回环请求会自动放行）。本地开发请使用 ${DEFAULT_LOCAL_ORIGINS.join(" / ")}；远程访问请配置 VUAGENT_TOKEN 启用 Bearer 鉴权。`,
        },
        403
      );
    }
    await next();
  };
  app.use("/api/*", rejectForeignOrigin);
  app.use("/metrics", rejectForeignOrigin);

  // 3) Bearer 鉴权：配置 VUAGENT_TOKEN 后启用；/api/health 免检
  if (config.authToken) {
    app.use("/api/*", async (c, next) => {
      if (c.req.path === "/api/health") return next();
      if (bearerMatches(c.req.header("Authorization") || "", config.authToken)) return next();
      return c.json(
        { error: "Unauthorized: 缺少或错误的 Bearer 令牌，请携带 Authorization: Bearer <VUAGENT_TOKEN>" },
        401,
        { "WWW-Authenticate": "Bearer" }
      );
    });
  }
}

/** 从 Authorization 头提取 Bearer 令牌（无前缀/空值返回空串） */
export function extractBearerToken(header: string): string {
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

/** Bearer 令牌与配置令牌常时比较（供鉴权中间件与 /metrics 等免 /api 前缀路由复用） */
export function bearerMatches(header: string, authToken: string): boolean {
  const provided = extractBearerToken(header);
  return !!provided && secureEqual(provided, authToken);
}

/* ==========================================================================
   绑定闸门（TASK-085）：默认回环绑定，对外绑定需令牌或显式豁免
   ========================================================================== */

/** 主机名是否为回环地址：localhost / 127.x / ::1（含 [::1] 括号形态与首尾空白） */
export function isLoopbackHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  return h === "localhost" || h === "::1" || h.startsWith("127.");
}

export interface BindPlan {
  /** 实际监听主机（缺省 127.0.0.1；显式 VUAGENT_HOST 覆盖） */
  host: string;
  /** 是否对外（非回环）绑定 */
  external: boolean;
  /** 对外且未配置令牌，但被 VUAGENT_ALLOW_UNSAFE_NETWORK=1 豁免放行 */
  unsafeExempted: boolean;
  /** 对外且未配置令牌且未豁免 → 拒绝启动 */
  refused: boolean;
  /** 拒绝时的多行指引文案（refused=false 时为空串） */
  refusalReason: string;
}

/**
 * 解析监听绑定计划（TASK-085 启动闸门，index.ts 直启路径消费）：
 * - 默认 127.0.0.1（本机零配置即安全）；
 * - 非回环绑定需显式 VUAGENT_HOST；未配置 VUAGENT_TOKEN 时进一步要求
 *   VUAGENT_ALLOW_UNSAFE_NETWORK=1 显式豁免，否则拒绝启动——
 *   安全基线对「无 Origin 头」请求恒放行，对外裸奔等于把 bash 执行权暴露给网络可达者（RCE 面）。
 * 入参化 env 便于测试；宿主以编程方式嵌入时也可复用本函数做启动前自检。
 */
export function resolveBindPlan(
  env: Record<string, string | undefined> = process.env
): BindPlan {
  const host = (env.VUAGENT_HOST || "").trim() || "127.0.0.1";
  const external = !isLoopbackHost(host);
  const hasToken = !!(env.VUAGENT_TOKEN || "").trim();
  if (!external || hasToken) {
    return { host, external, unsafeExempted: false, refused: false, refusalReason: "" };
  }
  const exempt = ["1", "true"].includes((env.VUAGENT_ALLOW_UNSAFE_NETWORK || "").trim());
  if (exempt) {
    return { host, external, unsafeExempted: true, refused: false, refusalReason: "" };
  }
  const refusalReason = [
    `[Vuagent Harness Server] 拒绝启动：监听 ${host}（对外绑定）但未配置 VUAGENT_TOKEN。`,
    `  安全基线对「无 Origin 头」的请求恒放行，对外裸奔等于把 bash 执行权暴露给网络可达者（RCE 面）。`,
    `  两种放行方式：`,
    `    1) 配置 VUAGENT_TOKEN=<随机长令牌>，客户端以 Authorization: Bearer <token> 访问（推荐）；`,
    `    2) VUAGENT_ALLOW_UNSAFE_NETWORK=1 显式豁免（仅限隔离网络，自担风险）。`,
    `  本机使用请勿设置 VUAGENT_HOST（默认 127.0.0.1）。`,
  ].join("\n");
  return { host, external, unsafeExempted: false, refused: true, refusalReason };
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
   日志脱敏（TASK-089）
   ========================================================================== */

/** 键名含这些词的字符串值在日志输出中一律替换（args / 审批 payload 等均可能携带）。
 *  注：`auth` 词根会连带遮蔽 `author` 等罕见键——宁过遮不漏遮（安全侧偏置）。 */
const LOG_SECRET_KEY_RE = /key|token|secret|password|passwd|passphrase|pwd|credential|authorization|auth/i;
/** 单个字符串值的安全长度（base64 图片、长文件内容不进日志正文） */
const LOG_VALUE_MAX_CHARS = 500;
/** 最终输出行的安全长度 */
const LOG_LINE_MAX_CHARS = 4_000;

/**
 * 结构化日志脱敏（TASK-089）：JSON 序列化 + 键名模式掩码 + 长字符串截断。
 * 用于工具 args / 审批 payload 等落 stdout 的调试输出——文件内容与密钥样
 * 字符串不再原样进日志。循环引用/序列化失败回落 String(value)。
 */
export function sanitizeForLog(value: unknown, maxChars: number = LOG_LINE_MAX_CHARS): string {
  let json: string;
  try {
    json =
      JSON.stringify(value, (k, v) => {
        // 裸词 "key" 豁免：ui_form 字段定义的结构属性名就叫 key（{key, label, type}），
        // 不是凭证——复合词（api_key/access_key 等）仍由下方正则照常遮蔽；
        // 真实凭证值的键名（deployToken/password 等）不含裸词 "key"，不受影响
        if (k === "key") return v;
        if (typeof v === "string" && v && LOG_SECRET_KEY_RE.test(k)) return "[REDACTED]";
        if (typeof v === "string" && v.length > LOG_VALUE_MAX_CHARS) {
          return `${v.slice(0, LOG_VALUE_MAX_CHARS)}…[+${v.length - LOG_VALUE_MAX_CHARS} 字符]`;
        }
        return v;
      }) ?? String(value);
  } catch {
    json = String(value);
  }
  return json.length > maxChars ? `${json.slice(0, maxChars)}…[+${json.length - maxChars} 字符]` : json;
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
