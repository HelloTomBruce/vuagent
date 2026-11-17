/** VaCapabilityCard 的类型定义 */

export interface CapabilityCardProps {
  /** 级别徽标数字（L0–L4） */
  level: number;
  /** 级别名，如「工具调用」 */
  name: string;
  /** 卡片主标题（默认 `${name} 已启用`） */
  title?: string;
  /** 一句话描述该级别引入了什么 */
  description?: string;
  /** 本级别引入的协议事件（如 tool.start / tool.end） */
  events?: string[];
  /** 本级别涉及到的组件名 */
  components?: string[];
  /** 底部提示（如「试试：让 agent 读一个文件」） */
  hint?: string;
  /** 可关闭 */
  dismissible?: boolean;
}

export interface CapabilityCardEvents {
  dismiss: [];
}
