/**
 * 模型列表能力探测（model-probe）
 *
 * 真实世界背景：各供应商 /models 的信息量差异极大——
 *   智谱/OpenAI 标准只有 { id, object, created, owned_by }；
 *   Kimi 带 context_length / supports_image_in / think_efforts；
 *   OpenRouter 带 architecture.input_modalities / supported_parameters / reasoning。
 * 探测层要能统一归一化，并且在拿不到信息时**什么都不返回**（而不是瞎猜）。
 */
import { describe, it, expect } from "vitest";
import { detectModel, detectModels } from "../src/core/model-probe.js";

describe("model-probe：能力探测", () => {
  it("OpenAI 标准格式（无能力信息）只返回 id，不编造能力", () => {
    const r = detectModel({ id: "gpt-4o", object: "model", created: 1, owned_by: "openai" });
    expect(r).toEqual({ id: "gpt-4o" });
    expect(r?.capabilities).toBeUndefined();
  });

  it("Kimi 扩展格式：上下文 / 模态 / 推理档位", () => {
    const r = detectModel({
      id: "k3",
      display_name: "Kimi K3",
      context_length: 1048576,
      supports_reasoning: true,
      supports_image_in: true,
      modalities: { input: ["text", "image"] },
      think_efforts: { valid_efforts: ["low", "high", "max"], default_effort: "max" },
    });
    expect(r?.displayName).toBe("Kimi K3");
    expect(r?.capabilities?.contextWindow).toBe(1048576);
    expect(r?.capabilities?.inputModalities).toEqual(["text", "image"]);
    expect(r?.capabilities?.reasoning).toEqual({
      supported: true,
      supportedEfforts: ["low", "high", "max"],
      defaultEffort: "max",
    });
    expect(r?.capabilities?.source).toBe("detected");
  });

  it("OpenRouter 格式：context / 最大输出 / 模态 / 支持参数 / 推理", () => {
    const r = detectModel({
      id: "google/gemini-4",
      context_length: 1048576,
      architecture: { input_modalities: ["text", "image", "audio"] },
      top_provider: { max_completion_tokens: 65536 },
      supported_parameters: ["tools", "temperature", "reasoning"],
      reasoning: { supported_efforts: ["low", "high"], default_effort: "high" },
    });
    expect(r?.capabilities?.contextWindow).toBe(1048576);
    expect(r?.capabilities?.maxOutputTokens).toBe(65536);
    expect(r?.capabilities?.inputModalities).toEqual(["text", "image", "audio"]);
    expect(r?.capabilities?.supportedParameters).toContain("tools");
    expect(r?.capabilities?.reasoning?.supportedEfforts).toEqual(["low", "high"]);
    expect(r?.capabilities?.reasoning?.defaultEffort).toBe("high");
  });

  it("models.dev 格式：attachment / tool_call / reasoning_options / limit", () => {
    const r = detectModel({
      id: "gpt-5-mini",
      attachment: true,
      reasoning: true,
      tool_call: true,
      temperature: false,
      reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high"] }],
      modalities: { input: ["text", "image"] },
      limit: { context: 400000, output: 128000 },
    });
    expect(r?.capabilities?.contextWindow).toBe(400000);
    expect(r?.capabilities?.maxOutputTokens).toBe(128000);
    // attachment:true 推得图片输入
    expect(r?.capabilities?.inputModalities).toContain("image");
    // tool_call:true 推得 tools
    expect(r?.capabilities?.supportedParameters).toContain("tools");
    expect(r?.capabilities?.reasoning?.supportedEfforts).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    // temperature:false 不得出现在支持参数里
    expect(r?.capabilities?.supportedParameters).not.toContain("temperature");
  });

  it("Ollama 的 /v1/models 无能力字段时不编造", () => {
    const r = detectModel({ id: "qwen2.5-coder:7b", object: "model", owned_by: "library" });
    expect(r).toEqual({ id: "qwen2.5-coder:7b" });
    expect(r?.capabilities).toBeUndefined();
  });

  it("批量解析：data[] 与 models[] 两种外壳都支持，并去重", () => {
    const fromData = detectModels({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] });
    expect(fromData.map((m) => m.id)).toEqual(["a", "b"]);

    const fromModels = detectModels({ models: [{ id: "x" }, { id: "y" }] });
    expect(fromModels.map((m) => m.id)).toEqual(["x", "y"]);

    // Ollama 原生用 name 字段
    const usesName = detectModels({ models: [{ name: "llama3:8b" }] });
    expect(usesName.map((m) => m.id)).toEqual(["llama3:8b"]);
  });

  it("无 id 的脏数据被丢弃，不产生空条目", () => {
    expect(detectModels({ data: [{ object: "model" }, { id: "" }, {}] })).toHaveLength(0);
  });

  it("文本模态始终存在（对话模型必然支持文本）", () => {
    const r = detectModel({ id: "m", modalities: { input: ["image"] } });
    expect(r?.capabilities?.inputModalities).toContain("text");
    expect(r?.capabilities?.inputModalities).toContain("image");
  });

  it("不根据模型名猜测能力（避免传图后被 provider 拒绝）", () => {
    // 名字里带 "vision" 但没有能力字段时，不得推断出图片支持
    const r = detectModel({ id: "some-vision-model-v2", object: "model" });
    expect(r?.capabilities).toBeUndefined();
  });
});
