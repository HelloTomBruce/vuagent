import { describe, it, expect } from "vitest";
import {
  AnthropicDriver,
  applyPromptCaching,
  ANTHROPIC_CACHE_BREAKPOINT_LIMIT,
  mapOpenAIMessagesToAnthropic,
} from "../src/adapters/anthropic-driver.js";
import type { ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";

/**
 * TASK-099：Anthropic prompt caching 请求形态断言（stub fetch 捕获 body）。
 * 真实端点的缓存收益验证挂 docs/verification.md 清单（TASK-053 遗留合并），此处只测请求形态。
 */

/** 注入 fetch 捕获的请求信息（断言 body 用） */
interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

/** SSE 流 mock fetch：返回最小合法 Anthropic 流（只 message_stop 收尾） */
function anthropicSseFetch(): typeof fetch & { captured: CapturedRequest } {
  const captured: CapturedRequest = { url: "" };
  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.url = String(input);
    captured.init = init;
    const body = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
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

/** 请求件（system + messages）上的 cache_control 断点总数 */
function breakpointCount(system: unknown, messages: unknown): number {
  return (JSON.stringify({ system, messages }).match(/"cache_control"/g) ?? []).length;
}

/** 连续两轮对话的消息形态：system + user 提问 → 工具往返 → 追问 */
const TWO_TURN_MESSAGES = [
  { role: "system", content: "你是天气预报助手" },
  { role: "user", content: "北京天气如何？" },
  {
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Beijing"}' } },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "晴 25℃" },
  { role: "user", content: "那上海呢？" },
] as const;

interface BodyShape {
  system: unknown;
  messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
}

function bodyOf(captured: CapturedRequest): BodyShape {
  return JSON.parse(String(captured.init?.body)) as BodyShape;
}

describe("promptCaching=auto（TASK-099）", () => {
  it("连续两轮：第二轮请求含 cache_control，断点在 system 尾 + 倒数第 1/2 条消息末位块", async () => {
    const fetchImpl = anthropicSseFetch();
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });

    // 第一轮：system + 首问（断点逐请求布置，无跨请求状态）
    await collect(driver, { messages: TWO_TURN_MESSAGES.slice(0, 2) as never });
    const round1 = bodyOf(fetchImpl.captured);

    // 第二轮：完整工具往返 + 追问
    await collect(driver, { messages: TWO_TURN_MESSAGES as never });
    const round2 = bodyOf(fetchImpl.captured);

    // system 提升为数组形态，尾元素挂断点
    expect(round2.system).toEqual([
      { type: "text", text: "你是天气预报助手", cache_control: { type: "ephemeral" } },
    ]);

    const messages = round2.messages;
    expect(messages).toHaveLength(4); // user 首问 / assistant(tool_use) / user(tool_result) / user 追问
    // 倒数第 1 条（追问）末位块挂断点
    const last = messages[messages.length - 1];
    expect(last.content[last.content.length - 1]).toEqual({
      type: "text",
      text: "那上海呢？",
      cache_control: { type: "ephemeral" },
    });
    // 倒数第 2 条（tool_result user 消息）末位块挂断点
    const secondLast = messages[messages.length - 2];
    expect(secondLast.content[secondLast.content.length - 1]).toEqual({
      type: "tool_result",
      tool_use_id: "call_1",
      content: "晴 25℃",
      cache_control: { type: "ephemeral" },
    });
    // 首条消息（缓存前缀之外）不得挂断点
    expect(JSON.stringify(messages[0])).not.toContain("cache_control");

    // 断点总数 = system 尾 1 + 消息窗口 2 = 3（≤4 Anthropic 上限）
    expect(breakpointCount(round2.system, round2.messages)).toBe(3);

    // 第一轮同样自带断点（逐请求无状态）；仅 1 条消息 → system 尾 + 该消息 = 2 个
    expect(breakpointCount(round1.system, round1.messages)).toBe(2);
  });

  it("缺省（未传 promptCaching）= auto：system 尾挂断点", async () => {
    const fetchImpl = anthropicSseFetch();
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    await collect(driver, { messages: TWO_TURN_MESSAGES.slice(0, 2) as never });
    const body = bodyOf(fetchImpl.captured);
    expect(Array.isArray(body.system)).toBe(true);
    // 仅 1 条消息：system 尾 1 + 消息窗口 1 = 2 个断点
    expect(breakpointCount(body.system, body.messages)).toBe(2);
  });

  it("无 system 时消息尾部断点照常布置；单条消息只标一次", async () => {
    const fetchImpl = anthropicSseFetch();
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    await collect(driver, { messages: [{ role: "user", content: "hi" }] });
    const body = bodyOf(fetchImpl.captured);
    expect(body.system).toBeUndefined();
    const messages = body.messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].content[0]).toEqual({
      type: "text",
      text: "hi",
      cache_control: { type: "ephemeral" },
    });
    expect(breakpointCount(body.system, body.messages)).toBe(1);
  });

  it("超长上下文（30 条消息，模拟压缩后）断点仍在尾部窗口：只有最后两条消息与 system 尾挂标记", async () => {
    const fetchImpl = anthropicSseFetch();
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: "长会话系统提示" },
    ];
    for (let i = 0; i < 30; i++) {
      messages.push(
        i % 2 === 0
          ? { role: "user", content: `第 ${i} 轮提问` }
          : { role: "assistant", content: `第 ${i} 轮回答` }
      );
    }
    await collect(driver, { messages: messages as never });
    const body = bodyOf(fetchImpl.captured);

    const mapped = body.messages;
    // 头部窗口（前 28 条）零断点：压缩/裁剪后的旧前缀不设断点
    for (const msg of mapped.slice(0, mapped.length - 2)) {
      expect(JSON.stringify(msg)).not.toContain("cache_control");
    }
    // 尾部窗口恰为倒数第 1/2 条
    for (const msg of mapped.slice(mapped.length - 2)) {
      const block = msg.content[msg.content.length - 1];
      expect(block).toHaveProperty("cache_control", { type: "ephemeral" });
    }
    expect(breakpointCount(body.system, body.messages)).toBe(3);
  });
});

