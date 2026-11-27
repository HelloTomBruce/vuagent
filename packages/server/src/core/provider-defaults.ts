/**
 * 供应商 → 默认端点 / 协议 / 鉴权形态的解析。
 *
 * 事实源是 `@vuagent/protocol` 的 `PROVIDER_PRESETS`（全仓一张表）。此文件只做
 * 「id → 预设」的解析与端点相关判断，不再自己维护映射表：此前 agent-loop、供应商
 * discover 路由、console 下拉各写一份，漂移的后果是「选了 A 却打到 B 端点」或
 * 「anthropic 的 x-api-key 打在 OpenAI 端点上」。
 */
import {
  PROVIDER_PRESETS,
  providerPreset,
  type ProviderPreset,
  type ProviderProtocol,
} from "@vuagent/protocol";

/** 「anthropic 协议」预设的域名集合（MiniMax 这类兼容网关也走 x-api-key） */
const ANTHROPIC_HOSTS: ReadonlySet<string> = new Set(
  PROVIDER_PRESETS.filter((p) => p.protocol === "anthropic" && p.domain).map((p) => p.domain as string),
);

/** 取默认端点；未知 id 回落 custom 档，绝不抛错 */
export function defaultBaseUrlFor(kind: string): string {
  return providerPreset(kind).baseUrl;
}

/** 取协议族（决定走哪个 driver） */
export function protocolFor(kind: string): ProviderProtocol {
  return providerPreset(kind).protocol;
}

/** 取完整预设（调用方需要 note / keyEnv / suggestedModel 时用） */
export function presetFor(kind: string): ProviderPreset {
  return providerPreset(kind);
}

/**
 * 是否 Anthropic 原生端点（决定鉴权头用 x-api-key 还是 Bearer）。
 * 判定依据是「host 是否属于 anthropic 协议的预设域名」，而非硬编码单个域名。
 */
export function isAnthropicNativeEndpoint(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return false;
  }
  return host === "api.anthropic.com" || ANTHROPIC_HOSTS.has(host);
}
