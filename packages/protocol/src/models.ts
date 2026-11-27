/**
 * 模型配置的共享契约（provider / model / 能力元数据）
 *
 * 这些类型跨越 HTTP 边界：服务端持久化、前端渲染共用同一份定义。
 * 之前两侧各写一份 ModelCapabilities，容易出现字段漂移——收敛到 protocol 包后
 * 由 `pnpm protocol:sync-check` 统一守护。
 */
import { PROVIDER_PRESETS_IDS, type ProviderId } from "./providers.js";

/**
 * 供应商类型（决定默认 baseUrl 与协议路由）。
 *
 * 唯一事实源是 `providers.ts` 的预设表：加一个供应商 = 加一条 preset，下拉、默认端点、
 * 域名规则同时跟上（此前三处各写一份，必然漂移）。
 *
 * 类型是**字面量联合**（由 `providers.ts` 的 id 元组派生），穷尽性检查因此保持有效；
 * 旧库里的历史 id 由 `providerPreset()` 的 custom 兜底承接，不会被类型或运行时拒绝。
 */
export type ProviderKind = ProviderId;

/** 运行时枚举：用于入参校验，避免把任意字符串当 provider 落库 */
export const PROVIDER_KINDS: readonly ProviderKind[] = PROVIDER_PRESETS_IDS;

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && (PROVIDER_KINDS as readonly string[]).includes(value);
}

/** 模型输入模态：决定附件入口是否可用 */
export type InputModality = "text" | "image" | "audio" | "video" | "pdf";

/** 能力元数据来源；缺失时对用户诚实标注，避免"假装知道" */
export type CapabilitySource = "declared" | "detected" | "catalog" | "heuristic";

/**
 * 模型能力元数据。
 *
 * 口径参照 OpenRouter / models.dev 的事实标准：
 *   - 输入模态用数组而非 supportsVision 布尔位，新增模态不必改 schema
 *   - supportedParameters 用集合表达"该模型接受哪些请求参数"
 *   - reasoning 三段式：是否支持 → 支持哪些档位 → 默认档位
 */
export interface ModelCapabilities {
  /** 生效上下文窗口（token） */
  contextWindow?: number;
  /** 最大输出 token */
  maxOutputTokens?: number;
  /** 输入模态，如 ["text","image"] */
  inputModalities?: InputModality[];
  /** 该模型接受的请求参数名集合，如 ["tools","temperature","reasoning_effort"] */
  supportedParameters?: string[];
  /** 推理能力三段式 */
  reasoning?: {
    supported: boolean;
    supportedEfforts?: string[];
    defaultEffort?: string;
  };
  /** 以上元数据的来源；缺省视为未声明 */
  source?: CapabilitySource;
}

/** 供应商（端点 + 凭证）1:N 挂载模型的共享形态 */
export interface ModelParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown;
}
