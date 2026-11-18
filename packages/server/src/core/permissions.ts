/**
 * 权限模式解析（TASK-014 抽取为独立纯函数模块）
 *
 * 背景：生效权限模式此前在 agent-loop 的工具调用循环内联计算，
 * 系统提示词无法声明「当前是什么模式」（对比 Codex 显式注入沙箱模式）。
 * 抽取为共享纯函数后，**提示词声明的模式与工具仲裁强制执行的模式同源**，
 * 二者不可能再出现口径漂移。
 */

export type EffectivePermissionMode = "auto" | "review" | "read-only";

/** 严重度：数值越大越严格 */
const PERMISSION_RANK: Record<string, number> = {
  auto: 1,
  review: 2,
  "read-only": 3,
  readonly: 3, // 别名兼容
};

const RANK_TO_MODE: readonly EffectivePermissionMode[] = ["auto", "review", "read-only"];

/**
 * 解析请求级与会话级权限的交集（更严者生效）。
 *
 * - 请求未声明时默认 review（Harness 默认形态：高风险工具走 HITL 审批）
 * - 会话未声明（undefined/空串）时不参与交集，仅请求级约束生效
 * - 未识别的字符串按 review 处理（安全降级，而非放行）
 *
 * 注意：工作区级硬闸门（read-only 工作区在任何模式含 auto 下拦写工具）
 * 不在此函数内——它由 agent-loop 依据 workspace.permission 单独判定，
 * 系统提示词中会一并声明。
 */
export function resolveEffectivePermissionMode(
  reqPermission?: string,
  sessionPermission?: string
): EffectivePermissionMode {
  const reqRank = PERMISSION_RANK[reqPermission || "review"] ?? PERMISSION_RANK.review;
  const trimmed = sessionPermission?.trim();
  const sessionRank = trimmed
    ? (PERMISSION_RANK[trimmed] ?? PERMISSION_RANK.review)
    : reqRank;
  return RANK_TO_MODE[Math.max(reqRank, sessionRank) - 1];
}

/**
 * 运行中实时解析生效权限模式（用户输出中途改档场景）。
 *
 * - 会话档与轮次开始时一致 → 用户未改动，维持轮次起点解析结果（请求级∩会话级）
 * - 会话档已变化 → UI 在改档时已把最新选择 PATCH 进会话（前端 onSelectPermission），
 *   以最新会话档为准（不再与请求级旧值取交集：请求级是发送时刻的快照，已过时；
 *   用户显式改档是最新意图，收紧与放宽都应生效）
 *
 * 系统提示词中的模式声明仍为轮次起点口径（本轮上下文不回写），
 * 工具仲裁自本函数起逐调用实时解析——改档对「后续工具调用」立即可感知。
 */
export function resolveLivePermissionMode(
  turnStartMode: EffectivePermissionMode,
  sessionPermissionAtStart: string | undefined,
  currentSessionPermission: string | undefined
): EffectivePermissionMode {
  const start = sessionPermissionAtStart?.trim() ?? "";
  const current = currentSessionPermission?.trim() ?? "";
  if (start === current) return turnStartMode;
  // 会话档已变化 → 最新档完全生效（收紧与放宽都成立）。
  // 注意不能走 resolveEffectivePermissionMode(undefined, current)：请求级缺省按 review
  // 处理，会把放宽（如 review→auto）重新压回 review。此处 current 同时充当请求级
  // 与会话级，等价于「会话档即唯一事实」，未识别值仍安全降级为 review。
  return resolveEffectivePermissionMode(current, current);
}

/**
 * 各模式的人类可读语义说明（供系统提示词声明，保持单处事实来源）
 */
export const PERMISSION_MODE_DESCRIPTIONS: Record<EffectivePermissionMode, string> = {
  auto: "auto —— 工具自主执行，不经过人工审批（工作区级只读闸门仍然生效）",
  review: "review —— 高风险或声明需审批的工具在执行前挂起，等待人工批准或驳回",
  "read-only": "read-only —— 一切会写工作区的工具（写文件、执行命令等）一律拦截，只允许只读操作",
};