/**
 * 评审 #10：prompt caching × extended thinking 交叉面（当前实现形态锚定）。
 *
 * 机制事实（anthropic-driver.ts）：
 * - thinking 由 reasoning_effort 翻译为 payload.thinking = {type:"enabled", budget_tokens}；
 * - thinking 流增量（thinking_delta/signature_delta）只映射为 thought_delta 上抛，
 *   历史装配（mapOpenAIMessagesToAnthropic）从不产出 thinking/signature 内容块——
 *   因此断点（system 尾 + 消息倒数窗口）结构上不可能落在 thinking 签名块之后；
 * - 断点布置发生在请求装配期，与 thinking 参数无耦合。
 * 若未来把 thinking 块回填进 assistant 历史（官方 tool-loop 要求保留签名块），
 * 本用例需同步演进——届时布点须避开 thinking/signature 块。
 */
describe("promptCaching=auto × thinking（评审 #10）", () => {
  it("thinking.enabled=true：断点仍 ≤4、位于 system 尾与消息边界、不落在 thinking/signature 块之后", async () => {
    const fetchImpl = anthropicSseFetch();
    const driver = new AnthropicDriver("k", "http://x", { fetchImpl, resilience: false });

    // reasoning_effort=high → thinking enabled（budget 32768）
    await collect(driver, { messages: TWO_TURN_MESSAGES as never, parameters: { reasoning_effort: "high" } });
    const body = bodyOf(fetchImpl.captured) as BodyShape & {
      thinking?: { type: string; budget_tokens: number };
      max_tokens?: number;
    };

    // 锚定 thinking 确实启用（本用例若在此断言失败，说明请求装配形态已变，交叉面需重新评估）
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    // thinking 与采样参数互斥（TASK-084）：请求体不携带 temperature/top_p/top_k
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
    // max_tokens 抬到 budget 的 1.5 倍（千位取整 = 50000）
    expect(body.max_tokens).toBe(50_000);

    // 断点总数恒 ≤ Anthropic 上限，且仍是 auto 策略的 3 个（system 尾 + 消息倒数 1/2）
    expect(breakpointCount(body.system, body.messages)).toBe(3);
    expect(breakpointCount(body.system, body.messages)).toBeLessThanOrEqual(
      ANTHROPIC_CACHE_BREAKPOINT_LIMIT
    );

    // 断点位置：system 尾元素 + 倒数第 1/2 条消息的末位内容块（消息边界语义不变）
    const systemArr = body.system as Array<Record<string, unknown>>;
    expect(systemArr[systemArr.length - 1]).toHaveProperty("cache_control", { type: "ephemeral" });
    const msgs = body.messages;
    for (const idx of [msgs.length - 1, msgs.length - 2]) {
      const lastBlock = msgs[idx].content[msgs[idx].content.length - 1];
      expect(lastBlock).toHaveProperty("cache_control", { type: "ephemeral" });
    }

    // 关键锚定：装配后的历史消息里不存在 thinking/signature 类型块——
    // 断点结构上不可能落在 thinking 签名块之后破坏块序（当前实现形态）
    for (const msg of msgs) {
      for (const block of msg.content) {
        expect(block.type).not.toBe("thinking");
        expect(block.type).not.toBe("signature");
        expect(JSON.stringify(block)).not.toContain("signature_delta");
      }
    }
  });
});

