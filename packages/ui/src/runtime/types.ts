/**
 * @vuagent/ui - Agent Runtime Types
 */

import type { Component } from "vue";
// 类型内联自 @vuagent/protocol（保持 npm 发布包自包含，见 ./protocol-types.ts 头注释）
import type {
  AgentComponentBaseProps,
  AgentComponentStatus,
  MessageBlock,
  UIStreamEvent,
} from "./protocol-types";

export type {
  AgentComponentBaseProps,
  AgentComponentStatus,
  MessageBlock,
  UIStreamEvent,
};

export interface CustomProviderConfig {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  modelId?: string;
  protocol?: "openai-completions" | "openai-responses" | "anthropic";
}

export interface RegisteredComponentEntry {
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
   * 自定义适配器：将大模型生成的 args 转换为该组件特有的 props
   */
  propAdapter?: (
    args: Record<string, any>,
    ctx: {
      toolCallId: string;
      status: AgentComponentStatus;
      result?: any;
      onSubmitAction?: (payload: any) => Promise<void> | void;
    }
  ) => Record<string, any>;
}

export interface AgentRendererProps {
  toolCallId: string;
  componentName: string;
  status: AgentComponentStatus;
  args: Record<string, any>;
  result?: any;
  error?: string;
  apiBaseUrl?: string;
  readonly?: boolean;
  onSubmitAction?: (payload: any) => Promise<void> | void;
}
