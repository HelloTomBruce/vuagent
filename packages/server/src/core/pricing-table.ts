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
 * 缓存读取按 cacheRate（缺省 input*0.5）、推理 token 按 reasoningRate（缺省 output）分档。
 */
export function computeCostUsd(
  pricing: ModelPricing,
  promptTokens: number,
  completionTokens: number,
  options?: { cachedPromptTokens?: number; reasoningTokens?: number }
): number {
  const cachedTokens = Math.min(promptTokens, Math.max(0, options?.cachedPromptTokens ?? 0));
  const regularPromptTokens = Math.max(0, promptTokens - cachedTokens);
  // TASK-060 O4：可选费率字段（cacheRead/reasoning）不做非数字即 NaN——
  // loader 只校验 input/output 为 number，可选费率混入字符串/NaN 时
  // `??` 不触发（仅拦 null/undefined），算术产出 NaN 账本。此处按字段缺省
  // 推导语义兜底：非法值回落缺省费率（cacheRead→input*0.5，reasoning→output）。
  const defaultCacheRate = pricing.input * 0.5;
  const defaultReasoningRate = pricing.output;
  const asFiniteRate = (v: number | undefined, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
  const cacheRate = asFiniteRate(pricing.cacheRead, defaultCacheRate);
  const reasoningRate = asFiniteRate(pricing.reasoning, defaultReasoningRate);

  const reasoningTokens = Math.min(completionTokens, Math.max(0, options?.reasoningTokens ?? 0));
  const regularOutputTokens = Math.max(0, completionTokens - reasoningTokens);

  const usd =
    (regularPromptTokens / 1e6) * pricing.input +
    (cachedTokens / 1e6) * cacheRate +
    (regularOutputTokens / 1e6) * pricing.output +
    (reasoningTokens / 1e6) * reasoningRate;

  return Number(usd.toFixed(6));
}
