import type { HarnessEventSink, HarnessOpsEvent } from "./event-sink.js";

/**
 * OTLP Logs 出口（HTTP + JSON 编码）：把类型化运维事件（core/event-sink.ts）
 * 以 OTLP Logs JSON POST 到 OpenTelemetry Collector 或兼容端点
 * （Grafana Alloy / Loki OTLP 入口 / 云厂商 OTLP 网关），
 * 补齐 NDJSON console 之外的托管采集链路。
 *
 * fail-open 原则：可观测出口绝不反噬主链路——fetch 抛错或非 2xx 只回调
 * onError（通常接 warn 日志），不 await、不上抛、onError 自身抛错也吞掉；
 * 采集端故障的代价上限是丢观测数据，不影响业务请求。
 */

/** createOtlpSink 选项 */
export interface OtlpSinkOptions {
  /** OTLP/HTTP Logs 端点（如 http://collector:4318/v1/logs） */
  endpoint: string;
  /** 注入用 fetch（测试/自定义传输）；缺省全局 fetch（Node 18+ 内置） */
  fetchImpl?: typeof fetch;
  /** 发送失败回调（fetch 抛错或非 2xx 均触发）；缺省静默吞掉 */
  onError?: (err: unknown) => void;
  /** service.name 资源属性；缺省 "vuagent-server" */
  serviceName?: string;
}

/** severityText：error/warn 事件升 severity（含 turn_finish 的 error 收尾），其余 INFO */
function severityTextFor(event: HarnessOpsEvent): string {
  if (event.type === "error") return "ERROR";
  if (event.type === "warn") return "WARN";
  if (event.type === "turn_finish" && event.status === "error") return "ERROR";
  return "INFO";
}

/** OTLP AnyValue 映射：字符串→stringValue、数值→doubleValue、布尔→boolValue；其余类型跳过 */
function toAnyValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return undefined;
}

/**
 * 单条事件 → OTLP LogRecord：
 * body 保留全量事件 JSON（采集端可原样解析），attributes 只取标量字段
 * 便于 Loki/Datadog 按字段检索；at 时间戳已进 timeUnixNano，不重复入 attributes。
 */
function buildLogRecord(event: HarnessOpsEvent): Record<string, unknown> {
  const attributes: Array<{ key: string; value: Record<string, unknown> }> = [];
  for (const [key, value] of Object.entries(event)) {
    if (key === "at") continue;
    const anyValue = toAnyValue(value);
    if (anyValue !== undefined) attributes.push({ key, value: anyValue });
  }
  return {
    // ms → ns：Date.now()*1e6（float64 尾数会取整到数百 ns 粒度，对日志时间戳足够）
    timeUnixNano: String(Date.now() * 1e6),
    severityText: severityTextFor(event),
    body: { stringValue: JSON.stringify(event) },
    attributes,
  };
}

/** 单条事件 → OTLP Logs JSON 请求体（单 resourceLog / 单 scopeLog / 单 logRecord） */
function buildOtlpLogsPayload(
  event: HarnessOpsEvent,
  serviceName: string,
): Record<string, unknown> {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeLogs: [
          {
            scope: { name: "vuagent-server" },
            logRecords: [buildLogRecord(event)],
          },
        ],
      },
    ],
  };
}

/**
 * 构造 OTLP Logs 出口 sink：emit 同步序列化即返回（fire-and-forget），
 * POST 结果经 void promise + catch 收敛到 onError，绝不反噬 emit 调用方。
 */
export function createOtlpSink(opts: OtlpSinkOptions): HarnessEventSink {
  const post = opts.fetchImpl ?? fetch;
  const serviceName = opts.serviceName ?? "vuagent-server";
  const onError = opts.onError;
  return {
    emit(event) {
      const payload = buildOtlpLogsPayload(event, serviceName);
      const promise = post(opts.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      void promise
        .then((res) => {
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`otlp sink: endpoint returned HTTP ${res.status}`);
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
        });
    },
  };
}
