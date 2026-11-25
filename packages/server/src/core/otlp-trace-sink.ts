import { randomBytes } from "node:crypto";
import type { HarnessEventSink, HarnessOpsEvent } from "./event-sink.js";
import { getCurrentTraceContext } from "./trace-context.js";

/**
 * OTLP Traces 出口（TASK-098，HTTP + JSON 编码）：包装 ops 事件流
 * （core/event-sink.ts）在 sink 侧构建 span 树——不侵入 agent-loop /
 * telemetry / 驱动，事件流即事实源。与 otlp-sink.ts（OTLP Logs）同一
 * 手写零依赖风格，POST 到 OpenTelemetry Collector 或兼容端点。
 *
 * 事件 → span 映射（每 turn 一棵树，turnId 为键）：
 * - turn_start               → 开根 span "turn"（attrs: sessionId/turnId/model/permission）
 * - step_finish              → 子 span "step"（attrs: step/durationMs）
 * - tool_result              → 子 span "tool_call"（attrs: tool/ok/durationMs/code/error）
 * - model_retry/model_fallback/abort/warn → 根 span 的 OTel event 注记（不改树形）
 * - error（带 sessionId/turnId）→ 注记并按 error 收尾关树（turn_finish 可能不再到来）
 * - turn_finish              → 终态字段并入根 span attrs（status/stepCount/totalTokens…），
 *                              关根 span，整棵树单次 POST
 *
 * trace_id 来源（W3C Trace Context 关联）：入站 traceparent 已由 server.ts
 * 中间件写入 AsyncLocalStorage（trace-context.ts）时，根 span 复用其
 * traceId 且 parentSpanId 指向远端父（本服务是远端调用的服务端子 span）；
 * 无入站头时随机生成独立 traceId。树内所有 span 共享同一 traceId。
 *
 * fail-open 原则与 otlp-sink 一致：emit 同步返回、推送 fire-and-forget，
 * fetch 抛错/超时/非 2xx 只回调 onError（缺省静默），绝不反噬主链路；
 * AbortSignal.timeout 防推送悬挂。未配置 endpoint 时调用方不创建本 sink
 * （零开销：无事件流包装、无 span 构造路径）。
 */

/** createOtlpTraceSink 选项 */
export interface OtlpTraceSinkOptions {
  /** OTLP/HTTP Traces 端点（如 http://collector:4318/v1/traces） */
  endpoint: string;
  /** service.name 资源属性；缺省 "vuagent-server" */
  serviceName?: string;
  /** 注入用 fetch（测试/自定义传输）；缺省全局 fetch（Node 18+ 内置） */
  fetchImpl?: typeof fetch;
  /** 发送失败回调（fetch 抛错/超时/非 2xx 均触发）；缺省静默吞掉 */
  onError?: (err: unknown) => void;
  /** 单次推送超时（AbortSignal.timeout）；缺省 5000ms */
  timeoutMs?: number;
  /** 在途 turn 树上限（防泄漏：超限逐出最旧树并立即推送其部分树）；缺省 256 */
  maxOpenTurns?: number;
  /**
   * flush 并发信号量上限（存储域审查 O2）：在途推送（POST 未落定）超过该值时
   * 新推送排队等待；防采集端变慢时一次性打开大量并发连接。缺省 8。
   * fail-open 与单次超时语义不变——排队不影响 emit 调用方。
   */
  maxInFlightFlushes?: number;
}

/** OTLP 属性值：本 sink 只产出标量（字符串/数值/布尔），与事件字段口径一致 */
type AttrValue = Record<string, unknown>;
type Attribute = { key: string; value: AttrValue };

/** OTel Span Status Code：0=UNSET 1=OK 2=ERROR */
type StatusCode = 0 | 1 | 2;

/** 根 span OTel event 注记 */
interface SpanEventNote {
  timeUnixNano: string;
  name: string;
  attributes: Attribute[];
}

interface SpanRecord {
  name: string;
  spanId: string;
  /** 无入站 trace 上下文时的根 span 无远端父（字段整体缺省） */
  parentSpanId?: string;
  startUnixNano: string;
  endUnixNano?: string;
  attributes: Attribute[];
  events: SpanEventNote[];
  status?: { code: StatusCode; message?: string };
}

interface TurnTree {
  traceId: string;
  root: SpanRecord;
  children: SpanRecord[];
}

