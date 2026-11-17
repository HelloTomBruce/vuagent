/**
 * @vuagent/protocol
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

/**
 * 常见事件类型守卫
 */
export function isTextDeltaEvent(event: UIStreamEvent): event is Extract<UIStreamEvent, { type: "text_delta" }> {
  return event.type === "text_delta";
}

export function isComponentEvent(
  event: UIStreamEvent
): event is Extract<
  UIStreamEvent,
  { type: "component_start" | "component_args_delta" | "component_executing" | "component_ready" }
> {
  return (
    event.type === "component_start" ||
    event.type === "component_args_delta" ||
    event.type === "component_executing" ||
    event.type === "component_ready"
  );
}
