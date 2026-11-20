import { describe, it, expect } from "vitest";
import { MetricsRegistry, createOpsMetricsSink } from "../src/core/metrics-registry.js";
import { createOtlpSink } from "../src/core/otlp-sink.js";
import type { HarnessOpsEvent } from "../src/core/event-sink.js";

/** 等一个宏任务 tick，让 fire-and-forget 的 promise 链全部收敛（微任务先于 setTimeout 执行） */
const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("MetricsRegistry", () => {
  it("counter：缺省 +1、显式增量、同标签组累计", () => {
    const registry = new MetricsRegistry();
    registry.incCounter("vuagent_turns_total", { status: "done" });
    registry.incCounter("vuagent_turns_total", { status: "done" });
    registry.incCounter("vuagent_turns_total", { status: "done" }, 5);
    const out = registry.renderPrometheus();
    expect(out).toContain("# TYPE vuagent_turns_total counter");
    expect(out).toContain('vuagent_turns_total{status="done"} 7');
  });

  it("gauge：绝对置值覆盖旧值；无标签样本渲染为裸行", () => {
    const registry = new MetricsRegistry();
    registry.setGauge("vuagent_running_turns", 3);
    registry.setGauge("vuagent_running_turns", 1);
    expect(registry.renderPrometheus()).toContain("vuagent_running_turns 1");
  });

  it("渲染分组：内置 HELP/TYPE 表 + 族按名称排序 + 族内样本按标签组排序，输出稳定", () => {
    const registry = new MetricsRegistry();
    registry.incCounter("vuagent_tool_calls_total", { tool: "read_file", ok: "true" });
    registry.incCounter("vuagent_tool_calls_total", { tool: "bash", ok: "false" });
    registry.incCounter("vuagent_tool_calls_total", { tool: "bash", ok: "true" });
    registry.setGauge("vuagent_running_turns", 2);

    const out = registry.renderPrometheus();
    expect(out).toContain("# HELP vuagent_running_turns ");
    expect(out).toContain("# TYPE vuagent_running_turns gauge");
    // 族按名称排序：running_turns 排在 tool_calls 之前
    expect(out.indexOf("# TYPE vuagent_running_turns")).toBeLessThan(
      out.indexOf("# TYPE vuagent_tool_calls_total")
    );
    // 乱序插入的样本按标签组字典序输出；ok 键排在 tool 前（键排序）
    const toolLines = out
      .split("\n")
      .filter((line) => line.startsWith("vuagent_tool_calls_total{"));
    expect(toolLines).toEqual([
      'vuagent_tool_calls_total{ok="false",tool="bash"} 1',
      'vuagent_tool_calls_total{ok="true",tool="bash"} 1',
      'vuagent_tool_calls_total{ok="true",tool="read_file"} 1',
    ]);
    // 同一指标状态两次渲染逐字节一致
    expect(registry.renderPrometheus()).toBe(out);
  });

  it("标签键乱序传入仍按字典序渲染", () => {
    const registry = new MetricsRegistry();
    registry.incCounter("vuagent_turns_total", { status: "error", code: "MODEL_NETWORK" });
    expect(registry.renderPrometheus()).toContain(
      'vuagent_turns_total{code="MODEL_NETWORK",status="error"} 1'
    );
  });

  it("标签值转义：反斜杠、双引号、换行（先转反斜杠防二次转义）", () => {
    const registry = new MetricsRegistry();
    registry.incCounter("vuagent_model_fallback_total", {
      from: 'weird\\name "x"\nline',
      to: "ok",
    });
    expect(registry.renderPrometheus()).toContain(
      'vuagent_model_fallback_total{from="weird\\\\name \\"x\\"\\nline",to="ok"} 1'
    );
  });

  it("未在元数据表声明的指标兜底建族（占位 HELP + TYPE 取写入方）", () => {
    const registry = new MetricsRegistry();
    registry.incCounter("vuagent_custom_total");
    const out = registry.renderPrometheus();
    expect(out).toContain("# TYPE vuagent_custom_total counter");
    expect(out).toContain("# HELP vuagent_custom_total ");
  });
});

