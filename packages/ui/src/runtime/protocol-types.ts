/**
 * 内联自 @vuagent/protocol 的类型定义（vendored）。
 *
 * 为什么内联：@vuagent/ui 以 npm 包分发（dist 产物），运行时 JS 已将这些
 * 契约仅作类型使用（bundle 自包含，仅外部依赖 vue）；若保留对
 * @vuagent/protocol 的依赖声明，发布后宿主会解析到一个 npm 上不存在的
 * workspace 包，导致 `npm i @vuagent/ui` 直接失败。内联类型让发布包
 * 零外部依赖（peer 仅 vue），契约语义与 @vuagent/protocol 保持一致，
 * 两端类型演进时需人工同步（见 packages/protocol/src/lifecycle.ts / events.ts）。
 */

/**
 * Agent 组件的四态生命周期：
 * 1. streaming: 大模型正在流式输出参数（可能是不完整 Partial 对象）
 * 2. executing: 参数已完整，正在后台执行或等待人工审批交互（挂起中）
 * 3. done: 执行完毕或审批已完成，呈现最终回执状态
 * 4. error: 执行失败或被超时拒绝
 */
export type AgentComponentStatus = "streaming" | "executing" | "done" | "error";

/**
 * 所有 Agent UI 组件的标准输入 Props 接口
 */
export interface AgentComponentBaseProps<TArgs = Record<string, any>, TResult = any> {
  toolCallId: string;
  componentName: string;
  status: AgentComponentStatus;
  args: Partial<TArgs>;
  result?: TResult;
  error?: string;
  /**
   * 交互类组件向服务端（或 ActionHub）提交决策或表单数据的回调
   */
  onSubmitAction?: (payload: any) => Promise<void> | void;
  /**
   * 是否只读模式（历史记录查看或禁用交互）
   */
  readonly?: boolean;
}

/**
 * 混排消息块结构（用于构建前端流式对话树）
 */
export type MessageBlock =
  | {
      id: string;
      kind: "text";
      content: string;
    }
  | {
      id: string;
      kind: "component";
      toolCallId: string;
      componentName: string;
      status: AgentComponentStatus;
      args: Record<string, any>;
      result?: any;
      error?: string;
    };

/**
 * 前端 UI 消费的归一化流式事件协议 (UIStreamEvent)
 */
export type UIStreamEvent =
  /**
   * 文本流式增量：助手普通的流式文字回复
   */
  | {
      type: "text_delta";
      messageId: string;
      delta: string;
    }
  /**
   * 组件生命周期开始：大模型发起某 UI 工具调用
   */
  | {
      type: "component_start";
      messageId: string;
      toolCallId: string;
      componentName: string;
    }
  /**
   * 组件参数流式增量：大模型吐出的半截 JSON 被服务端或前端容错解析出的局部 Props
   */
  | {
      type: "component_args_delta";
      toolCallId: string;
      partialArgs: Record<string, any>;
    }
  /**
   * 组件执行/交互就绪阶段：参数已生成完毕
   * 对于 HITL 交互类组件，此事件代表已进入等待人工交互的挂起态
   */
  | {
      type: "component_executing";
      toolCallId: string;
      componentName?: string;
      args: Record<string, any>;
    }
  /**
   * 组件完成态：工具执行完成或用户已提交人工交互，或发生错误
   */
  | {
      type: "component_ready";
      toolCallId: string;
      componentName?: string;
      status: "done" | "error";
      data?: any;
      error?: string;
    }
  /**
   * 本轮对话流式生成完毕
   */
  | {
      type: "turn_end";
    }
  /**
   * 对话或通道级异常
   */
  | {
      type: "error";
      code?: string;
      message: string;
    };
