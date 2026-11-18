/** VaAgentChat 的类型定义 */

export interface ChatThreadMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** ms 时间戳 */
  createdAt?: number;
  /** agent 消息附带的工具调用名列表（chips 展示） */
  tools?: string[];
}

/**
 * @deprecated 与 runtime（useAgentChat）的 ChatMessage 同名冲突，已更名为 ChatThreadMessage；
 * 旧别名保留一个版本，下个大版本移除。
 */
export type ChatMessage = ChatThreadMessage;

export interface AgentChatProps {
  messages: ChatThreadMessage[];
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