/** 事件标量字段 → OTLP attributes（剔除 at 时间戳；at 已进 timeUnixNano） */
function scalarAttributes(event: Record<string, unknown>): Attribute[] {
  const attributes: Attribute[] = [];
  for (const [key, value] of Object.entries(event)) {
    if (key === "at") continue;
    if (typeof value === "string") attributes.push({ key, value: { stringValue: value } });
    else if (typeof value === "number") attributes.push({ key, value: { doubleValue: value } });
    else if (typeof value === "boolean") attributes.push({ key, value: { boolValue: value } });
  }
  return attributes;
}

/** ms → ns 时间戳字符串（同 otlp-sink 口径：float64 尾数粒度对遥测足够） */
function msToNano(ms: number): string {
  return String(ms * 1e6);
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** turn 树键：sessionId+turnId 双保险（turnId 单独不保证跨会话唯一） */
function treeKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`;
}

/** span → OTLP JSON（字段名对齐 trace.proto JSON 编码；id 为 hex 字符串） */
function spanToJson(span: SpanRecord, traceId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    traceId,
    spanId: span.spanId,
    name: span.name,
    startTimeUnixNano: span.startUnixNano,
  };
  if (span.parentSpanId) out.parentSpanId = span.parentSpanId;
  if (span.endUnixNano) out.endTimeUnixNano = span.endUnixNano;
  if (span.attributes.length > 0) out.attributes = span.attributes;
  if (span.events.length > 0) {
    out.events = span.events.map((e) => ({
      timeUnixNano: e.timeUnixNano,
      name: e.name,
      attributes: e.attributes,
    }));
  }
  if (span.status) {
    out.status = span.status.message ? { code: span.status.code, message: span.status.message } : { code: span.status.code };
  }
  return out;
}

/** 整棵 turn 树 → OTLP/HTTP JSON 请求体（单 resourceSpan / 单 scopeSpan） */
function buildOtlpTracesPayload(tree: TurnTree, serviceName: string): Record<string, unknown> {
  const spans = [tree.root, ...tree.children].map((s) => spanToJson(s, tree.traceId));
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: "vuagent-server" },
            spans,
          },
        ],
      },
    ],
  };
}

/**
 * 构造 OTLP Traces 出口 sink：emit 同步更新内存树即返回；根 span 关闭时
 * 序列化整棵树 fire-and-forget POST。推送失败经 void promise + catch 收敛到
 * onError，绝不反噬 emit 调用方。
 */
export function createOtlpTraceSink(opts: OtlpTraceSinkOptions): HarnessEventSink {
  const post = opts.fetchImpl ?? fetch;
  const serviceName = opts.serviceName ?? "vuagent-server";
  const onError = opts.onError;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const maxOpenTurns = opts.maxOpenTurns ?? 256;
  // O2：flush 并发信号量（上限缺省 8）——在途推送超限时排队，防采集端变慢时
  // 一次性打开大量并发连接；fail-open 与单次超时语义不变
  const maxInFlightFlushes = opts.maxInFlightFlushes ?? 8;
  const openTurns = new Map<string, TurnTree>();

  let inFlightFlushes = 0;
  const queuedFlushes: Array<() => void> = [];

  const flush = (tree: TurnTree): void => {
    const payload = buildOtlpTracesPayload(tree, serviceName);
    const send = (): void => {
      inFlightFlushes++;
      const promise = post(opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        // 防悬挂：采集端僵死时限时放弃（代价上限是丢观测数据）
        signal: AbortSignal.timeout(timeoutMs),
      });
      void promise
        .then((res) => {
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`otlp trace sink: endpoint returned HTTP ${res.status}`);
          }
          // 主动取消响应体：fire-and-forget 不读 body，未消费的流会悬挂连接
          return res.body ? res.body.cancel().catch(() => {}) : undefined;
        })
        .catch((err) => {
          try {
            onError?.(err);
          } catch {
            // onError 自身抛错也吞掉：出口故障不允许外溢到 emit 调用方
          }
        })
        .finally(() => {
          // 落定（成功/失败/超时一视同仁）：释放信号量并推进排队中的下一条
          inFlightFlushes--;
          const next = queuedFlushes.shift();
          if (next) next();
        });
    };
    if (inFlightFlushes >= maxInFlightFlushes) {
      queuedFlushes.push(send);
      return;
    }
    send();
  };

  /** 按 sessionId/turnId 找在途树；model_retry/model_fallback/warn 可能缺双 id → 无树即丢弃注记 */
  const findTree = (event: Extract<HarnessOpsEvent, { sessionId?: string; turnId?: string }>): TurnTree | undefined => {
    if (typeof event.sessionId !== "string" || typeof event.turnId !== "string") return undefined;
    return openTurns.get(treeKey(event.sessionId, event.turnId));
  };

  const annotate = (tree: TurnTree, at: number, name: string, event: HarnessOpsEvent): void => {
    tree.root.events.push({
      timeUnixNano: msToNano(at),
      name,
      attributes: scalarAttributes(event as Record<string, unknown>),
    });
  };

  /** 关根 span 并整树推送；树已移除，后续同键事件自然丢弃 */
  const closeTurn = (key: string, tree: TurnTree, at: number, isError: boolean, message?: string): void => {
    openTurns.delete(key);
    tree.root.endUnixNano = msToNano(at);
    tree.root.status = { code: isError ? 2 : 1, ...(message ? { message } : {}) };
    flush(tree);
  };

  return {
    emit(event) {
      // 构建路径整体兜底：观测出口的任何意外都不允许打断事件消费方（compositeSink 广播语义）
      try {
        switch (event.type) {
          case "turn_start": {
            // 超限逐出最旧在途树：部分树先推送（好过静默丢失+内存泄漏）
            if (openTurns.size >= maxOpenTurns) {
              const oldestKey = openTurns.keys().next().value;
              if (oldestKey !== undefined) {
                const oldest = openTurns.get(oldestKey)!;
                openTurns.delete(oldestKey);
                oldest.root.endUnixNano = msToNano(event.at);
                oldest.root.status = { code: 0 }; // UNSET：终态未知（逐出非失败）
                flush(oldest);
              }
            }
            const ctx = getCurrentTraceContext();
            const key = treeKey(event.sessionId, event.turnId);
            openTurns.set(key, {
              traceId: ctx?.traceId ?? randomHex(16),
              root: {
                name: "turn",
                spanId: randomHex(8),
                ...(ctx ? { parentSpanId: ctx.parentSpanId } : {}),
                startUnixNano: msToNano(event.at),
                attributes: scalarAttributes(event as Record<string, unknown>),
                events: [],
              },
              children: [],
            });
            break;
          }
          case "step_finish": {
            const tree = findTree(event);
            if (!tree) break;
            const endNs = msToNano(event.at);
            const startNs = typeof event.durationMs === "number" ? msToNano(event.at - event.durationMs) : endNs;
            tree.children.push({
              name: "step",
              spanId: randomHex(8),
              parentSpanId: tree.root.spanId,
              startUnixNano: startNs,
              endUnixNano: endNs,
              attributes: scalarAttributes(event as Record<string, unknown>),
              events: [],
            });
            break;
          }
          case "tool_result": {
            const tree = findTree(event);
            if (!tree) break;
            const endNs = msToNano(event.at);
            tree.children.push({
              name: "tool_call",
              spanId: randomHex(8),
              parentSpanId: tree.root.spanId,
              startUnixNano: msToNano(event.at - event.durationMs),
              endUnixNano: endNs,
              attributes: scalarAttributes(event as Record<string, unknown>),
              events: [],
            });
            break;
          }
          case "model_retry":
          case "model_fallback":
          case "warn": {
            // 注记优先匹配事件自带 id；缺 id 时不凭空挂到某棵在途树（诚实归因）
            const tree = findTree(event);
            if (!tree) break;
            annotate(tree, event.at, event.type, event);
            break;
          }
          case "abort": {
            // 中止注记：turn_finish 通常随后到来（带 TURN_* code 的 done 收尾），
            // 此处只注记不关树，终态以 turn_finish 为准
            const tree = findTree(event);
            if (!tree) break;
            annotate(tree, event.at, "abort", event);
            break;
          }
          case "error": {
            // error 收尾（turn_finish 可能不再到来）：注记并按 ERROR 关树；
            // 若 turn_finish 随后仍到来，树已移除 → 该事件自然丢弃，不重复推送
            const tree = findTree(event);
            if (!tree) break;
            annotate(tree, event.at, "error", event);
            const key = treeKey(event.sessionId as string, event.turnId as string);
            closeTurn(key, tree, event.at, true, typeof event.detail === "string" ? event.detail : undefined);
            break;
          }
          case "turn_finish": {
            const key = treeKey(event.sessionId, event.turnId);
            const tree = openTurns.get(key);
            if (!tree) break;
            // 终态字段并入根 span 属性（运维画像随 span 上屏，无需注记）
            for (const attr of scalarAttributes(event as Record<string, unknown>)) {
              const existing = tree.root.attributes.findIndex((a) => a.key === attr.key);
              if (existing >= 0) tree.root.attributes[existing] = attr;
              else tree.root.attributes.push(attr);
            }
            closeTurn(key, tree, event.at, event.status === "error", event.message);
            break;
          }
        }
      } catch {
        // 吞掉：构建失败等价于丢观测数据，不允许外溢
      }
    },
  };
}
