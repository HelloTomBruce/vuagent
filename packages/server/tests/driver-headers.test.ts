/**
 * 驱动层出站请求头（0.7.2）：域名规则与归属头必须真的出现在 fetch 上，
 * 而不是只在 resolveEndpointHeaders 的单测里通过。
 */
import { describe, it, expect } from "vitest";
import { OpenAICompatibleDriver } from "../src/adapters/openai-driver.js";
import { AnthropicDriver } from "../src/adapters/anthropic-driver.js";
import { PRODUCT_UA } from "../src/core/attribution.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
}

/** 捕获首个请求头并返回一个最小 SSE 流（含 finish，驱动会正常结束） */
function captureFetch(captured: Captured[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n'),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}

async function drain(iter: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iter) void _;
}

describe("OpenAI 兼容驱动 · 出站头", () => {
  it("普通端点：Content-Type + Authorization + 归属 UA", async () => {
    const captured: Captured[] = [];
    const driver = new OpenAICompatibleDriver("sk-1", "https://api.deepseek.com/v1", {
      fetchImpl: captureFetch(captured),
      resilience: false,
    });
    await drain(driver.generateStream({ model: "deepseek-chat", messages: [], sessionId: "sess-9" }));

    const h = captured[0].headers;
    expect(h["Authorization"]).toBe("Bearer sk-1");
    expect(h["user-agent"]).toBe(PRODUCT_UA);
    expect(h["x-opencode-session"]).toBeUndefined();
  });

  it("OpenCode 端点：自动带 x-opencode-session（取 sessionId）", async () => {
    const captured: Captured[] = [];
    const driver = new OpenAICompatibleDriver("sk-2", "https://opencode.ai/inference/openai/v1", {
      fetchImpl: captureFetch(captured),
      resilience: false,
    });
    await drain(driver.generateStream({ model: "m", messages: [], sessionId: "sess-abc" }));
    expect(captured[0].headers["x-opencode-session"]).toBe("sess-abc");
    expect(captured[0].headers["Authorization"]).toBe("Bearer sk-2");
  });

  it("Azure 端点：用 api-key 而非 Authorization（不双发）", async () => {
    const captured: Captured[] = [];
    const driver = new OpenAICompatibleDriver("sk-3", "https://demo.openai.azure.com/openai/v1", {
      fetchImpl: captureFetch(captured),
      resilience: false,
    });
    await drain(driver.generateStream({ model: "gpt-4o", messages: [] }));

    const h = captured[0].headers;
    expect(h["api-key"]).toBe("sk-3");
    expect(h["Authorization"]).toBeUndefined();
  });
});

describe("Anthropic 驱动 · 出站头", () => {
  it("原生端点：x-api-key + anthropic-version + 归属 UA", async () => {
    const captured: Captured[] = [];
    const driver = new AnthropicDriver("sk-ant", "https://api.anthropic.com/v1", {
      fetchImpl: captureFetch(captured),
      resilience: false,
    });
    await drain(driver.generateStream({ model: "claude-x", messages: [] }));

    const h = captured[0].headers;
    expect(h["x-api-key"]).toBe("sk-ant");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(h["user-agent"]).toBe(PRODUCT_UA);
  });

  it("Anthropic 兼容网关（MiniMax 域名）：仍走 x-api-key", async () => {
    const captured: Captured[] = [];
    const driver = new AnthropicDriver("mm-key", "https://api.minimaxi.com/anthropic", {
      fetchImpl: captureFetch(captured),
      resilience: false,
    });
    await drain(driver.generateStream({ model: "MiniMax-M2", messages: [] }));
    expect(captured[0].headers["x-api-key"]).toBe("mm-key");
  });
});
