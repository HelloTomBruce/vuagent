/**
 * 统一设置弹窗共享类型与描述表（TASK-017）
 * 纯数据模块（不依赖 Vue 运行时）：左导航与交互设置项均表驱动，
 * 后续新增设置页 / 配置项只需扩展描述条目，组件无需改动。
 */
import type { InteractionSettings } from "../../composables/useInteractionSettings";

/** 设置弹窗左导航 tab 标识；新增设置页时扩展此联合类型 + SETTINGS_TABS */
export type SettingsTab =
  | "models"
  | "interaction"
  | "tools"
  | "execution"
  | "security"
  | "prompt";

/** 左导航条目描述 */
export interface SettingsTabDescriptor {
  id: SettingsTab;
  title: string;
  /** 导航项下的一句话说明 */
  description: string;
}

/** 设置弹窗左导航描述表（顺序即渲染顺序） */
export const SETTINGS_TABS: SettingsTabDescriptor[] = [
  { id: "models", title: "模型与 API", description: "供应商、模型与 API Key 配置" },
  { id: "interaction", title: "交互", description: "自动折叠等交互偏好" },
  { id: "tools", title: "工具", description: "内置工具的启用与停用" },
  { id: "execution", title: "执行", description: "步数上限、审批超时、上下文预算与成本配额" },
  { id: "security", title: "安全", description: "默认权限模式与网络边界" },
  { id: "prompt", title: "提示词", description: "系统提示组装块与全局自定义指令" },
];

/** 交互设置项描述条目：一行式 toggle（标题 + 一句话说明 + switch） */
export interface InteractionSettingItem {
  /** 对应 InteractionSettings 的字段 key */
  key: keyof InteractionSettings;
  title: string;
  description: string;
}

/** 交互设置项描述表（v1：TASK-015 的两个自动折叠开关；均开启时收进「已完成」摘要条） */
export const INTERACTION_SETTING_ITEMS: InteractionSettingItem[] = [
  {
    key: "autoCollapseThought",
    title: "自动折叠思考过程",
    description: "本轮输出结束后折叠思考过程；与下一项同时开启时收进「已完成」摘要条，点击可展开",
  },
  {
    key: "autoCollapseToolCards",
    title: "自动折叠工具执行卡片",
    description: "本轮输出结束后折叠工具调用；与上一项同时开启时收进「已完成」摘要条，只留文本结果；失败卡片始终展开",
  },
  {
    key: "showApprovals",
    title: "右侧边栏显示审批收件箱",
    description: "跨会话的人机协同 (HITL) 待审批决策；关闭后右侧边栏不再展示该分区",
  },
  {
    key: "showFileTree",
    title: "右侧边栏显示工作区文件树",
    description: "当前工作区的目录结构（只读预览，深度 4 层）；关闭后右侧边栏不再展示该分区",
  },
  {
    key: "showUsage",
    title: "右侧边栏显示成本用量面板",
    description: "滚动窗口/自定义区间的 token 与费用、按模型分解与配额水位（TASK-075）；关闭后右侧边栏不再展示该分区",
  },
];

/* ==========================================================================
   工具页（TASK-020）：与服务端 HarnessTool.riskLevel 同源的展示描述表
   ========================================================================== */

/** 工具风险等级（与 packages/server core/types.ts ToolRiskLevel 保持一致） */
export type ToolRiskLevel = "high" | "medium" | "low";

/** 风险徽标展示元数据：徽标文案与样式修饰类 */
export interface ToolRiskMeta {
  label: string;
  /** 附加在 .va-settings__tool-badge 上的修饰类（console.css） */
  className: string;
}

/** 风险等级 → 徽标描述表（未知等级回退 medium 行由消费方兜底） */
export const TOOL_RISK_META: Record<ToolRiskLevel, ToolRiskMeta> = {
  high: { label: "高风险", className: "va-settings__tool-badge--high" },
  medium: { label: "中风险", className: "va-settings__tool-badge--medium" },
  low: { label: "低风险", className: "va-settings__tool-badge--low" },
};

/** 徽标描述表兜底取值：服务端未知/新增等级时按中风险展示 */
export function toolRiskMetaOf(level: string): ToolRiskMeta {
  return TOOL_RISK_META[level as ToolRiskLevel] ?? TOOL_RISK_META.medium;
}
