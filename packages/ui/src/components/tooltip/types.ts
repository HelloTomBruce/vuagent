/** VaTooltip 的类型定义 */

import type { PopoverPlacement } from "../popover/types";

/** 提示方位：复用 Popover 方位枚举（top/bottom 带 start/end 对齐，left/right 仅居中），默认 top */
export type TooltipPlacement = PopoverPlacement;

/** 视觉变体：inverse = 深底白字（默认，随主题自动反转）；default = 卡片底描边 */
export type TooltipVariant = "default" | "inverse";

export interface TooltipProps {
  /**
   * 提示文案（a11y 必需——它是触发元素的 aria-describedby 目标内容）。
   * 复杂内容可用 #content 插槽覆盖；两者皆空时不显示（不渲染空气泡）。
   */
  content?: string;
  /** 初始方位（默认 top）；top/bottom 空间不足时自动翻转 */
  placement?: TooltipPlacement;
  /** hover/focus 后延迟打开 ms（默认 300，防掠过误闪） */
  delay?: number;
  /** 移出后延迟关闭 ms（默认 80，给指针回移留缓冲；Esc/外部点击立即关闭不走此延迟） */
  hideDelay?: number;
  /** 禁用：不再打开；打开中被置 true 会立即关闭 */
  disabled?: boolean;
  /** 提示泡最大宽度 px（默认 280） */
  maxWidth?: number;
  /** 视觉变体（默认 inverse：深底白字） */
  variant?: TooltipVariant;
}

export interface TooltipEvents {
  /** 提示实际显示（延迟结束后） */
  show: [];
  /** 提示关闭（含 Esc / 外部点击 / 延迟结束） */
  hide: [];
}

export interface TooltipSlots {
  /** 触发器（应当可聚焦，如 button——键盘 focusin 才会触发提示） */
  default?: () => unknown;
  /** 自定义提示内容（优先于 content prop） */
  content?: () => unknown;
}
