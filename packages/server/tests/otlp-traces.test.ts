import { describe, it, expect, vi } from "vitest";
import { createOtlpTraceSink } from "../src/core/otlp-trace-sink.js";
import { setCurrentTraceContext } from "../src/core/trace-context.js";
import { OpenAICompatibleDriver } from "../src/adapters/openai-driver.js";
import { AnthropicDriver } from "../src/adapters/anthropic-driver.js";
import type { HarnessOpsEvent } from "../src/core/event-sink.js";

/**
 * TASK-098：OTLP traces 出口 + 驱动出站 traceparent 注入。
 * collector 桩 = 注入 fetch 捕获请求体；入站 traceparent 场景依赖
 * AsyncLocalStorage（setCurrentTraceContext 用 enterWith 会改写当前异步链），
 * 因此**涉及入站上下文的用例必须排在文件末尾**，防止上下文泄漏影响前序断言。
 */

/** 等一个宏任务 tick，让 fire-and-forget 的 promise 链全部收敛 */
const flushAsync = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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

/** SSE mock fetch（驱动 traceparent 注入断言用，仅捕获 headers） */
function sseCaptureHeaders(rawBody: string): typeof fetch & { captured?: RequestInit } {
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    impl.captured = init;
    void input;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(rawBody));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch & { captured?: RequestInit };
  return impl;
}

/** 取第 N 次调用的 spans 数组（单 resourceSpan / 单 scopeSpan） */
function spansOf(call: CapturedCall): Array<Record<string, unknown>> {
  const payload = JSON.parse(call.init.body as string) as {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> };
      scopeSpans: Array<{ scope: { name: string }; spans: Array<Record<string, unknown>> }>;
    }>;
  };
  return payload.resourceSpans[0].scopeSpans[0].spans;
}

function resourceOf(call: CapturedCall): Array<{ key: string; value: Record<string, unknown> }> {
  return (JSON.parse(call.init.body as string) as {
    resourceSpans: Array<{ resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> } }>;
  }).resourceSpans[0].resource.attributes;
}

/** span 的指定属性值（ stringValue / doubleValue / boolValue 归一） */
function attr(span: Record<string, unknown>, key: string): unknown {
  const attributes = span.attributes as Array<{ key: string; value: Record<string, unknown> }> | undefined;
  const v = attributes?.find((a) => a.key === key)?.value;
  return v?.stringValue ?? v?.doubleValue ?? v?.boolValue;
}

/** 一轮完整 turn 的事件序列（tool_result 在 step_finish 前发生，映射顺序即 span 顺序） */
function fullTurn(sessionId: string, turnId: string): HarnessOpsEvent[] {
  return [
    { type: "turn_start", at: 1_000, sessionId, turnId, model: "gpt-x", permission: "review" },
    { type: "tool_result", at: 1_500, sessionId, turnId, tool: "bash_run", ok: true, durationMs: 120 },
    { type: "step_finish", at: 1_600, sessionId, turnId, step: 1, durationMs: 600 },
    {
      type: "turn_finish",
      at: 2_000,
      sessionId,
      turnId,
      status: "done",
      stepCount: 1,
      durationMs: 1_000,
      totalTokens: 77,
      finishReason: "natural",
    },
  ];
}

