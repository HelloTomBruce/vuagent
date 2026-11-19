/**
 * Console 领域模型与静态配置
 * 流事件契约统一来自 @vuagent/protocol（TASK-002），此处 re-export 供 console 模块便捷引用。
 */
import type { HarnessStreamEvent } from "@vuagent/protocol";
import type { PlanStep, TrajEvent } from "@vuagent/ui";

export type { HarnessStreamEvent, PlanStep, TrajEvent };

export interface WorkspaceItem {
  id: string;
  name: string;
  rootPath: string;
  permission: "read-only" | "read-write" | "danger";
  createdAt: number;
  updatedAt: number;
}

export interface SessionItem {
  id: string;
  workspaceId: string;
  title: string;
  status: "active" | "archived";
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
  activeModelProfileId?: string;
  /** 本会话绑定的权限模式（review | auto | readonly），随会话持久化 */
  permission?: string;
  /** 已置顶（列表排序由前端负责：置顶会话浮到分组最前） */
  pinned?: boolean;
  isRunning?: boolean;
  turns?: any[];
}

export interface ModelProfileItem {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  /** 服务端脱敏回显的掩码（保留末 4 位）；明文 apiKey 不再返回前端（TASK-011） */
  maskedApiKey?: string;
  contextWindow?: number;
  temperature?: number;
  isDefault?: boolean;
}

export interface ActionCard {
  id: string;
  type:
    | "approval"
    | "diff"
    | "terminal"
    | "metric"
    | "checkpoint"
    | "tree"
    | "trajectory"
    /** 工具调用链卡片（tool_call_start → args_delta → executing → result 全生命周期） */
    | "toolcall"
    /** ui_* 契约工具持久化卡：{component, props} 原始载荷，CardRenderer 按组件名动态分发 */
    | "ui";
  data: any;
}

/**
 * 消息输出时序块（plan.md 设计的混排模型落地）
 * 文本与卡片按真实输出顺序交错，卡片不再固定堆在正文末尾
 */
export type TurnBlock =
  | { kind: "text"; content: string }
  | { kind: "card"; cardId: string };

export interface MessageTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  thought?: string;
  thoughtExpanded?: boolean;
  thoughtDuration?: number;
  isStreaming?: boolean;
  cards?: ActionCard[];
  /** 输出时序块（live 由 reducer 增量构建；历史按 contentOffset 重建）。缺省时视图回退 content+cards 两段式 */
  blocks?: TurnBlock[];
  checkpointId?: string;
  /** TASK-054：中止控制事件（aborted）到达时记录成因，视图渲染中止徽标而非假正文 */
  abortedReason?: string;
  /** TASK-054：最近一次事件的广播序号（seq 寻址，增量重连去重备用） */
  lastSeq?: number;
  /** 三泳道轨迹事件（对齐 dsh：运行中实时追加，历史由 turn.telemetry.events 恢复） */
  trajEvents?: TrajEvent[];
  timestamp: number;
}

/* ==========================================================================
   静态配置
   ========================================================================== */

export interface ModelOption {
  id: string;
  label: string;
  meta: string;
  /** 模型声明的上下文窗口大小，供 Context 仪表上限展示 */
  contextWindow?: number;
}

/** 模型配置为空时的兜底展示列表（与原 Console.vue 保持一致） */
export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "deepseek-v3", label: "DeepSeek V3", meta: "DeepSeek 官方推理API" },
  { id: "qwen-2.5-72b", label: "Qwen 2.5 72B", meta: "阿里云通义旗舰" },
  { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet", meta: "Anthropic 旗舰编排" },
  { id: "ollama-local", label: "Ollama (Local)", meta: "本地部署模型" },
];

export interface PermissionMode {
  id: string;
  label: string;
  desc: string;
}

export const PERMISSION_MODES: PermissionMode[] = [
  { id: "review", label: "严格审批 (Review)", desc: "写文件、命令执行等需人工确认" },
  { id: "auto", label: "自动执行 (Auto)", desc: "工具沙箱全自动运行" },
  { id: "readonly", label: "只读沙箱 (Read-Only)", desc: "禁止一切写入与执行操作" },
];

export interface ProviderPreset {
  name: string;
  model: string;
  baseUrl: string;
  contextWindow: number;
}

/** 新建模型配置时按 provider 预填（与原 onProviderChange switch 分支一致） */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    name: "DeepSeek V3",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com/v1",
    contextWindow: 128000,
  },
  anthropic: {
    name: "Claude 3.7 Sonnet",
    model: "claude-3-7-sonnet-20250219",
    baseUrl: "https://api.anthropic.com/v1",
    contextWindow: 200000,
  },
  openai: {
    name: "OpenAI GPT-4o",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128000,
  },
  ollama: {
    name: "Ollama 本地模型",
    model: "qwen2.5-coder:7b",
    baseUrl: "http://localhost:11434/v1",
    contextWindow: 32000,
  },
  custom: {
    name: "兼容模型 (Custom)",
    model: "custom-model",
    baseUrl: "http://localhost:8000/v1",
    contextWindow: 32000,
  },
  qwen: {
    name: "Qwen 通义千问",
    model: "qwen-max",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    contextWindow: 128000,
  },
};

/**
 * 供应商下拉选项（PROVIDER_OPTIONS 的 value 必须都是 PROVIDER_PRESETS 的键——
 * 新建模型选 provider 时会按 preset 预填，缺键会 TypeError）。
 * label 为 UI 显示名，与 preset.name（模型预填名）是两个概念，刻意分开维护。
 */
export const PROVIDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "deepseek", label: "DeepSeek (官方 API)" },
  { value: "qwen", label: "Qwen / 阿里云通义千问" },
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT-4o/o3)" },
  { value: "ollama", label: "Ollama (本地运行)" },
  { value: "custom", label: "Custom (OpenAI 兼容接口)" },
];

export const DEFAULT_MODEL_FORM: ModelProfileItem = {
  id: "",
  name: "",
  provider: "deepseek",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  contextWindow: 128000,
  temperature: 0.2,
  isDefault: false,
};
