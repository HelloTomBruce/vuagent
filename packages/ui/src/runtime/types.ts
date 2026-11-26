/**
 * @vuagent/ui - Agent Runtime Types
 */

import type { Component } from "vue";
// 类型内联自 @vuagent/protocol（保持 npm 发布包自包含，见 ./protocol-types.ts 头注释）
import type {
  ActionMeta,
  AgentComponentBaseProps,
  AgentComponentStatus,
  MessageBlock,
  UIActionCancelEnvelope,
  UIActionEnvelope,
  UIActionKind,
  UIActionPatchEnvelope,
  UIActionSubmitEnvelope,
  UIComponentInteraction,
  UIInteractionLevel,
  UIStreamEvent,
} from "./protocol-types";

export type {
  ActionMeta,
  AgentComponentBaseProps,
  AgentComponentStatus,
  MessageBlock,
  UIActionCancelEnvelope,
  UIActionEnvelope,
  UIActionKind,
  UIActionPatchEnvelope,
  UIActionSubmitEnvelope,
  UIComponentInteraction,
  UIInteractionLevel,
  UIStreamEvent,
};

export interface CustomProviderConfig {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  protocol?: "openai-completions" | "openai-responses" | "anthropic";
}

export interface RegisteredComponentEntry<
  TArgs extends Record<string, any> = Record<string, any>,
  TResult = unknown,
  TPayload = unknown,
> {
  /** 实体组件（支持普通组件或 defineAsyncComponent） */
  component: Component;
  /** 骨架屏组件（流式加载阶段展示） */
  skeleton?: Component;
  /**
   * 是否支持渐进式渲染
   * true: 大模型流式输出参数时即渲染实体组件（Props 边吐边刷新）
   * false: 流式阶段优先展示 skeleton，待参数完整 (executing/done) 时再渲染实体组件
   */
  progressive?: boolean;
  /**
   * 交互能力声明（TASK-090，设计文档 §2 分级）：缺省视为 L0 纯展示。
   * 声明 L1/L2/L3 的组件才会在 executing 态获得可用的 onSubmitAction 通道；
   * L2/L3 的 resultSchema 驱动提交前本地预校验（server 边界复核仍是权威）。
   */
  interaction?: UIComponentInteraction;
  /**
   * 自定义适配器：将大模型生成的 args 转换为该组件特有的 props。
   * 注意：args 来自模型输出，必须视为不可信输入——各字段需做空值/类型兜底。
   */
  propAdapter?: (
    args: TArgs,
    ctx: {
      toolCallId: string;
      status: AgentComponentStatus;
      result?: TResult;
      onSubmitAction?: (payload: TPayload) => Promise<void> | void;
    }
  ) => Record<string, any>;
}

export interface AgentRendererProps<TResult = unknown, TPayload = unknown> {
  toolCallId: string;
  componentName: string;
  status: AgentComponentStatus;
  /** 模型输出的参数（流式阶段可能不完整；异常通道下可能为 null，渲染侧已做兜底） */
  args: Record<string, any> | null;
  result?: TResult;
  error?: string;
  apiBaseUrl?: string;
  readonly?: boolean;
  onSubmitAction?: (payload: TPayload) => Promise<void> | void;
}