describe("recordOpsEvent 事件 → 指标映射", () => {
  it("turn_start/turn_finish 配对：running gauge 升降回落，turns_total 按 status+code 分组", () => {
    const registry = new MetricsRegistry();
    registry.recordOpsEvent({ type: "turn_start", at: 1, sessionId: "s1", turnId: "t1" });
    registry.recordOpsEvent({ type: "turn_start", at: 2, sessionId: "s1", turnId: "t2" });
    expect(registry.renderPrometheus()).toContain("vuagent_running_turns 2");

    registry.recordOpsEvent({
      type: "turn_finish",
      at: 3,
      sessionId: "s1",
      turnId: "t1",
      status: "done",
      stepCount: 1,
      durationMs: 10,
      totalTokens: 120,
    });
    registry.recordOpsEvent({
      type: "turn_finish",
      at: 4,
      sessionId: "s1",
      turnId: "t2",
      status: "error",
      stepCount: 2,
      durationMs: 20,
      code: "MODEL_NETWORK",
    });
    const out = registry.renderPrometheus();
    expect(out).toContain("vuagent_running_turns 0");
    expect(out).toContain('vuagent_turns_total{status="done"} 1');
    expect(out).toContain('vuagent_turns_total{code="MODEL_NETWORK",status="error"} 1');
    expect(out).toContain("vuagent_turn_tokens_total 120");
  });

  it("turn_finish 无 totalTokens 不动 token 计数器；无配对 start 的 finish 不把 gauge 打负", () => {
    const registry = new MetricsRegistry();
    registry.recordOpsEvent({
      type: "turn_finish",
      at: 1,
      sessionId: "s",
      turnId: "t",
      status: "done",
      stepCount: 0,
      durationMs: 0,
    });
    const out = registry.renderPrometheus();
    expect(out).not.toContain("vuagent_turn_tokens_total");
    expect(out).toContain("vuagent_running_turns 0"); // 钳 0，不为负
  });

  it("model_retry → retries_total{error_class}；model_fallback → fallback_total{from,to}", () => {
    const registry = new MetricsRegistry();
    registry.recordOpsEvent({
      type: "model_retry",
      at: 1,
      attempt: 1,
      errorClass: "server",
      delayMs: 100,
      reason: "500",
    });
    registry.recordOpsEvent({
      type: "model_retry",
      at: 2,
      attempt: 2,
      errorClass: "server",
      delayMs: 200,
      reason: "500",
    });
    registry.recordOpsEvent({
      type: "model_fallback",
      at: 3,
      from: "gpt-x",
      to: "glm-4",
      errorClass: "rate_limit",
      reason: "429",
    });
    const out = registry.renderPrometheus();
    expect(out).toContain('vuagent_model_retries_total{error_class="server"} 2');
    expect(out).toContain('vuagent_model_fallback_total{from="gpt-x",to="glm-4"} 1');
  });

  it("model_fallback 档案名含特殊字符：渲染时转义", () => {
    const registry = new MetricsRegistry();
    registry.recordOpsEvent({
      type: "model_fallback",
      at: 1,
      from: 'a"b',
      to: "c\\d",
      errorClass: "unknown",
      reason: "x",
    });
    expect(registry.renderPrometheus()).toContain(
      'vuagent_model_fallback_total{from="a\\"b",to="c\\\\d"} 1'
    );
  });

  it("tool_result → tool_calls_total{tool,ok}（ok 布尔转 \"true\"/\"false\" 标签）", () => {
    const registry = new MetricsRegistry();
    registry.recordOpsEvent({
      type: "tool_result",
      at: 1,
      sessionId: "s",
      turnId: "t",
      tool: "bash",
      ok: true,
      durationMs: 5,
    });
    registry.recordOpsEvent({
      type: "tool_result",
      at: 2,
      sessionId: "s",
      turnId: "t",
      tool: "bash",
      ok: false,
      durationMs: 5,
      code: "TOOL_EXECUTION_FAILED",
      error: "boom",
    });
    const out = registry.renderPrometheus();
    expect(out).toContain('vuagent_tool_calls_total{ok="true",tool="bash"} 1');
    expect(out).toContain('vuagent_tool_calls_total{ok="false",tool="bash"} 1');
  });

  it("日志面事件（step_finish/abort/warn/error）不产生指标", () => {
    const registry = new MetricsRegistry();
    registry.recordOpsEvent({ type: "step_finish", at: 1, sessionId: "s", turnId: "t", step: 1 });
    registry.recordOpsEvent({ type: "abort", at: 2, sessionId: "s", turnId: "t", reason: "user", code: "TURN_ABORTED" });
    registry.recordOpsEvent({ type: "warn", at: 3, code: "RECOVERED_TURNS" });
    registry.recordOpsEvent({ type: "error", at: 4, code: "COST_RECORD_FAILED" });
    expect(registry.renderPrometheus()).toBe("");
  });

  it("createOpsMetricsSink：经 HarnessEventSink 接口驱动 registry（供 compositeSink 接线）", () => {
    const registry = new MetricsRegistry();
    const sink = createOpsMetricsSink(registry);
    sink.emit({ type: "turn_start", at: 1, sessionId: "s", turnId: "t" });
    expect(registry.renderPrometheus()).toContain("vuagent_running_turns 1");
  });
});

