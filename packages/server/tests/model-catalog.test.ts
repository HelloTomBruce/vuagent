import { describe, it, expect } from "vitest";
import {
  CONTEXT_WINDOW_MAX,
  CONTEXT_WINDOW_MIN,
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow,
} from "../src/core/model-catalog.js";

describe("模型上下文窗口动态解析（resolveContextWindow）", () => {
  it("档案显式值最优先且受钳制", () => {
    expect(resolveContextWindow({ model: "gpt-4o", contextWindow: 200_000 })).toBe(200_000);
    expect(resolveContextWindow({ model: "any-model", contextWindow: 4_000 })).toBe(CONTEXT_WINDOW_MIN);
    expect(resolveContextWindow({ model: "any-model", contextWindow: 99_000_000 })).toBe(CONTEXT_WINDOW_MAX);
    // 非法值（0/负数/NaN）不参与，走查表
    expect(resolveContextWindow({ model: "deepseek-chat", contextWindow: 0 })).toBe(128_000);
    expect(resolveContextWindow({ model: "claude-sonnet-4-5", contextWindow: -5 })).toBe(200_000);
  });

  it("按模型名前缀最长匹配查表", () => {
    expect(resolveContextWindow({ model: "gpt-4.1-mini" })).toBe(1_000_000); // 长前缀优先于 gpt-4
    expect(resolveContextWindow({ model: "gpt-4o-mini" })).toBe(128_000);
    expect(resolveContextWindow({ model: "claude-sonnet-4-5" })).toBe(200_000);
    expect(resolveContextWindow({ model: "deepseek-chat" })).toBe(128_000);
    expect(resolveContextWindow({ model: "deepseek-reasoner" })).toBe(64_000);
    expect(resolveContextWindow({ model: "qwen-long" })).toBe(1_000_000);
    expect(resolveContextWindow({ model: "gemini-2.5-pro" })).toBe(1_000_000);
  });

  it("未知模型回落默认档且钳制生效", () => {
    expect(resolveContextWindow({ model: "totally-unknown-99" })).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: "" })).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(DEFAULT_CONTEXT_WINDOW).toBeGreaterThanOrEqual(CONTEXT_WINDOW_MIN);
    expect(DEFAULT_CONTEXT_WINDOW).toBeLessThanOrEqual(CONTEXT_WINDOW_MAX);
  });

  it("大小写不敏感", () => {
    expect(resolveContextWindow({ model: "DeepSeek-Chat" })).toBe(128_000);
    expect(resolveContextWindow({ model: "CLAUDE-3-5-sonnet" })).toBe(200_000);
  });
});
