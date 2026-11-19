/**
 * @vuagent/protocol
 * Agent 组件生命周期与消息块状态模型
 *
 * 归属裁决（TASK-056）：本文件是 @vuagent/ui runtime 的契约事实来源——
 * ui 以 npm 包分发必须自包含，类型经 vendored 副本
 * （packages/ui/src/runtime/protocol-types.ts）随包分发，同步由
 * scripts/check-protocol-sync.mjs CI 卡口机械把关（人工不再改 ui 侧副本）。
 * 注意：playground/console 不直接消费本文件（其 turn/block 模型为
 * reducer 内部实现类型），勿在此追加仅服务 ui runtime 的形状。
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
