/**
 * 能力角标：把 ModelCapabilities 翻译成用户一眼能懂的短标签。
 *
 * 单一事实源——设置面板的模型清单、拉取列表、Composer 都从这里取，
 * 避免同一套映射写两遍（review 发现过 composable 与 panel 各有一份）。
 */
import type { ModelCapabilities, InputModality } from "../types";

const MODALITY_LABEL: Record<InputModality, string> = {
  text: "文本",
  image: "图片",
  audio: "音频",
  video: "视频",
  pdf: "PDF",
};

/** 上下文窗口的紧凑表示：1024000 → 1024K；小于 1000 原样输出 */
function formatContext(window: number): string {
  return window >= 1000 ? `${Math.round(window / 1000)}K` : String(window);
}

export interface CapabilityBadgeInput {
  capabilities?: ModelCapabilities;
  /** 兼容既有扁平字段（capabilities.contextWindow 缺失时的兜底） */
  contextWindow?: number;
}

/**
 * @param input 能力元数据，或直接给 capabilities
 * @param options.includeText 是否输出「文本」角标（默认不输出，几乎所有模型都有）
 */
export function capabilityBadges(
  input: CapabilityBadgeInput | ModelCapabilities | undefined,
  options: { includeText?: boolean } = {}
): string[] {
  if (!input) return [];

  // 两种入参形态归一：{capabilities, contextWindow} 或直接 capabilities
  const cap: ModelCapabilities =
    "capabilities" in input || "contextWindow" in input
      ? ((input as CapabilityBadgeInput).capabilities ?? {})
      : (input as ModelCapabilities);
  const flatWindow =
    "contextWindow" in input && typeof (input as CapabilityBadgeInput).contextWindow === "number"
      ? (input as CapabilityBadgeInput).contextWindow
      : undefined;

  const badges: string[] = [];

  const ctx = cap.contextWindow || flatWindow;
  if (ctx) badges.push(formatContext(ctx));

  for (const mod of cap.inputModalities || []) {
    if (mod === "text" && !options.includeText) continue;
    badges.push(MODALITY_LABEL[mod] ?? mod);
  }

  if (cap.reasoning?.supported) badges.push("推理");
  if (cap.supportedParameters?.includes("tools")) badges.push("工具");

  return badges;
}