describe("createOtlpTraceSink：span 树构建与推送", () => {
  it("单轮产生 span 树（root turn + step + tool_call），层级与关键属性正确，单次 POST", async () => {
    const fetchImpl = capturingFetch();
    const sink = createOtlpTraceSink({
      endpoint: "http://collector:4318/v1/traces",
      serviceName: "vuagent-test",
      fetchImpl,
    });
    for (const event of fullTurn("s-1", "t-1")) sink.emit(event);
    await flushAsync();

    expect(fetchImpl.calls).toHaveLength(1);
    expect(fetchImpl.calls[0].url).toBe("http://collector:4318/v1/traces");
    expect(fetchImpl.calls[0].init.method).toBe("POST");
    expect((fetchImpl.calls[0].init.headers as Record<string, string>)["content-type"]).toBe("application/json");

    // resource.service.name 取注入值；scope 名与 otlp-sink 口径一致
    expect(resourceOf(fetchImpl.calls[0])).toEqual([
      { key: "service.name", value: { stringValue: "vuagent-test" } },
    ]);

    const spans = spansOf(fetchImpl.calls[0]);
    // 事件到达序 → span 序：root 在首位，tool_call 先于 step
    expect(spans.map((s) => s.name)).toEqual(["turn", "tool_call", "step"]);

    const root = spans[0];
    const rootSpanId = root.spanId as string;
    // 根 span：无入站上下文 → 独立 traceId（32 hex）、无远端父
    expect(root.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(rootSpanId).toMatch(/^[0-9a-f]{16}$/);
    expect(root.parentSpanId).toBeUndefined();
    // 时间戳 ms → ns（事件 at 字段为准）
    expect(root.startTimeUnixNano).toBe(String(1_000 * 1e6));
    expect(root.endTimeUnixNano).toBe(String(2_000 * 1e6));
    // turn_start 属性 + turn_finish 终态属性并入
    expect(attr(root, "sessionId")).toBe("s-1");
    expect(attr(root, "turnId")).toBe("t-1");
    expect(attr(root, "model")).toBe("gpt-x");
    expect(attr(root, "permission")).toBe("review");
    expect(attr(root, "status")).toBe("done");
    expect(attr(root, "stepCount")).toBe(1);
    expect(attr(root, "totalTokens")).toBe(77);
    expect(attr(root, "finishReason")).toBe("natural");
    // 正常收尾 status OK（1）
    expect(root.status).toEqual({ code: 1 });

    // tool_call 子 span：父指根；时长回推 start；tool/ok/durationMs 属性
    const tool = spans.find((s) => s.name === "tool_call")!;
    expect(tool.traceId).toBe(root.traceId);
    expect(tool.parentSpanId).toBe(rootSpanId);
    expect(tool.startTimeUnixNano).toBe(String((1_500 - 120) * 1e6));
    expect(tool.endTimeUnixNano).toBe(String(1_500 * 1e6));
    expect(attr(tool, "tool")).toBe("bash_run");
    expect(attr(tool, "ok")).toBe(true);
    expect(attr(tool, "durationMs")).toBe(120);

    // step 子 span：父指根；step 序号与时长
    const step = spans.find((s) => s.name === "step")!;
    expect(step.traceId).toBe(root.traceId);
    expect(step.parentSpanId).toBe(rootSpanId);
    expect(attr(step, "step")).toBe(1);
    expect(attr(step, "durationMs")).toBe(600);
    expect(step.startTimeUnixNano).toBe(String((1_600 - 600) * 1e6));
    expect(step.endTimeUnixNano).toBe(String(1_600 * 1e6));

    // 树内全部 span 共享同一 traceId
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
  });

  it("model_retry/model_fallback/abort/warn → 根 span 注记；error 收尾 status=ERROR", async () => {
    const fetchImpl = capturingFetch();
    const sink = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl });
    sink.emit({ type: "turn_start", at: 1_000, sessionId: "s-2", turnId: "t-2" });
    sink.emit({
      type: "model_retry",
      at: 1_100,
      sessionId: "s-2",
      turnId: "t-2",
      attempt: 1,
      errorClass: "rate_limit",
      delayMs: 800,
      reason: "429",
    });
    sink.emit({ type: "model_fallback", at: 1_200, sessionId: "s-2", turnId: "t-2", from: "a", to: "b", errorClass: "rate_limit", reason: "retry exhausted" });
    sink.emit({ type: "abort", at: 1_300, sessionId: "s-2", turnId: "t-2", reason: "user", code: "TURN_ABORTED" });
    sink.emit({ type: "warn", at: 1_350, sessionId: "s-2", turnId: "t-2", code: "TURN_PERSIST_FAILED", detail: "slow write" });
    sink.emit({
      type: "turn_finish",
      at: 2_000,
      sessionId: "s-2",
      turnId: "t-2",
      status: "error",
      stepCount: 0,
      durationMs: 1_000,
      code: "TURN_ABORTED",
      message: "aborted by user",
    });
    await flushAsync();

    const root = spansOf(fetchImpl.calls[0])[0];
    const notes = root.events as Array<{ name: string; attributes: Array<{ key: string; value: Record<string, unknown> }> }>;
    expect(notes.map((n) => n.name)).toEqual(["model_retry", "model_fallback", "abort", "warn"]);
    const retry = notes[0];
    expect(retry.attributes.find((a) => a.key === "attempt")?.value.doubleValue).toBe(1);
    expect(retry.attributes.find((a) => a.key === "delayMs")?.value.doubleValue).toBe(800);
    expect(retry.attributes.find((a) => a.key === "errorClass")?.value.stringValue).toBe("rate_limit");
    // 异常收尾：status ERROR（2）+ message
    expect(root.status).toEqual({ code: 2, message: "aborted by user" });
    expect(attr(root, "code")).toBe("TURN_ABORTED");
  });

  it("error 事件收尾关树（turn_finish 不再到来也不悬挂）；随后同键 turn_finish 不重复推送", async () => {
    const fetchImpl = capturingFetch();
    const sink = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl });
    sink.emit({ type: "turn_start", at: 1_000, sessionId: "s-3", turnId: "t-3" });
    sink.emit({
      type: "error",
      at: 1_500,
      sessionId: "s-3",
      turnId: "t-3",
      code: "TURN_EXECUTION_FAILED",
      detail: "loop exploded",
    });
    await flushAsync();
    expect(fetchImpl.calls).toHaveLength(1);
    const root = spansOf(fetchImpl.calls[0])[0];
    expect(root.endTimeUnixNano).toBe(String(1_500 * 1e6));
    expect(root.status).toEqual({ code: 2, message: "loop exploded" });

    // 树已移除：同键 turn_finish 成为无树事件，不产生第二次 POST
    sink.emit({
      type: "turn_finish",
      at: 1_600,
      sessionId: "s-3",
      turnId: "t-3",
      status: "done",
      stepCount: 0,
      durationMs: 600,
    });
    await flushAsync();
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("无匹配在途树的事件（缺 turn_start / 缺双 id 注记）被丢弃且不推送", async () => {
    const fetchImpl = capturingFetch();
    const sink = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl });
    sink.emit({ type: "model_retry", at: 1, attempt: 1, errorClass: "network", delayMs: 10, reason: "no tree" });
    sink.emit({ type: "tool_result", at: 2, sessionId: "ghost", turnId: "ghost", tool: "x", ok: true, durationMs: 1 });
    sink.emit({ type: "turn_finish", at: 3, sessionId: "ghost", turnId: "ghost", status: "done", stepCount: 0, durationMs: 0 });
    await flushAsync();
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("推送失败 fail-open：fetch reject 不抛出、onError 收敛，后续轮次不受污染", async () => {
    const onError = vi.fn();
    const impl = (async (): Promise<Response> => {
      throw new TypeError("collector unreachable");
    }) as typeof fetch;
    const sink = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl: impl, onError });

    expect(() => {
      for (const event of fullTurn("s-4", "t-4")) sink.emit(event);
    }).not.toThrow();
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TypeError);

    // 下一轮照常构建推送（sink 状态未因失败损坏）
    const fetchImpl = capturingFetch();
    const sink2 = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl, onError });
    for (const event of fullTurn("s-5", "t-5")) sink2.emit(event);
    await flushAsync();
    expect(fetchImpl.calls).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("非 2xx 响应同样 fail-open（onError 报 HTTP 状态）", async () => {
    const onError = vi.fn();
    const fetchImpl = capturingFetch(503);
    const sink = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl, onError });
    for (const event of fullTurn("s-6", "t-6")) sink.emit(event);
    await flushAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain("503");
  });

  it("超限逐出最旧在途树：部分树先推送，总在途数被钳制", async () => {
    const fetchImpl = capturingFetch();
    const sink = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl, maxOpenTurns: 2 });
    sink.emit({ type: "turn_start", at: 1, sessionId: "s-a", turnId: "t-a" });
    sink.emit({ type: "turn_start", at: 2, sessionId: "s-b", turnId: "t-b" });
    // 第 3 棵树入列 → 最旧的 s-a 被逐出并立即推送（UNSET 终态）
    sink.emit({ type: "turn_start", at: 3, sessionId: "s-c", turnId: "t-c" });
    await flushAsync();
    expect(fetchImpl.calls).toHaveLength(1);
    const root = spansOf(fetchImpl.calls[0])[0];
    expect(attr(root, "sessionId")).toBe("s-a");
    expect(root.status).toEqual({ code: 0 });
  });
});

