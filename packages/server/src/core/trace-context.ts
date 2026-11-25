/**
 * W3C Trace Context 传播（TASK-098 基建，零依赖）：
 * node:async_hooks AsyncLocalStorage 保存「当前请求的入站 traceparent」，
 * 供两处消费：
 * 1. server.ts 中间件入站解析后写入（setCurrentTraceContext）；
 * 2. adapters 出站 LLM 请求注入 traceparent 头（getCurrentTraceparent）；
 * 3. otlp-trace-sink 以其 trace_id/span_id 为根 span 上下文（rootSpanIds）。
 *
 * 设计取舍：不复刻完整 OTel Context 机制——本地单用户工具只需要
 * 「入站标识 → 出站透传 → 根 span 关联」这一条链路，AsyncLocalStorage 足够；
 * 无入站头时 getCurrentTraceparent 返回 undefined（零开销短路）。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export interface TraceContext {
  /** 入站 traceparent 原文（如 "00-<32hex traceId>-<16hex spanId>-01"） */
  traceparent: string;
  /** 解析出的 trace id（32 hex） */
  traceId: string;
  /** 入站父 span id（16 hex；本服务自身 span 的 parent） */
  parentSpanId: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

/**
 * 解析并写入当前异步上下文的 traceparent（server.ts 入站中间件调用）。
 * 非法/缺失格式静默忽略（fail-open，不阻断请求）；返回是否生效。
 */
export function setCurrentTraceContext(rawTraceparent: string | undefined): boolean {
  if (!rawTraceparent) return false;
  const match = TRACEPARENT_RE.exec(rawTraceparent.trim());
  if (!match) return false;
  const traceId = match[2].toLowerCase();
  const parentSpanId = match[3].toLowerCase();
  // 版本 ff 与全零 traceId 非法（W3C 规范）
  if (match[1] === "ff" || /^0+$/.test(traceId)) return false;
  storage.enterWith({ traceparent: rawTraceparent.trim(), traceId, parentSpanId });
  return true;
}

/** 当前异步上下文的 traceparent 原文（无入站头 → undefined） */
export function getCurrentTraceparent(): string | undefined {
  return storage.getStore()?.traceparent;
}

/** 当前 trace 上下文（otlp-trace-sink 根 span 关联用；无 → undefined） */
export function getCurrentTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * 生成出站 traceparent（子 span 语义）：以当前 trace 为根、随机 span id。
 * 无当前上下文时 undefined（不凭空造根——出站请求只在已有 trace 内传播）。
 */
export function childTraceparent(randomHex: (n: number) => string = defaultRandomHex): string | undefined {
  const ctx = storage.getStore();
  if (!ctx) return undefined;
  // W3C：span-id 为 8 字节 = 16 hex
  return `00-${ctx.traceId}-${randomHex(8)}-01`;
}

function defaultRandomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}
