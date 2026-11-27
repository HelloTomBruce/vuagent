/**
 * 协议路由（0.7.2 评审 C1 回归）。
 *
 * 事故：路由条件写死 `provider === "anthropic" && !baseUrl`。供应商扩到 24 家后，
 * MiniMax（Anthropic 协议的兼容网关，预设里 protocol="anthropic" 且带 baseUrl）
 * 被路由到 OpenAI 兼容驱动 → 把 OpenAI 格式的 payload 发到 Anthropic 端点，首次
 * 选择即 400。这里锁住「按预设 protocol 路由」的契约。
 */
import { describe, it, expect } from "vitest";
import {
  buildDriverForProfile,
  fallbackApiKeyEnv,
  profileNeedsApiKey,
} from "../src/core/driver-factory.js";
import { AnthropicDriver } from "../src/adapters/anthropic-driver.js";
import { OpenAICompatibleDriver } from "../src/adapters/openai-driver.js";
import type { ModelProfileEntity } from "../src/storage/interfaces.js";
import type { ProviderKind } from "@vuagent/protocol";

const profile = (over: Partial<ModelProfileEntity>): ModelProfileEntity =>
  ({
    id: "mp-1",
    name: "test",
    provider: "deepseek",
    model: "m",
    apiKey: "sk-test",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as ModelProfileEntity;

describe("buildDriverForProfile · 协议路由", () => {
  it("MiniMax（anthropic 协议 + 显式 baseUrl）→ AnthropicDriver（C1 回归）", () => {
    const driver = buildDriverForProfile(
      profile({ provider: "minimax", baseUrl: "https://api.minimaxi.com/anthropic" }),
    );
    expect(driver).toBeInstanceOf(AnthropicDriver);
  });

  it("Anthropic 官方（无 baseUrl）→ AnthropicDriver", () => {
    expect(buildDriverForProfile(profile({ provider: "anthropic" }))).toBeInstanceOf(AnthropicDriver);
  });

  it("OpenAI 协议族（deepseek / openai / zhipu / openrouter / opencode / gemini / azure）→ OpenAI 兼容驱动", () => {
    const providers: ProviderKind[] = [
      "deepseek",
      "openai",
      "zhipu",
      "openrouter",
      "opencode",
      "gemini",
      "azure-openai",
      "ollama",
      "custom",
    ];
    for (const provider of providers) {
      expect(
        buildDriverForProfile(profile({ provider }), {}),
        `provider=${provider}`,
      ).toBeInstanceOf(OpenAICompatibleDriver);
    }
  });

  it("注入的驱动优先于一切（宿主/测试替身语义不变）", () => {
    const injected = { generateStream: () => (async function* () {})() } as never;
    expect(buildDriverForProfile(profile({}), { injected })).toBe(injected);
  });

  it("MiniMax 走 AnthropicDriver 时请求打到预设端点（不是官方 api.anthropic.com）", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            c.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;

    const driver = buildDriverForProfile(
      profile({ provider: "minimax", baseUrl: "https://api.minimaxi.com/anthropic" }),
      { fetchImpl },
    );
    for await (const _ of driver.generateStream({ model: "MiniMax-M2", messages: [] })) void _;
    expect(urls[0]).toContain("api.minimaxi.com");
  });
});

describe("凭据判定 · 本地无鉴权供应商（R2 回归）", () => {
  it("ollama / lmstudio 不需要 API Key", () => {
    const local: ProviderKind[] = ["ollama", "lmstudio"];
    for (const provider of local) {
      expect(profileNeedsApiKey({ provider })).toBe(false);
      expect(fallbackApiKeyEnv({ provider })).toBeUndefined();
    }
  });

  it("云端供应商需要密钥，且环境变量按协议选择", () => {
    expect(profileNeedsApiKey({ provider: "deepseek" })).toBe(true);
    expect(profileNeedsApiKey({ provider: "minimax" })).toBe(true);
    // anthropic 协议取 ANTHROPIC_API_KEY，其余取 OPENAI_API_KEY（值取决于宿主机环境）
    expect(fallbackApiKeyEnv({ provider: "minimax" })).toBe(process.env.ANTHROPIC_API_KEY);
    expect(fallbackApiKeyEnv({ provider: "openai" })).toBe(process.env.OPENAI_API_KEY);
  });
});