describe("promptCaching=off（TASK-099）", () => {  it("请求体与旧版（无缓存注入）逐字节一致：system 保持字符串、零断点", async () => {
    const fetchImpl = anthropicSseFetch();
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl,
      resilience: false,
      promptCaching: "off",
    });
    await collect(driver, { messages: TWO_TURN_MESSAGES as never });

    const bodyText = String(fetchImpl.captured.init?.body);
    expect(bodyText).not.toContain("cache_control");

    // 逐字节基线：旧版装配顺序 model → max_tokens → stream → messages → system
    const { messages } = mapOpenAIMessagesToAnthropic(TWO_TURN_MESSAGES as never);
    const expected = JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      stream: true,
      messages,
      system: "你是天气预报助手",
    });
    expect(bodyText).toBe(expected);
  });

  it("resolve 函数形态：() => \"off\" 逐次求值生效，() => \"auto\" 恢复断点", async () => {
    let mode: "auto" | "off" = "off";
    const fetchImpl = anthropicSseFetch();
    const driver = new AnthropicDriver("k", "http://x", {
      fetchImpl,
      resilience: false,
      promptCaching: () => mode,
    });

    await collect(driver, { messages: TWO_TURN_MESSAGES.slice(0, 2) as never });
    expect(String(fetchImpl.captured.init?.body)).not.toContain("cache_control");
    expect((bodyOf(fetchImpl.captured) as { system: unknown }).system).toBe("你是天气预报助手");

    mode = "auto";
    await collect(driver, { messages: TWO_TURN_MESSAGES.slice(0, 2) as never });
    // 仅 1 条消息：system 尾 1 + 消息窗口 1 = 2 个断点
    expect(breakpointCount(bodyOf(fetchImpl.captured).system, bodyOf(fetchImpl.captured).messages)).toBe(2);
  });
});

describe("applyPromptCaching 纯函数边界", () => {
  it("断点硬闸：remaining 耗尽后不再布置（恒 ≤ ANTHROPIC_CACHE_BREAKPOINT_LIMIT）", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ] as never as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const systemOut = applyPromptCaching("s", messages as never);
    expect(systemOut).toEqual([{ type: "text", text: "s", cache_control: { type: "ephemeral" } }]);
    expect(breakpointCount(systemOut, messages)).toBeLessThanOrEqual(ANTHROPIC_CACHE_BREAKPOINT_LIMIT);
    expect(breakpointCount(systemOut, messages)).toBe(3);
  });

  it("空 system：原样返回空串，消息窗口照常布置", () => {
    const messages = [{ role: "user", content: [{ type: "text", text: "a" }] }] as never;
    const systemOut = applyPromptCaching("", messages);
    expect(systemOut).toBe("");
    expect(breakpointCount(systemOut, messages as never)).toBe(1);
  });
});
