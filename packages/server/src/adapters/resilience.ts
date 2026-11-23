/**
 * 模型请求韧性层（TASK-048，语义参照 harness-core providers/resilience.ts）：
 * 错误分类 → 指数退避重试（尊重 Retry-After）→ 首字节前超时。
 *
 * 诚实重试边界：只重试「HTTP 响应返回之前」的失败——
 * - 非 2xx 响应 / fetch reject / 响应头超时在本模块内按分类退避重试；
 * - 流已开始吐字后的失败不做透明重跑（调用方已消费增量，重跑会重复输出），
 *   由 driver 按 ClassifiedModelError 上抛给上层处理；
 *
 * 默认策略在 OpenAICompatibleDriver 内启用（maxRetries=2 / backoff=1s / 超时=60s），
 * `resilience: false` 可整体关闭（测试注入 fetchImpl 时避免真实退避等待）。
 */

/** 错误分类：决定重试策略 */
export type ProviderErrorClass =
  | "auth" // 401/403 — 不重试（凭证问题，重试无意义）
  | "bad_request" // 400/404/422 — 不重试（请求本身非法）
  | "context_overflow" // 400 且 message 含 context length — 不重试（换大窗模型才有意义）
  | "rate_limit" // 429 — 重试（读 Retry-After）
  | "server" // 500/502/503/529 overloaded — 重试
  | "network" // fetch reject / SSE 响应头前连接中断 — 重试
  | "unknown";

/** 已分类的模型错误：errorClass 供上层程序化区分（差异化提示/是否可重试），status 为原始 HTTP 状态码 */
export class ClassifiedModelError extends Error {
  readonly errorClass: ProviderErrorClass;
  readonly status?: number;

  constructor(message: string, errorClass: ProviderErrorClass, status?: number) {
    super(message);
    this.name = "ClassifiedModelError";
    this.errorClass = errorClass;
    if (status !== undefined) this.status = status;
  }
}

export interface ResiliencePolicy {
  /** 单请求最大重试次数（不含首次），缺省 2；钳 0–5 */
  maxRetries?: number;
  /** 退避基数 ms，缺省 1000；实际等待 = base * 2^n + jitter(0–500ms) */
  backoffBaseMs?: number;
  /** 单次请求超时（响应头返回前），缺省 60s；钳 5s–300s */
  requestTimeoutMs?: number;
}

export interface ResolvedResiliencePolicy {
  maxRetries: number;
  backoffBaseMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RETRIES_LIMIT = 5;
export const DEFAULT_BACKOFF_BASE_MS = 1000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
export const REQUEST_TIMEOUT_MIN_MS = 5_000;
export const REQUEST_TIMEOUT_MAX_MS = 300_000;
/** Retry-After 解析结果钳制上限 */
export const RETRY_AFTER_MAX_MS = 60_000;
const JITTER_MAX_MS = 500;

/** undici/Node 网络层错误码：命中即视为 network 类（可重试） */
const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

function classifyStatus(status: number, message: string): ProviderErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 500 || status === 502 || status === 503 || status === 529) return "server";
  if (status === 400) {
    return /context length/i.test(message) ? "context_overflow" : "bad_request";
  }
  if (status === 404 || status === 422) return "bad_request";
  return "unknown";
}

/**
 * 带响应正文的 HTTP 错误分类（R6 修复）：context_overflow 需要 message 检测，
 * 调用方（driver）应先读取 errText 再分类——Response 分支拿不到 body 文本。
 */
export function classifyHttpError(status: number, message: string): ProviderErrorClass {
  return classifyStatus(status, message);
}

/**
 * 错误分类器：接受 Response、 ClassifiedModelError（原样取 class）、带 status 属性的
 * 异常、fetch reject 的 TypeError、undici 错误码（含 cause 链）与旧版包装错误消息
 * （"模型 API 返回错误 (429 ...)" 形态，兼容历史抛出路径）。
 */