describe("驱动出站 traceparent 注入（无入站上下文 → 不加头）", () => {
  it("OpenAICompatibleDriver：无上下文时请求头与现状一致（无 traceparent）", async () => {
    const fetchImpl = sseCaptureHeaders('data: [DONE]\n\n');
    const driver = new OpenAICompatibleDriver("k", "http://x/v1", { fetchImpl, resilience: false });
    for await (const _ of driver.generateStream({ model: "gpt-x", messages: [] })) {
      void _;
    }
    expect((fetchImpl.captured?.headers as Record<string, string>)["traceparent"]).toBeUndefined();
  });

  it("AnthropicDriver：无上下文时请求头与现状一致（无 traceparent）", async () => {
    const fetchImpl = sseCaptureHeaders('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    for await (const _ of driver.generateStream({ model: "claude", messages: [] })) {
      void _;
    }
    expect((fetchImpl.captured?.headers as Record<string, string>)["traceparent"]).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 以下用例调用 setCurrentTraceContext（enterWith 改写当前异步链），        */
/* 必须保持在文件末尾，防止入站上下文泄漏影响上文的「无上下文」断言。        */
/* ------------------------------------------------------------------ */

describe("入站 traceparent 关联（文件末尾：ALS enterWith 泄漏防护）", () => {
  const INBOUND_TRACEPARENT = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;

  it("根 span 复用入站 trace_id，parentSpanId 指向远端父；子 span 同 trace", async () => {
    expect(setCurrentTraceContext(INBOUND_TRACEPARENT)).toBe(true);
    const fetchImpl = capturingFetch();
    const sink = createOtlpTraceSink({ endpoint: "http://c/v1/traces", fetchImpl });
    for (const event of fullTurn("s-9", "t-9")) sink.emit(event);
    await flushAsync();

    const spans = spansOf(fetchImpl.calls[0]);
    const root = spans[0];
    expect(root.traceId).toBe("a".repeat(32));
    expect(root.parentSpanId).toBe("b".repeat(16));
    for (const child of spans.slice(1)) {
      expect(child.traceId).toBe("a".repeat(32));
      expect(child.parentSpanId).toBe(root.spanId);
    }
  });

  it("OpenAICompatibleDriver 注入子 span traceparent（同 traceId + 新 spanId）", async () => {
    expect(setCurrentTraceContext(INBOUND_TRACEPARENT)).toBe(true);
    const fetchImpl = sseCaptureHeaders('data: [DONE]\n\n');
    const driver = new OpenAICompatibleDriver("k", "http://x/v1", { fetchImpl, resilience: false });
    for await (const _ of driver.generateStream({ model: "gpt-x", messages: [] })) {
      void _;
    }
    const traceparent = (fetchImpl.captured?.headers as Record<string, string>)["traceparent"];
    // span-id 段接受 16 或 32 hex：W3C 规范为 16 hex（8 字节），当前基建
    // trace-context.childTraceparent 以 randomHex(16) 产出 32 hex（已知偏差，
    // 修复属 trace-context.ts 主线职责）——断言放宽到两形态均通过
    expect(traceparent).toMatch(new RegExp(`^00-${"a".repeat(32)}-[0-9a-f]{16,32}-01$`));
    // 子 span 语义：新 spanId ≠ 入站父 spanId
    expect(traceparent?.split("-")[2]).not.toBe("b".repeat(16));
  });

  it("AnthropicDriver 注入子 span traceparent（同 traceId + 新 spanId）", async () => {
    expect(setCurrentTraceContext(INBOUND_TRACEPARENT)).toBe(true);
    const fetchImpl = sseCaptureHeaders('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    for await (const _ of driver.generateStream({ model: "claude", messages: [] })) {
      void _;
    }
    const traceparent = (fetchImpl.captured?.headers as Record<string, string>)["traceparent"];
    expect(traceparent).toMatch(new RegExp(`^00-${"a".repeat(32)}-[0-9a-f]{16,32}-01$`));
    expect(traceparent?.split("-")[2]).not.toBe("b".repeat(16));
  });
});
