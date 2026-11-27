/**
 * 模型驱动的**协议路由**（0.7.2 评审 C1）。
 *
 * 此前路由条件写在 agent-loop 闭包里：`provider === "anthropic" && !baseUrl`。
 * 供应商从 6 家扩到 24 家之后这个条件就错了——MiniMax 是 **Anthropic 协议的兼容网关**
 * （预设 `protocol: "anthropic"` 且带 baseUrl），旧条件把它路由到 OpenAI 兼容驱动，
 * 于是把 OpenAI 格式的 payload 发到 Anthropic 端点，第一次选它就会 400。
 *
 * 现在路由只认**协议**（预设表里声明的 `protocol`），不再猜 provider id：
 *   - `anthropic` → AnthropicDriver（端点取 profile.baseUrl，缺省官方端点）
 *   - 其余（openai / azure / gemini / native）→ OpenAICompatibleDriver
 *
 * 行为变化（有意）：`provider = "anthropic"` + 显式 baseUrl 的旧档案，以前被当成
 * OpenAI 兼容网关，现在会走 Anthropic 协议——因为该 provider 的语义就是 Anthropic。
 * 想接 OpenAI 兼容中转请选 `custom` / `openai` 预设。
 *
 * 抽成独立文件的目的：可被单测直接覆盖（此前该分支只能靠集成测试间接摸到）。
 */
import { AnthropicDriver, type AnthropicDriverOptions } from "../adapters/anthropic-driver.js";
import { OpenAICompatibleDriver, type OpenAIDriverOptions } from "../adapters/openai-driver.js";
import type { IModelDriver } from "../adapters/model-driver.js";
import type { ModelProfileEntity } from "../storage/interfaces.js";
import { defaultBaseUrlFor, protocolFor, presetFor } from "./provider-defaults.js";

export interface BuildDriverOptions {
  /** 宿主/测试注入的驱动优先于一切（保持既有语义） */
  injected?: IModelDriver;
  /** 测试注入点：透传给具体驱动的 fetch */
  fetchImpl?: typeof fetch;
  /** 重试遥测接缝（TASK-051） */
  onRetry?: OpenAIDriverOptions["onRetry"];
  /** prompt caching 档位求值（TASK-099）；函数形态逐请求求值 */
  promptCaching?: AnthropicDriverOptions["promptCaching"];
}

/** 该档案是否需要 API Key（本地无鉴权供应商如 Ollama / LM Studio 不需要） */
export function profileNeedsApiKey(profile: Pick<ModelProfileEntity, "provider">): boolean {
  return presetFor(profile.provider).authStyle !== "none";
}

/** 宿主的兜底密钥环境变量（按协议而非 id 选择） */
export function fallbackApiKeyEnv(profile: Pick<ModelProfileEntity, "provider">): string | undefined {
  const preset = presetFor(profile.provider);
  if (preset.authStyle === "none") return undefined;
  if (preset.protocol === "anthropic") return process.env.ANTHROPIC_API_KEY;
  return process.env.OPENAI_API_KEY;
}

/** 按档案构造驱动（协议路由的唯一入口） */
export function buildDriverForProfile(
  profile: ModelProfileEntity,
  options: BuildDriverOptions = {},
): IModelDriver {
  if (options.injected) return options.injected;

  const apiKey = profile.apiKey || fallbackApiKeyEnv(profile);
  const protocol = protocolFor(profile.provider);

  if (protocol === "anthropic") {
    return new AnthropicDriver(apiKey, profile.baseUrl || defaultBaseUrlFor(profile.provider), {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.promptCaching !== undefined ? { promptCaching: options.promptCaching } : {}),
    });
  }

  return new OpenAICompatibleDriver(apiKey, profile.baseUrl || defaultBaseUrlFor(profile.provider), {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.onRetry ? { onRetry: options.onRetry } : {}),
  });
}
