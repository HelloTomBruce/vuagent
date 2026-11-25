/**
 * HTTP 限流中间件（TASK-088）：固定窗口计数，内存实现（Redis 外置计数转后续，
 * 与 TASK-100 事件缓冲外置一并设计——store 接口已留好注入位）。
 *
 * 动机：HTTP 层此前零频控——VUAGENT_TOKEN 可被无界爆破；
 * /models/discover 与 /verify-capabilities 每次触发真实外呼（费用面）。
 *
 * 设计口径：
 * - key = 客户端 IP + 令牌身份 + 作用域。令牌身份只区分**有效**令牌（isValidToken
 *   回调确认后才进指纹分桶）；无效/缺失令牌一律共享 "-"——否则每次错误猜测都是
 *   新桶（计数归 1），限流对令牌爆破零约束（审查 Critical 修复）；
 * - **限流必须注册在鉴权之前**：鉴权失败请求若先被 401 短路，永远到不了限流器
 *   （装配顺序由 server.ts 保证，这里以 OPTIONS 跳过照顾 CORS 预检不占预算）；
 * - 客户端 IP：默认取 socket 地址（直连部署，XFF 可伪造不可信）；显式
 *   trustProxy=true（反代形态，VUAGENT_TRUST_PROXY=1）才采信 XFF，且取**末段**
 *   （最近一跳可信代理追加的真实客户端，伪造的前段不生效）；
 * - 作用域分离：探测类端点（discover / verify-capabilities / models/test）用
 *   更严的 probe 规则，与 global 各自计数；
 * - /api/health 豁免（liveness 探针不可被限流掐死）；
 * - 固定窗口（非令牌桶）：实现/推理成本最低，429 带 Retry-After=窗口余量；
 * - limit=0 关闭该作用域限流（计数完全跳过，不产生内存增长）。
 */
import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export interface RateLimitRule {
  /** 窗口时长 ms */
  windowMs: number;
  /** 窗口内允许的最大请求数；0 = 关闭限流 */
  limit: number;
}

export interface RateLimitOptions {
  global: RateLimitRule;
  probe: RateLimitRule;
  store?: RateLimitStore;
  /** 显式信任反向代理的 X-Forwarded-For（取末段）；默认 false 取 socket 地址 */
  trustProxy?: boolean;
  /** 有效令牌判定回调：仅有效令牌进指纹分桶，无效/缺失共享 IP 桶（防爆破关键） */
  isValidToken?: (token: string) => boolean;
}

export interface RateLimitStore {
  /** 记一次命中，返回窗口内累计计数与窗口重置剩余 ms */
  hit(key: string, windowMs: number): { count: number; resetMs: number };
}

/** 内存固定窗口计数器；now 注入便于测试。惰性清扫过期桶防 Map 无界增长。
 *  每桶记录**绝对过期时刻**（windowStart + windowMs）——清扫按桶自身过期判定，
 *  多作用域 windowMs 不同（编程注入形态）时互不误清。 */
export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { windowStart: number; expiresAt: number; count: number }>();
  private hits = 0;

  constructor(private now: () => number = Date.now) {}

  hit(key: string, windowMs: number): { count: number; resetMs: number } {
    const t = this.now();
    // 每 512 次命中做一次全量过期清扫：桶数量与活跃客户端同阶，成本可忽略
    if (++this.hits % 512 === 0) {
      for (const [k, b] of this.buckets) {
        if (b.expiresAt <= t) this.buckets.delete(k);
      }
    }
    const b = this.buckets.get(key);
    if (!b || b.expiresAt <= t) {
      this.buckets.set(key, { windowStart: t, expiresAt: t + windowMs, count: 1 });
      return { count: 1, resetMs: windowMs };
    }
    b.count += 1;
    return { count: b.count, resetMs: b.expiresAt - t };
  }
}

/** 探测类端点：每次执行触发真实外呼（费用面），频控独立且更严 */
const PROBE_PATH_RE =
  /^\/api\/settings\/(?:providers\/[^/]+\/models\/discover|models\/[^/]+\/verify-capabilities|models\/test)$/;

/** 默认规则：全局 240 次/分钟；探测类 12 次/分钟（env 可覆盖，见 server.ts 装配） */
export const DEFAULT_RATE_LIMITS = {
  global: { windowMs: 60_000, limit: 240 },
  probe: { windowMs: 60_000, limit: 12 },
} as const satisfies Record<string, RateLimitRule>;

/** 客户端 IP：trustProxy 时取 XFF 末段（最近一跳可信代理追加的真实来源），
 *  否则一律 socket 地址（XFF 首段客户端可任意伪造，直连部署采信即无限绕过） */
function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) return parts[parts.length - 1];
    }
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

/** 令牌身份：仅**有效**令牌进指纹分桶（sha256 前 8 位，不落明文）；
 *  无效/缺失一律 "-"——错误猜测共享同一 IP 桶，爆破受窗口硬顶约束 */
function tokenIdentity(c: Context, isValidToken?: (token: string) => boolean): string {
  const auth = c.req.header("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return "-";
  const token = auth.slice("Bearer ".length).trim();
  if (!token || !isValidToken?.(token)) return "-";
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}

export function createRateLimitMiddleware(options: RateLimitOptions): MiddlewareHandler {
  const store = options.store ?? new MemoryRateLimitStore();
  const trustProxy = options.trustProxy ?? false;
  return async (c, next) => {
    // CORS 预检不占预算（预检次数与真实请求同阶，计入会砍半浏览器客户端配额；
    // 预检无副作用，DoS 面由 bodyLimit + 反代层兜底）
    if (c.req.method === "OPTIONS") return next();
    if (c.req.path === "/api/health") return next(); // liveness 探针豁免
    const isProbe = PROBE_PATH_RE.test(c.req.path);
    const rule = isProbe ? options.probe : options.global;
    if (rule.limit <= 0) return next(); // 0 = 关闭：完全跳过计数
    const key = `${clientIp(c, trustProxy)}|${tokenIdentity(c, options.isValidToken)}|${isProbe ? "probe" : "global"}`;
    const { count, resetMs } = store.hit(key, rule.windowMs);
    c.header("X-RateLimit-Limit", String(rule.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, rule.limit - count)));
    if (count > rule.limit) {
      return c.json(
        {
          error: `请求过于频繁（${rule.limit} 次/${Math.round(rule.windowMs / 1000)}s 窗口），请稍后重试`,
          code: "RATE_LIMITED",
        },
        429,
        { "Retry-After": String(Math.max(1, Math.ceil(resetMs / 1000))) }
      );
    }
    return next();
  };
}
