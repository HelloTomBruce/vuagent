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
import { computeCostUsd } from "../src/core/pricing-table.js";
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
  it("message_start 的缓存明细汇总进 usage chunk，promptTokens 折回总输入口径", async () => {
    // TASK-079：Anthropic 的 input_tokens 不含 cache_read/cache_creation（并列上报），
    // 驱动统一为 OpenAI 语义（promptTokens = 总输入，cached 是其中子集）
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl: anthropicSseFetch([
        {
          type: "message_start",
          message: {
            id: "m1",
            usage: { input_tokens: 800, cache_read_input_tokens: 500, cache_creation_input_tokens: 200 },
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
    expect(usage?.promptTokens).toBe(1500); // 800 + 500 + 200
    expect(usage?.completionTokens).toBe(120);
    expect(usage?.totalTokens).toBe(1620);
    expect(usage?.cachedTokens).toBe(500);
    expect(usage?.cacheCreationTokens).toBe(200);
    // Anthropic thinking 计入 output，不单列 reasoning 分段
    expect(usage?.reasoningTokens).toBeUndefined();
  });

  it("无缓存命中 → cachedTokens/cacheCreationTokens 缺省，promptTokens 即 input_tokens", async () => {
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl: anthropicSseFetch([
        { type: "message_start", message: { id: "m1", usage: { input_tokens: 80 } } },
        { type: "message_delta", usage: { output_tokens: 20 } },
        { type: "message_stop" },
      ]),
      resilience: false,
    });
    const chunks = await collect(driver.generateStream({ model: "claude", messages: [] }));
    const usage = chunks.find((c) => c.type === "usage")?.usage;
    expect(usage?.promptTokens).toBe(80);
    expect(usage?.cachedTokens).toBeUndefined();
    expect(usage?.cacheCreationTokens).toBeUndefined();
  });

  it("message_delta 重复下发缓存明细时优先于 message_start 记忆", async () => {
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl: anthropicSseFetch([
        {
          type: "message_start",
          message: { id: "m1", usage: { input_tokens: 100, cache_read_input_tokens: 40 } },
        },
        {
          type: "message_delta",
          usage: { output_tokens: 10, cache_read_input_tokens: 60, cache_creation_input_tokens: 30 },
        },
        { type: "message_stop" },
      ]),
      resilience: false,
    });
    const chunks = await collect(driver.generateStream({ model: "claude", messages: [] }));
    const usage = chunks.find((c) => c.type === "usage")?.usage;
    expect(usage?.promptTokens).toBe(190); // 100 + 60 + 30
    expect(usage?.cachedTokens).toBe(60);
    expect(usage?.cacheCreationTokens).toBe(30);
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
    expect(ledger.exportSummary().tokens.cacheCreationTokens).toBe(0);
  });
});

describe("TASK-079 端到端：Anthropic SSE 明细 → usage → telemetry → computeCostUsd", () => {
  it("缓存读取/写入分档计费，常规段不被重复扣减（不再少计费）", async () => {
    // Anthropic 真实上报形态：input=800（不含缓存）、cache_read=500、cache_creation=200
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl: anthropicSseFetch([
        {
          type: "message_start",
          message: {
            id: "m1",
            usage: { input_tokens: 800, cache_read_input_tokens: 500, cache_creation_input_tokens: 200 },
          },
        },
        { type: "message_delta", usage: { output_tokens: 100 } },
        { type: "message_stop" },
      ]),
      resilience: false,
    });
    const chunks = await collect(driver.generateStream({ model: "claude-x", messages: [] }));

    // 与 agent-loop 同口径过 telemetry
    const ledger = new TelemetryLedger("t-e2e");
    for (const c of chunks) {
      if (c.type === "usage" && c.usage) {
        ledger.addTokens(c.usage.promptTokens, c.usage.completionTokens, {
          reasoningTokens: c.usage.reasoningTokens,
          cachedTokens: c.usage.cachedTokens,
          cacheCreationTokens: c.usage.cacheCreationTokens,
        });
      }
    }
    const tokens = ledger.exportSummary().tokens;
    expect(tokens.promptTokens).toBe(1500);
    expect(tokens.cachedTokens).toBe(500);
    expect(tokens.cacheCreationTokens).toBe(200);

    // 计价：input $3 / cacheRead $1.5 / cacheWrite $3.75 / output $15（每 1M）
    // 常规 800×3 + 读取 500×1.5 + 写入 200×3.75 + 输出 100×15 = 2400+750+750+1500 = 5400 微美元
    const cost = computeCostUsd(
      { input: 3, output: 15, cacheRead: 1.5, cacheWrite: 3.75 },
      tokens.promptTokens,
      tokens.completionTokens,
      { cachedPromptTokens: tokens.cachedTokens, cacheCreationTokens: tokens.cacheCreationTokens }
    );
    expect(cost).toBeCloseTo(0.0054, 6);
  });

  it("缺省费率回落：cacheWrite 缺省按 input 价，分段缺省回落整段单价", () => {
    // 只给 input/output：写入段按 input 价（3），读取段按 input*0.5（1.5）
    const cost = computeCostUsd({ input: 3, output: 15 }, 1500, 100, {
      cachedPromptTokens: 500,
      cacheCreationTokens: 200,
    });
    // 800×3 + 500×1.5 + 200×3 + 100×15 = 2400+750+600+1500 = 5250 微美元
    expect(cost).toBeCloseTo(0.00525, 6);
    // 分段全缺省 → 与整段单价一致（保守兼容旧端点）
    expect(computeCostUsd({ input: 3, output: 15 }, 1500, 100)).toBeCloseTo(0.006, 6);
  });

  it("脏数据守卫：分段超过总输入时常规段钳 0，不产出负段账单", () => {
    const cost = computeCostUsd({ input: 3, output: 15, cacheWrite: 3.75 }, 100, 10, {
      cachedPromptTokens: 500,
      cacheCreationTokens: 500,
    });
    // cached 钳到 100 → 写入余量 0 → 常规 0；账单 = 100×1.5 + 10×15
    expect(cost).toBeCloseTo(0.0003, 6);
  });
});
