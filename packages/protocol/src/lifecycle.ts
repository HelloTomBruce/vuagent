/**
 * @vuagent/protocol
 * Agent 组件生命周期与消息块状态模型
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
