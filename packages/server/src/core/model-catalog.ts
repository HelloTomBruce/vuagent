/**
 * 模型上下文窗口动态解析（模型目录查表 + 安全钳制）
 *
 * 背景：模型档案的 contextWindow 常缺失或填错（如把 o1 填 8k 导致过早压缩、
 * 把未知新模型填 2M 导致滑动窗口永不触发）。本模块提供三层解析：
 *   1. 档案显式值（>0 时最优先，仍钳制到安全区间）；
 *   2. 模型名前缀最长匹配查表（保守值：宁小勿大——过小只多压缩，过大即上下文溢出）；
 *   3. 未知模型回落 DEFAULT_CONTEXT_WINDOW。
 * 最终结果恒被钳制在 [CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX]。
 *
 * 查表口径：同一前缀家族取「最保守的常见档位」（如 gpt-4o 家族 128k、
 * claude 3+/4 家族 200k、gemini 1.5+/2.x 1M）。前缀匹配按表序优先长前缀。
 */

export const CONTEXT_WINDOW_MIN = 8_000;
export const CONTEXT_WINDOW_MAX = 2_000_000;
/** 未知模型兜底窗口（与原 agent-loop 硬编码口径一致） */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** 前缀 → 窗口（token）。匹配时按数组序（长前缀在前者优先） */
const MODEL_WINDOW_CATALOG: ReadonlyArray<readonly [string, number]> = [
  ["gpt-4.1", 1_000_000],
  ["gpt-4o", 128_000],
  ["gpt-4", 128_000],
  ["o1", 200_000],
  ["o3", 200_000],
  ["o4", 200_000],
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-4", 200_000],
  ["claude-3-7", 200_000],
  ["claude-3-5", 200_000],
  ["claude-3", 200_000],
  ["claude", 200_000],
  ["deepseek-reasoner", 64_000],
  ["deepseek-chat", 128_000],
  ["deepseek", 128_000],
  ["qwen3", 131_072],
  ["qwen-long", 1_000_000],
  ["qwen", 131_072],
  ["gemini-2", 1_000_000],
  ["gemini-1.5", 1_000_000],
  ["gemini", 128_000],
  ["moonshot", 128_000],
  ["kimi", 128_000],
  ["llama", 128_000],
  ["mistral", 128_000],
];

export interface ContextWindowInput {
  model: string;
  /** 模型档案声明的窗口（token）；缺失或非正数时走目录查表 */
  contextWindow?: number;
}

function clampWindow(window: number): number {
  return Math.min(Math.max(Math.floor(window), CONTEXT_WINDOW_MIN), CONTEXT_WINDOW_MAX);
}

/**
 * 解析生效上下文窗口（token）：档案显式值 > 前缀查表 > 默认兜底，恒钳制在安全区间。
 */
export function resolveContextWindow(input: ContextWindowInput): number {
  const declared = Number(input.contextWindow);
  if (Number.isFinite(declared) && declared > 0) {
    return clampWindow(declared);
  }
  const model = (input.model || "").toLowerCase();
  for (const [prefix, window] of MODEL_WINDOW_CATALOG) {
    if (model.startsWith(prefix)) {
      return clampWindow(window);
    }
  }
  return clampWindow(DEFAULT_CONTEXT_WINDOW);
}