export function classifyModelError(input: unknown): ProviderErrorClass {
  if (input instanceof ClassifiedModelError) return input.errorClass;
  if (input instanceof Response) return classifyStatus(input.status, "");

  const err = input as { status?: unknown; statusCode?: unknown; message?: unknown; code?: unknown; cause?: unknown } | null;
  if (err === null || err === undefined) return "unknown";
  const message = typeof err.message === "string" ? err.message : String(input);

  if (typeof err.status === "number") return classifyStatus(err.status, message);
  if (typeof err.statusCode === "number") return classifyStatus(err.statusCode, message);
  if (input instanceof TypeError) return "network";
  if (typeof err.code === "string" && NETWORK_ERROR_CODES.has(err.code)) return "network";

  // 旧版包装消息兜底："模型 API 返回错误 (429 Too Many Requests): ..." / "连接模型 API ... 失败"
  const statusMatch = message.match(/模型 API 返回错误 \((\d{3})\b/);
  if (statusMatch) {
    return classifyStatus(Number(statusMatch[1]), message);
  }
  if (/连接模型 API .* 失败/.test(message)) return "network";

  const cause = err.cause as { code?: unknown } | undefined;
  if (cause && typeof cause === "object" && typeof cause.code === "string" && NETWORK_ERROR_CODES.has(cause.code)) {
    return "network";
  }
  return "unknown";
}

/** 可重试分类：rate_limit/server/network（auth/bad_request/context_overflow/unknown 不重试） */
export function isRetriableErrorClass(errorClass: ProviderErrorClass): boolean {
  return errorClass === "rate_limit" || errorClass === "server" || errorClass === "network";
}

/**
 * 格式化模型 API 错误响应正文：
 * 优先从 JSON 结构（如 {"error": {"message": "..."}} 或 {"detail": "..."}）中提取人类可读的 message，
 * 避免把未格式化的长 JSON 原样推给用户界面，提升排查与阅读体验。
 */
export function formatModelErrorDetail(rawText: string): string {
  if (!rawText || !rawText.trim()) return "无详细错误响应体";
  const trimmed = rawText.trim();
  try {
    const json = JSON.parse(trimmed);
    if (json && typeof json === "object") {
      const err = json.error ?? json;
      const msg = err.message ?? err.msg ?? err.error_msg ?? err.detail;
      const type = err.type ?? err.code;
      if (typeof msg === "string" && msg.trim()) {
        return type ? `[${type}] ${msg.trim()}` : msg.trim();
      }
    }
  } catch {
    // 非 JSON，直接返回原始文本
  }
  return trimmed;
}

/**
 * 解析 Retry-After 头（秒数或 HTTP-date），结果钳 0–60s；非法值返回 undefined
 * （调用方回落到指数退避）。now 可注入以便测试 HTTP-date 分支。
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now()
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && trimmed !== "") {
    return Math.min(Math.max(seconds, 0) * 1000, RETRY_AFTER_MAX_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - now, 0), RETRY_AFTER_MAX_MS);
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** 韧性策略解析（钳制 + 校验），driver 与测试消费同一形态 */
export function resolveResiliencePolicy(policy?: ResiliencePolicy | false): ResolvedResiliencePolicy {
  if (policy === false) {
    return { maxRetries: 0, backoffBaseMs: 0, requestTimeoutMs: 0 };
  }
  const p = policy && typeof policy === "object" ? policy : {};
  const retriesRaw = toFiniteNumber(p.maxRetries) ?? DEFAULT_MAX_RETRIES;
  const maxRetries = Math.min(Math.max(Math.round(retriesRaw), 0), MAX_RETRIES_LIMIT);
  const backoffRaw = toFiniteNumber(p.backoffBaseMs) ?? DEFAULT_BACKOFF_BASE_MS;
  const backoffBaseMs = Math.max(Math.round(backoffRaw), 0);
  const timeoutRaw = toFiniteNumber(p.requestTimeoutMs) ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const requestTimeoutMs = Math.min(
    Math.max(Math.round(timeoutRaw), REQUEST_TIMEOUT_MIN_MS),
    REQUEST_TIMEOUT_MAX_MS
  );
  return { maxRetries, backoffBaseMs, requestTimeoutMs };
}

/** createResilientFetch 的遥测/测试接缝 */
export interface ResilientFetchHooks {
  /** 每次退避重试前回调（attempt 从 1 起计） */
  onRetry?: (info: {
    attempt: number;
    errorClass: ProviderErrorClass;
    delayMs: number;
    reason: string;
  }) => void;
  /** sleep 注入点：测试注入立即返回避免真实退避等待，缺省 setTimeout */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 组合调用方 signal 与超时 signal（任一触发即触发）。
 * @deprecated TASK-060：Node ≥20 原生 AbortSignal.any 取代手写实现——
 * 旧实现向调用方 signal 挂 {once:true} 监听器且从不摘除，长生命周期 signal
 * （如跨多次请求的客户端 abort 信号）会累积监听器；内部调用点已全部改用
 * AbortSignal.any，本函数仅为外部兼容保留，实现改委托原生。
 */
export function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  return AbortSignal.any([a, b]);
}

/** 指数退避：base * 2^n + jitter(0–500ms) */
export function backoffDelay(baseMs: number, attempt: number): number {
  return baseMs * 2 ** attempt + Math.floor(Math.random() * (JITTER_MAX_MS + 1));
}

/**
 * 韧性 fetch 包装：对每次 provider HTTP 调用提供
 * 「指数退避重试 + Retry-After 尊重 + 响应头前超时」。
 *
 * 语义：
 * - response.ok === false：按分类退避重试（429 读 Retry-After，与退避取大者）；
 *   非可重试分类或重试用尽则原样返回响应（由调用方按分类决定后续）。
 * - fetch reject：按 network 退避重试；调用方主动 abort 立即上抛（用户停止语义）。
 * - 超时：requestTimeoutMs 内未返回响应即中止本次尝试，按 network 重试。
 * - 成功（2xx）响应原样透传（SSE 体由调用方 reader 消费）。
 */
export function createResilientFetch(
  baseFetch: typeof fetch,
  policy: ResolvedResiliencePolicy,
  hooks: ResilientFetchHooks = {}
): typeof fetch {
  const baseSleep = hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ): Promise<Response> => {
    const callerSignal = init?.signal ?? undefined;
    // R4 修复：退避等待与调用方 signal 竞速——429+Retry-After（钳 60s）期间
    // 用户停止/看门狗/preempt 立即可达（此前最长延迟 60s，且会误报 preempt_timeout）。
    // resolve（非 reject）后由下一轮循环的 abort 检查统一收尾；
    // sleep 先完成时 removeEventListener 避免在整轮信号上累积监听器。
    const sleep = (ms: number): Promise<void> => {
      if (!callerSignal) return baseSleep(ms);
      if (callerSignal.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let settled = false;
        const onAbort = (): void => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        callerSignal.addEventListener("abort", onAbort, { once: true });
        void baseSleep(ms).then(() => {
          if (!settled) {
            settled = true;
            callerSignal.removeEventListener("abort", onAbort);
            resolve();
          }
        });
      });
    };
    for (let attempt = 0; ; attempt++) {
      // R4 修复：退避被 signal 打断后在循环顶部统一收尾——
      // 不依赖 baseFetch 响应 signal（自定义 fetch 可能不检查）
      if (callerSignal?.aborted) {
        throw new Error("This operation was aborted");
      }
      const timeoutController = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (policy.requestTimeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          timeoutController.abort();
        }, policy.requestTimeoutMs);
      }
      // TASK-060：AbortSignal.any 原生组合，消除手写实现的监听器累积隐患
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, timeoutController.signal])
        : timeoutController.signal;
      try {
        const response = await baseFetch(input, { ...init, signal });
        if (timer) clearTimeout(timer);
        if (response.ok) return response;
        const errorClass = classifyModelError(response);
        // 非可重试或重试用尽：原样返回响应，由调用方分类处理
        if (!isRetriableErrorClass(errorClass) || attempt >= policy.maxRetries) {
          return response;
        }
        // 释放失败响应的连接
        void response.body?.cancel().catch(() => {});
        const backoff = backoffDelay(policy.backoffBaseMs, attempt);
        const retryAfterMs =
          errorClass === "rate_limit"
            ? parseRetryAfterMs(response.headers.get("retry-after"))
            : undefined;
        const delayMs = retryAfterMs !== undefined ? Math.max(retryAfterMs, backoff) : backoff;
        hooks.onRetry?.({
          attempt: attempt + 1,
          errorClass,
          delayMs,
          reason: `HTTP ${response.status}`,
        });
        await sleep(delayMs);
      } catch (err) {
        if (timer) clearTimeout(timer);
        // 调用方主动中止：立即上抛，不做重试
        if (callerSignal?.aborted) throw err;
        const errorClass = timedOut ? "network" : classifyModelError(err);
        if (!isRetriableErrorClass(errorClass) || attempt >= policy.maxRetries) throw err;
        const delayMs = backoffDelay(policy.backoffBaseMs, attempt);
        hooks.onRetry?.({
          attempt: attempt + 1,
          errorClass,
          delayMs,
          reason: err instanceof Error ? err.message : String(err),
        });
        await sleep(delayMs);
      }
    }
  }) as typeof fetch;
}
