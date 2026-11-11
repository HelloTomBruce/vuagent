/** VaAgentChat 的类型定义 */

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** ms 时间戳 */
  createdAt?: number;
  /** agent 消息附带的工具调用名列表（chips 展示） */
  tools?: string[];
}

export interface AgentChatProps {
  messages: ChatMessage[];
  /** agent 思考/生成中：消息流底部挂思考态 */
  thinking?: boolean;
  /** 思考文案（交给宿主传 ThinkingLoader 场景文案），默认"思考中…" */
  thinkingLabel?: string;
  /** 标题栏文案 */
  title?: string;
  /** 底部输入区换成具名插槽时隐藏内置占位 */
  composerless?: boolean;
  /** 消息区最大高度（缺省随容器滚动） */
  maxHeight?: number;
}

export interface AgentChatEvents {
  /** 底部发送（组件不含输入逻辑，宿主自行接 Composer） */
  scrollToBottom: [];
}
