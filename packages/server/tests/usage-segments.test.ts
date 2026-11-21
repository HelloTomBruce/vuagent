/**
 * 能力运行时 P1：usage 分段（reasoning / cached）全链路
 *
 * 驱动解析（OpenAI 明细字段 / Anthropic cache_read）→ usage 事件可选分段 →
 * telemetry 累计 → CostRecordInput 分档计价。端点不提供明细时字段缺省，
 * 计价回落整段单价（保守兼容旧端点）。
 */
import { describe, it, expect } from "vitest";
import { OpenAICompatibleDriver } from "../src/adapters/openai-driver.js";
import { AnthropicDriver } from "../src/adapters/anthropic-driver.js";
import { TelemetryLedger } from "../src/core/telemetry.js";
import type { ModelStreamChunk } from "../src/adapters/model-driver.js";

/** OpenAI 风格 SSE stub */
function openaiSseFetch(chunks: Array<Record<string, unknown>>): typeof fetch {
  return (async () => {
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
}

/** Anthropic 风格 SSE stub（event:/data: 双行） */
function anthropicSseFetch(events: Array<Record<string, unknown>>): typeof fetch {
  return (async () => {
    const body = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
}

async function collect(chunks: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const out: ModelStreamChunk[] = [];
  for await (const c of chunks) out.push(c);
  return out;
}

describe("usage 分段：OpenAI 兼容驱动", () => {
  it("usage 明细带 cached/reasoning → chunk 携带分段", async () => {
    const driver = new OpenAICompatibleDriver("k", "http://x", {
      fetchImpl: openaiSseFetch([
        {
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 400,
            total_tokens: 1400,
            prompt_tokens_details: { cached_tokens: 600 },
            completion_tokens_details: { reasoning_tokens: 250 },
          },
        },
      ]),
      resilience: false,
    });
    const chunks = await collect(driver.generateStream({ model: "m", messages: [] }));
    const usage = chunks.find((c) => c.type === "usage")?.usage;
    expect(usage?.promptTokens).toBe(1000);
    expect(usage?.cachedTokens).toBe(600);
    expect(usage?.reasoningTokens).toBe(250);
  });

  it("旧端点无明细字段 → 分段缺省（不编造 0）", async () => {
    const driver = new OpenAICompatibleDriver("k", "http://x", {
      fetchImpl: openaiSseFetch([
        { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      ]),
      resilience: false,
    });
    const chunks = await collect(driver.generateStream({ model: "m", messages: [] }));
    const usage = chunks.find((c) => c.type === "usage")?.usage;
    expect(usage?.cachedTokens).toBeUndefined();
    expect(usage?.reasoningTokens).toBeUndefined();
  });
});

describe("usage 分段：Anthropic 驱动", () => {
  it("message_start 的 cache_read_input_tokens 汇总进 usage chunk", async () => {
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl: anthropicSseFetch([
        {
          type: "message_start",
          message: {
            id: "m1",
            usage: { input_tokens: 800, cache_read_input_tokens: 500 },
          },
        },
        {
          type: "message_delta",
          usage: { output_tokens: 120 },
        },
        { type: "message_stop" },
      ]),
      resilience: false,
    });
    const chunks = await collect(driver.generateStream({ model: "claude", messages: [] }));
    const usage = chunks.find((c) => c.type === "usage")?.usage;
    expect(usage?.promptTokens).toBe(800);
    expect(usage?.completionTokens).toBe(120);
    expect(usage?.cachedTokens).toBe(500);
    // Anthropic thinking 计入 output，不单列 reasoning 分段
    expect(usage?.reasoningTokens).toBeUndefined();
  });

  it("无缓存命中 → cachedTokens 缺省", async () => {
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl: anthropicSseFetch([
        { type: "message_start", message: { id: "m1", usage: { input_tokens: 80 } } },
        { type: "message_delta", usage: { output_tokens: 20 } },
        { type: "message_stop" },
      ]),
      resilience: false,
    });
    const chunks = await collect(driver.generateStream({ model: "claude", messages: [] }));
    expect(chunks.find((c) => c.type === "usage")?.usage?.cachedTokens).toBeUndefined();
  });
});

describe("usage 分段：telemetry 累计", () => {
  it("多步分段累加，exportSummary 输出分档数据源", () => {
    const ledger = new TelemetryLedger("t-1");
    ledger.addTokens(1000, 400, { cachedTokens: 600, reasoningTokens: 250 });
    ledger.addTokens(2000, 600, { cachedTokens: 1000, reasoningTokens: 350 });
    const summary = ledger.exportSummary();
    expect(summary.tokens.promptTokens).toBe(3000);
    expect(summary.tokens.completionTokens).toBe(1000);
    expect(summary.tokens.cachedTokens).toBe(1600);
    expect(summary.tokens.reasoningTokens).toBe(600);
  });

  it("不带分段调用（旧路径）→ 累计为 0，不抛错", () => {
    const ledger = new TelemetryLedger("t-2");
    ledger.addTokens(100, 50);
    expect(ledger.exportSummary().tokens.cachedTokens).toBe(0);
    expect(ledger.exportSummary().tokens.reasoningTokens).toBe(0);
  });
});