describe("createOtlpSink（OTLP Logs JSON 出口）", () => {
  const turnFinish: Extract<HarnessOpsEvent, { type: "turn_finish" }> = {
    type: "turn_finish",
    at: 1_700_000_000_000,
    sessionId: "s-1",
    turnId: "t-1",
    status: "done",
    stepCount: 3,
    durationMs: 1234,
    totalTokens: 456,
  };

  interface CapturedCall {
    url: string;
    init: RequestInit;
  }

  /** 注入用 fetch：记录调用入参，返回指定状态的空响应 */
  function capturingFetch(status = 200): typeof fetch & { calls: CapturedCall[] } {
    const calls: CapturedCall[] = [];
    const impl = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(new Response(null, { status }));
    }) as typeof fetch & { calls: CapturedCall[] };
    impl.calls = calls;
    return impl;
  }

  /** 取第 N 次调用的 logRecord */
  function firstRecord(call: CapturedCall): {
    timeUnixNano: string;
    severityText: string;
    body: { stringValue: string };
    attributes: Array<{ key: string; value: Record<string, unknown> }>;
  } {
    const payload = JSON.parse(call.init.body as string) as {
      resourceLogs: Array<{
        scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }>;
      }>;
    };
    const record = payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!;
    return record as {
      timeUnixNano: string;
      severityText: string;
      body: { stringValue: string };
      attributes: Array<{ key: string; value: Record<string, unknown> }>;
    };
  }

  it("POST OTLP Logs JSON：endpoint/请求头/body 形状（resource/scope/logRecord）", async () => {
    const fetchImpl = capturingFetch();
    createOtlpSink({ endpoint: "http://collector:4318/v1/logs", fetchImpl }).emit(turnFinish);
    await flushAsync();

    expect(fetchImpl.calls).toHaveLength(1);
    const { url, init } = fetchImpl.calls[0]!;
    expect(url).toBe("http://collector:4318/v1/logs");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");

    const payload = JSON.parse(init.body as string);
    const resourceLog = payload.resourceLogs[0];
    expect(resourceLog.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "vuagent-server" },
    });
    expect(resourceLog.scopeLogs[0].scope).toEqual({ name: "vuagent-server" });

    const record = firstRecord(fetchImpl.calls[0]!);
    expect(record.severityText).toBe("INFO");
    expect(record.body).toEqual({ stringValue: JSON.stringify(turnFinish) });
    expect(record.timeUnixNano).toMatch(/^\d{16,}$/);
    // 事件关键字段转 attributes：字符串 stringValue / 数值 doubleValue；at 不重复入 attributes
    expect(record.attributes).toContainEqual({ key: "type", value: { stringValue: "turn_finish" } });
    expect(record.attributes).toContainEqual({ key: "status", value: { stringValue: "done" } });
    expect(record.attributes).toContainEqual({ key: "stepCount", value: { doubleValue: 3 } });
    expect(record.attributes.find((a) => a.key === "at")).toBeUndefined();
  });

  it("serviceName 覆盖缺省值", async () => {
    const fetchImpl = capturingFetch();
    createOtlpSink({ endpoint: "http://x/v1/logs", fetchImpl, serviceName: "vuagent-prod" }).emit(
      turnFinish
    );
    await flushAsync();
    const payload = JSON.parse(fetchImpl.calls[0]!.init.body as string);
    expect(payload.resourceLogs[0].resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "vuagent-prod" },
    });
  });

  it("severityText：error→ERROR、warn→WARN、turn_finish(error)→ERROR、其余 INFO", async () => {
    const fetchImpl = capturingFetch();
    const sink = createOtlpSink({ endpoint: "http://x/v1/logs", fetchImpl });
    sink.emit({ type: "error", at: 1, code: "TURN_PERSIST_FAILED" });
    sink.emit({ type: "warn", at: 2, code: "RECOVERED_TURNS" });
    sink.emit({ ...turnFinish, status: "error", code: "MODEL_NETWORK" });
    sink.emit({ type: "turn_start", at: 5, sessionId: "s", turnId: "t" });
    await flushAsync();
    const severities = fetchImpl.calls.map((c) => firstRecord(c).severityText);
    expect(severities).toEqual(["ERROR", "WARN", "ERROR", "INFO"]);
  });

  it("attributes 值类型映射：布尔→boolValue、数值→doubleValue、字符串→stringValue", async () => {
    const fetchImpl = capturingFetch();
    const event: HarnessOpsEvent = {
      type: "tool_result",
      at: 1,
      sessionId: "s",
      turnId: "t",
      tool: "bash",
      ok: false,
      durationMs: 5,
      code: "TOOL_EXECUTION_FAILED",
      error: "boom",
    };
    createOtlpSink({ endpoint: "http://x/v1/logs", fetchImpl }).emit(event);
    await flushAsync();
    const record = firstRecord(fetchImpl.calls[0]!);
    expect(record.attributes).toContainEqual({ key: "ok", value: { boolValue: false } });
    expect(record.attributes).toContainEqual({ key: "durationMs", value: { doubleValue: 5 } });
    expect(record.attributes).toContainEqual({
      key: "code",
      value: { stringValue: "TOOL_EXECUTION_FAILED" },
    });
    expect(record.body).toEqual({ stringValue: JSON.stringify(event) });
  });

  it("fail-open：fetch 抛错不上抛、emit 同步返回、只回调 onError", async () => {
    const boom = new Error("connection refused");
    const errors: unknown[] = [];
    const sink = createOtlpSink({
      endpoint: "http://collector:4318/v1/logs",
      fetchImpl: (() => Promise.reject(boom)) as unknown as typeof fetch,
      onError: (err) => errors.push(err),
    });
    expect(() => sink.emit(turnFinish)).not.toThrow();
    await flushAsync();
    expect(errors).toEqual([boom]);
  });

  it("fail-open：非 2xx 响应只回调 onError（错误信息含状态码）", async () => {
    const fetchImpl = capturingFetch(503);
    const errors: unknown[] = [];
    createOtlpSink({ endpoint: "http://x/v1/logs", fetchImpl, onError: (e) => errors.push(e) }).emit(
      turnFinish
    );
    await flushAsync();
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("503");
  });

  it("fail-open：未提供 onError 时静默吞错（无未处理 rejection）", async () => {
    const sink = createOtlpSink({
      endpoint: "http://x/v1/logs",
      fetchImpl: (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch,
    });
    sink.emit(turnFinish);
    await flushAsync();
  });

  it("fail-open：onError 自身抛错也被吞掉", async () => {
    const sink = createOtlpSink({
      endpoint: "http://x/v1/logs",
      fetchImpl: (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch,
      onError: () => {
        throw new Error("handler boom");
      },
    });
    expect(() => sink.emit(turnFinish)).not.toThrow();
    await flushAsync();
  });
});

describe("GET /metrics 路由接线", () => {
  it("默认暴露 Prometheus 文本；配置 VUAGENT_TOKEN 后要求 Bearer", async () => {
    const { createHarnessServer } = await import("../src/server.js");
    const { app } = createHarnessServer({ dbPath: ":memory:" });

    const open = await app.request("/metrics");
    expect(open.status).toBe(200);
    expect(open.headers.get("content-type")).toContain("text/plain");
    // 零事件服务注册表为空属预期（从未记录的指标不输出），仅验证端点形态
    const body = await open.text();
    expect(typeof body).toBe("string");

    const secured = createHarnessServer({ dbPath: ":memory:", security: { authToken: "tok-1" } }).app;
    const denied = await secured.request("/metrics");
    expect(denied.status).toBe(401);
    const allowed = await secured.request("/metrics", {
      headers: { Authorization: "Bearer tok-1" },
    });
    expect(allowed.status).toBe(200);
  });
});
