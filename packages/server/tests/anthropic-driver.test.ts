import { describe, it, expect } from "vitest";
import { AnthropicDriver, mapOpenAIMessagesToAnthropic } from "../src/adapters/anthropic-driver.js";
import type { ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";

/** 注入 fetch 捕获的请求信息（断言 body / headers 用） */
interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

/**
 * SSE 流 mock fetch：返回 Anthropic Messages API 流式响应（对齐 resilience.test.ts
 * 的 sseFetch 先例，但用 Anthropic 的 event:/data: 双行事件格式）。
 * 每个事件对象的 type 字段同时充当 event 行名（Anthropic 两者一致）。
 */
function anthropicSseFetch(
  events: Array<Record<string, unknown>>,
  status = 200
): typeof fetch & { captured: CapturedRequest } {
  const captured: CapturedRequest = { url: "" };
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.url = String(input);
    captured.init = init;
    const body = events
      .map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`)
      .join("");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    return new Response(stream, {
      status,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
  return Object.assign(fetchFn, { captured });
}

/** 收集 generateStream 的全部增量 */
async function collect(
  driver: AnthropicDriver,
  req: Partial<ModelDriverRequest> = {}
): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = [];
  for await (const c of driver.generateStream({ model: "claude-sonnet-4-5", messages: [], ...req })) {
    chunks.push(c);
  }
  return chunks;
}

describe("AnthropicDriver SSE 增量映射", () => {
  it("text/thinking 增量、usage、message_stop→done；content_block_start(text) 不产 chunk", async () => {
    const fetchImpl = anthropicSseFetch([
      {
        type: "message_start",
        message: { id: "msg_1", usage: { input_tokens: 12, output_tokens: 0 } },
      },
      // text 块 start 事件：无内容，不应产生任何 chunk
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先想一想…" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "，世界" } },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 8 },
      },
      { type: "message_stop" },
    ]);
    const driver = new AnthropicDriver("sk-ant-test", "http://x", { fetchImpl, resilience: false });

    const chunks = await collect(driver);

    // text start 事件被静默：chunk 序列里不存在空 tool_call/text 噪声
    expect(chunks.some((c) => c.type === "tool_call_delta")).toBe(false);
    expect(chunks.filter((c) => c.type === "thought_delta")).toEqual([
      { type: "thought_delta", text: "先想一想…" },
    ]);
    expect(chunks.filter((c) => c.type === "text_delta")).toEqual([
      { type: "text_delta", text: "你好" },
      { type: "text_delta", text: "，世界" },
    ]);
    // usage：promptTokens 来自 message_start 记忆（message_delta 通常只带 output_tokens）
    expect(chunks.find((c) => c.type === "usage")).toEqual({
      type: "usage",
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
    });
    expect(chunks[chunks.length - 1]).toEqual({ type: "done" });
  });

  it("tool_use 跨多个 input_json_delta：start 产 id/name 块，后续切片可累积还原入参", async () => {
    const fetchImpl = anthropicSseFetch([
      { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 0 } } },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_abc", name: "get_weather" },
      },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"Beijing"}' } },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 25 },
      },
      { type: "message_stop" },
    ]);
    const driver = new AnthropicDriver("sk-ant-test", "http://x", { fetchImpl, resilience: false });

    const chunks = await collect(driver);
    const toolChunks = chunks.filter((c) => c.type === "tool_call_delta");
    // 首个块携带 id/name + 空切片；content_block_stop 不产 chunk
    expect(toolChunks[0]).toEqual({
      type: "tool_call_delta",
      toolCall: { index: 0, id: "toolu_abc", name: "get_weather", argumentsDelta: "" },
    });
    expect(toolChunks).toHaveLength(3);

    // 上层累积口径：拼接全部 argumentsDelta 后 JSON.parse
    const accumulated = toolChunks.map((c) => (c.toolCall?.argumentsDelta ?? "")).join("");
    expect(JSON.parse(accumulated)).toEqual({ city: "Beijing" });

    expect(chunks.find((c) => c.type === "usage")).toEqual({
      type: "usage",
      usage: { promptTokens: 100, completionTokens: 25, totalTokens: 125 },
    });
    expect(chunks[chunks.length - 1]).toEqual({ type: "done" });
  });

  it("message_delta.usage 自带 input_tokens 时优先于 message_start 记忆", async () => {
    const fetchImpl = anthropicSseFetch([
      { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 50, output_tokens: 5 } },
      { type: "message_stop" },
    ]);
    const driver = new AnthropicDriver("sk-ant-test", "http://x", { fetchImpl, resilience: false });
    const chunks = await collect(driver);
    expect(chunks.find((c) => c.type === "usage")).toEqual({
      type: "usage",
      usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 },
    });
  });
});

describe("AnthropicDriver 请求体映射", () => {
  it("system 消息抽出进 body.system，不出现在 messages；url/headers 符合 Anthropic 契约", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("sk-ant-key", "http://x", { fetchImpl, resilience: false });

    await collect(driver, {
      messages: [
        { role: "system", content: "规则 A" },
        { role: "system", content: "规则 B" },
        { role: "user", content: "hi" },
      ],
    });

    const { url, init } = fetchImpl.captured;
    expect(url).toBe("http://x/v1/messages");

    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // 多条 system 以双换行拼成顶层参数；TASK-099 起默认 promptCaching=auto，
    // system 提升为块数组并在尾元素挂 cache_control 断点（off 才是旧版字符串形态）
    expect(body.system).toEqual([
      { type: "text", text: "规则 A\n\n规则 B", cache_control: { type: "ephemeral" } },
    ]);
    const messages = body.messages as Array<{ role: string }>;
    expect(messages.every((m) => m.role === "user" || m.role === "assistant")).toBe(true);
    expect(messages).toHaveLength(1);
    expect(body.stream).toBe(true);
    // max_tokens 必填：缺省 8192
    expect(body.max_tokens).toBe(8192);
  });

  it("tool 消息映射 tool_result（连续 tool 合并进同一 user 消息）；assistant tool_calls 映射 tool_use", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("sk-ant-key", "http://x", { fetchImpl, resilience: false });

    await collect(driver, {
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "北京天气如何？" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "晴 25℃" },
        { role: "user", content: "谢谢" },
      ],
    });

    const messages = (
      JSON.parse(String(fetchImpl.captured.init?.body)) as { messages: Array<Record<string, unknown>> }
    ).messages;

    // assistant：arguments 被解析为 input 对象
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_1",
          name: "get_weather",
          input: { city: "Beijing" },
        },
      ],
    });
    // tool → user 消息携带 tool_result block，tool_use_id 对齐原 call id；
    // TASK-099 默认 promptCaching=auto：该消息为倒数第 2 条，末位块挂缓存断点
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_1", content: "晴 25℃", cache_control: { type: "ephemeral" } },
      ],
    });
  });

  it("tools function 风格 → Anthropic 工具定义（parameters 平移为 input_schema）", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("sk-ant-key", "http://x", { fetchImpl, resilience: false });

    await collect(driver, {
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "查询城市天气",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
    });

    const body = JSON.parse(String(fetchImpl.captured.init?.body)) as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        name: "get_weather",
        description: "查询城市天气",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
  });

  it("maxTokens 选项生效；req.parameters.max_tokens 按次覆盖", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false, maxTokens: 1024 });
    await collect(driver, {});
    expect((JSON.parse(String(fetchImpl.captured.init?.body)) as Record<string, unknown>).max_tokens).toBe(1024);

    const fetchImpl2 = anthropicSseFetch([{ type: "message_stop" }]);
    const driver2 = new AnthropicDriver("k", "http://x", { fetchImpl: fetchImpl2, resilience: false, maxTokens: 1024 });
    await collect(driver2, { parameters: { max_tokens: 2048 } });
    expect((JSON.parse(String(fetchImpl2.captured.init?.body)) as Record<string, unknown>).max_tokens).toBe(2048);
  });

  it("baseUrl 尾斜杠与缺省值：不产生双斜杠路径", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("k", "http://x/", { fetchImpl, resilience: false });
    await collect(driver, {});
    expect(fetchImpl.captured.url).toBe("http://x/v1/messages");
  });
});

describe("AnthropicDriver 错误分类与韧性", () => {
  it("429 → ClassifiedModelError errorClass=rate_limit（resilience:false 时单次调用不重试）", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response('{"type":"error","error":{"type":"rate_limit_error"}}', { status: 429 });
    }) as typeof fetch;
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });

    await expect(async () => {
      for await (const _ of driver.generateStream({ model: "m", messages: [] })) {
        // drain
      }
    }).rejects.toMatchObject({ errorClass: "rate_limit", status: 429, name: "ClassifiedModelError" });
    expect(calls).toBe(1);
  });

  it("fetch reject → ClassifiedModelError errorClass=network", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    await expect(async () => {
      for await (const _ of driver.generateStream({ model: "m", messages: [] })) {
        // drain
      }
    }).rejects.toMatchObject({ errorClass: "network" });
  });

  it("默认启用韧性层：happy path 经包装 fetch 正常消费（同 OpenAICompatibleDriver 接法）", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl });
    const chunks = await collect(driver);
    expect(chunks[chunks.length - 1]).toEqual({ type: "done" });
  });
});

describe("mapOpenAIMessagesToAnthropic 边界", () => {
  it("非法 arguments JSON 容错为空对象；空 assistant 消息被跳过", () => {
    const { messages } = mapOpenAIMessagesToAnthropic([
      { role: "user", content: "q" },
      {
        role: "assistant",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "f", arguments: "not-json{" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "r" },
    ]);
    const assistant = messages[1] as { content: Array<Record<string, unknown>> };
    expect(assistant.content[0]).toMatchObject({ type: "tool_use", id: "c1", name: "f", input: {} });
  });

  it("无 system / 无 tools 时不携带对应顶层参数", () => {
    const { system, messages } = mapOpenAIMessagesToAnthropic([{ role: "user", content: "hi" }]);
    expect(system).toBe("");
    expect(messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  });
});

describe("推理档位 → extended thinking 映射（能力运行时 P1）", () => {
  function payloadOf(body: BodyInit | null | undefined): Record<string, unknown> {
    return JSON.parse(String(body)) as Record<string, unknown>;
  }

  it("reasoning_effort=high → thinking budget 32K，max_tokens 抬到预算之上，剔除原字段", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    await collect(driver, {
      parameters: { reasoning_effort: "high", temperature: 0.7, max_tokens: 8192 },
    });

    const payload = payloadOf(fetchImpl.captured.init?.body);
    expect(payload.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    expect(payload.max_tokens).toBeGreaterThanOrEqual(32768 * 1.5);
    // reasoning_effort 原字段与互斥的 temperature 都不得透传（Anthropic 必 400）
    expect(payload.reasoning_effort).toBeUndefined();
    expect(payload.temperature).toBeUndefined();
  });

  it("low/medium 档与未知名：按换算表映射，未知名回落 medium", async () => {
    for (const [effort, budget] of [["low", 4096], ["medium", 16384], ["ultra", 16384]] as const) {
      const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
      const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
      await collect(driver, { parameters: { reasoning_effort: effort } });
      const payload = payloadOf(fetchImpl.captured.init?.body);
      expect(payload.thinking).toEqual({ type: "enabled", budget_tokens: budget });
    }
  });

  it("无档位时 temperature 正常透传，thinking 不出现", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    await collect(driver, { parameters: { temperature: 0.4, max_tokens: 1024 } });

    const payload = payloadOf(fetchImpl.captured.init?.body);
    expect(payload.temperature).toBe(0.4);
    expect(payload.max_tokens).toBe(1024);
    expect(payload.thinking).toBeUndefined();
  });

  it("TASK-084：thinking 启用时 top_p/top_k 与 temperature 一并剔除；无档位时三者透传", async () => {
    // thinking 启用：三个采样参数都不得透传（与 extended thinking 互斥，同发必 400）
    const onFetch = anthropicSseFetch([{ type: "message_stop" }]);
    const onDriver = new AnthropicDriver("k", "http://x", { fetchImpl: onFetch, resilience: false });
    await collect(onDriver, {
      parameters: { reasoning_effort: "low", temperature: 0.7, top_p: 0.9, top_k: 40 },
    });
    const onPayload = payloadOf(onFetch.captured.init?.body);
    expect(onPayload.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(onPayload.temperature).toBeUndefined();
    expect(onPayload.top_p).toBeUndefined();
    expect(onPayload.top_k).toBeUndefined();

    // 无 thinking：三个采样参数全部正常透传
    const offFetch = anthropicSseFetch([{ type: "message_stop" }]);
    const offDriver = new AnthropicDriver("k", "http://x", { fetchImpl: offFetch, resilience: false });
    await collect(offDriver, { parameters: { temperature: 0.7, top_p: 0.9, top_k: 40 } });
    const offPayload = payloadOf(offFetch.captured.init?.body);
    expect(offPayload.thinking).toBeUndefined();
    expect(offPayload.temperature).toBe(0.7);
    expect(offPayload.top_p).toBe(0.9);
    expect(offPayload.top_k).toBe(40);
  });

  it("TASK-084：档名撞原型成员（constructor）回落 medium，不产出非法 budget", async () => {
    const fetchImpl = anthropicSseFetch([{ type: "message_stop" }]);
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    await collect(driver, { parameters: { reasoning_effort: "constructor" } });
    const payload = payloadOf(fetchImpl.captured.init?.body);
    // Object.hasOwn 守卫：取不到原型上的函数，按未知名回落 medium
    expect(payload.thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
  });

  it("当 SSE 流接收到 type: 'error' 事件时抛出 ClassifiedModelError", async () => {
    const fetchImpl = anthropicSseFetch([
      {
        type: "error",
        error: { type: "overloaded_error", message: "Anthropic is currently overloaded." },
      },
    ]);
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    await expect(collect(driver)).rejects.toThrow(/Anthropic 流式错误: Anthropic is currently overloaded/);
  });
});
