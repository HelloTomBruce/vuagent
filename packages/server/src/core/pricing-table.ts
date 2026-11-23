import fs from "node:fs";
import path from "node:path";

/**
 * 模型计价表（TASK-052，语义参照 harness-core finops/costLedger）：
 * config/model-pricing.json 用户维护，零硬编码；mtime 热加载免重启；
 * 模型名最长前缀匹配（同 ModelCatalog 窗口表语义）；
 * 未命中 = 只记量不记钱，不阻塞任何主链路。
 */

/** 模型单价：USD / 1M tokens（支持标准/缓存/推理分档计价） */
export interface ModelPricing {
  input: number;
  output: number;
  /** Prompt Cache 命中读取单价；缺省按 input * 0.5 计算 */
  cacheRead?: number;
  /** Prompt Cache 写入单价（Anthropic cache_creation）；缺省按 input 计算 */
  cacheWrite?: number;
  /** 思考/推理 token 单价；缺省按 output 计算 */
  reasoning?: number;
}

/** 缺省计价文件路径：`${cwd}/config/model-pricing.json` */
export const PRICING_PATH_DEFAULT = path.join(process.cwd(), "config", "model-pricing.json");

/** 记账入参（agent-loop turn 收尾产出；costUsd 由 server 侧计价表闭包补齐） */
export interface CostRecordInput {
  turnId: string;
  sessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  finishedAt: number;
  /** 思考/推理 token 累计（分档计价；端点不提供时缺省，按整段 output 价计） */
  reasoningTokens?: number;
  /** Prompt Cache 命中读取累计（分档计价；端点不提供时缺省） */
  cachedTokens?: number;
  /** Prompt Cache 写入累计（Anthropic cache_creation；端点不提供时缺省，按整段 input 价计） */
  cacheCreationTokens?: number;
}

/** 记账器契约：实现方负责持久化与计价；失败由调用方 fail-open 捕获 */
export type CostRecorder = (entry: CostRecordInput) => Promise<void>;

export class ModelPricingTable {
  readonly #configPath?: string;
  #staticTable?: Record<string, ModelPricing>;
  #cache: Record<string, ModelPricing> | null = null;
  #mtimeMs = -1;

  constructor(configOrPath?: string | Record<string, ModelPricing>) {
    if (configOrPath === undefined) {
      this.#configPath = PRICING_PATH_DEFAULT;
    } else if (typeof configOrPath === "string") {
      this.#configPath = configOrPath;
    } else {
      this.#staticTable = { ...configOrPath };
    }
  }

  /** 文件 mtime 变化时重载（改 config 无需重启进程）；读失败静默清空缓存 */
  reloadIfChanged(): void {
    if (this.#staticTable || !this.#configPath) return;
    try {
      const stat = fs.statSync(this.#configPath);
      if (stat.mtimeMs === this.#mtimeMs) return;
      this.#mtimeMs = stat.mtimeMs;
      const parsed: unknown = JSON.parse(fs.readFileSync(this.#configPath, "utf-8"));
      if (!parsed || typeof parsed !== "object") {
        this.#cache = null;
        return;
      }
      const entries: Record<string, ModelPricing> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (
          value &&
          typeof value === "object" &&
          typeof (value as ModelPricing).input === "number" &&
          typeof (value as ModelPricing).output === "number"
        ) {
          entries[key] = value as ModelPricing;
        }
      }
      this.#cache = entries;
    } catch {
      // 文件缺失/非法 JSON：只记量不记钱
      this.#cache = null;
      this.#mtimeMs = -1;
    }
  }

  /** 最长前缀匹配；未命中返回 undefined */
  priceFor(model: string): ModelPricing | undefined {
    const table = this.#resolveTable();
    if (!table) return undefined;
    const lower = model.toLowerCase();
    let best: string | undefined;
    for (const key of Object.keys(table)) {
      if (lower.startsWith(key.toLowerCase()) && (best === undefined || key.length > best.length)) {
        best = key;
      }
    }
    return best === undefined ? undefined : table[best];
  }

  #resolveTable(): Record<string, ModelPricing> | null {
    if (this.#staticTable) return this.#staticTable;
    this.reloadIfChanged();
    return this.#cache;
  }
}

/**
 * USD 计价：6 位小数（微美元级），避免浮点累加误差进账本。
 * 缓存读取按 cacheRate（缺省 input*0.5）、缓存写入按 cacheWriteRate（缺省 input）、
 * 推理 token 按 reasoningRate（缺省 output）分档。
 *
 * 口径约定（TASK-079）：promptTokens 为总输入（OpenAI 语义），cached/cacheCreation
 * 是其中的子集——各驱动已统一为该语义（Anthropic 驱动把并列上报的 cache_read /
 * cache_creation 加回 input_tokens），这里按子集扣减拆出常规段。
 */
export function computeCostUsd(
  pricing: ModelPricing,
  promptTokens: number,
  completionTokens: number,
  options?: { cachedPromptTokens?: number; cacheCreationTokens?: number; reasoningTokens?: number }
): number {
  const cachedTokens = Math.min(promptTokens, Math.max(0, options?.cachedPromptTokens ?? 0));
  // 写入段从「总输入减读取」的余量里钳取，防端点脏数据把常规段扣成负数
  const cacheWriteTokens = Math.min(
    Math.max(0, promptTokens - cachedTokens),
    Math.max(0, options?.cacheCreationTokens ?? 0)
  );
  const regularPromptTokens = Math.max(0, promptTokens - cachedTokens - cacheWriteTokens);
  // TASK-060 O4：可选费率字段（cacheRead/cacheWrite/reasoning）不做非数字即 NaN——
  // loader 只校验 input/output 为 number，可选费率混入字符串/NaN 时
  // `??` 不触发（仅拦 null/undefined），算术产出 NaN 账本。此处按字段缺省
  // 推导语义兜底：非法值回落缺省费率（cacheRead→input*0.5，cacheWrite→input，reasoning→output）。
  const defaultCacheRate = pricing.input * 0.5;
  const defaultReasoningRate = pricing.output;
  const asFiniteRate = (v: number | undefined, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  const cacheRate = asFiniteRate(pricing.cacheRead, defaultCacheRate);
  const cacheWriteRate = asFiniteRate(pricing.cacheWrite, pricing.input);
  const reasoningRate = asFiniteRate(pricing.reasoning, defaultReasoningRate);

  const reasoningTokens = Math.min(completionTokens, Math.max(0, options?.reasoningTokens ?? 0));
  const regularOutputTokens = Math.max(0, completionTokens - reasoningTokens);

  const usd =
    (regularPromptTokens / 1e6) * pricing.input +
    (cachedTokens / 1e6) * cacheRate +
    (cacheWriteTokens / 1e6) * cacheWriteRate +
    (regularOutputTokens / 1e6) * pricing.output +
    (reasoningTokens / 1e6) * reasoningRate;

  return Number(usd.toFixed(6));
}
