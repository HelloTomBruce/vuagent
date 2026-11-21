/**
 * Provider 类型 → 默认 baseUrl 的服务端唯一事实源。
 *
 * 此前 agent-loop 与供应商 discover 路由各写了一份
 * `ollama ? localhost : api.openai.com` 三元，两处漂移后 anthropic/deepseek/qwen
 * 未显式配置端点时全部兜到 OpenAI，anthropic 的原生协议头（x-api-key）
 * 永远打在错误端点上（review 发现）。收敛成完整映射，新增供应商类型只改这里。
 *
 * custom / 未知类型沿用 OpenAI 端点（保持既有行为：配 custom 通常意味着
 * 显式填 baseUrl，兜底值几乎不会被用到）。
 */
import type { ProviderKind } from "@vuagent/protocol";

export const PROVIDER_DEFAULT_BASE_URL: Record<ProviderKind, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ollama: "http://localhost:11434/v1",
  custom: "https://api.openai.com/v1",
};

/** 取默认端点；未知类型回落 custom 档，绝不抛错 */
export function defaultBaseUrlFor(kind: string): string {
  return PROVIDER_DEFAULT_BASE_URL[kind as ProviderKind] ?? PROVIDER_DEFAULT_BASE_URL.custom;
}

/** 是否 Anthropic 官方原生端点（决定鉴权头用 x-api-key 还是 Bearer） */
export function isAnthropicNativeEndpoint(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.host === "api.anthropic.com";
  } catch {
    return false;
  }
}
