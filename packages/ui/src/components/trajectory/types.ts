/** VaTrajectory 的类型定义：对齐 dsh 轨迹形态 —— 三泳道时间线 + 扁平事件台账（G15） */

export type TrajLane = "input" | "model" | "tool";
export type TrajRole = "user" | "assistant" | "tool" | "system" | "context";

export interface TrajEvent {
  id: string;
  /** 开始时间戳 */
  at: number;
  /** 工具调用结束时间（泳道块宽度用） */
  endAt?: number;
  lane: TrajLane;
  role: TrajRole;
  /** 用户/助手：正文片段；工具：工具名 */
  title: string;
  /** 工具参数 JSON */
  detail?: string;
  /** 工具结果 / 错误 */
  result?: string;
  /** 第 N 轮（从 1，按用户消息切分） */
  turn: number;
}

export interface TrajStats {
  /** 首/末事件跨度 */
  durationMs: number;
  turns: number;
  calls: number;
  subcalls: number;
}

export interface TrajectoryProps {
  events: TrajEvent[];
  /** 台账区最大高度 px（默认none，随容器） */
  ledgerMaxHeight?: number;
  /** 是否渲染外层面板卡片（边框/底色）。宽幅主区嵌入时传 false 去卡片化；默认 true 保持原形态 */
  bordered?: boolean;
  /** 主从模式：点击台账行在右侧详情区展示完整内容（替代行内展开）；默认 false */
  splitDetail?: boolean;
}

export interface TrajectoryEvents {
  toggle: [id: string, open: boolean];
  /** splitDetail 模式下选中变化；null 表示关闭详情区 */
  select: [id: string | null];
}
