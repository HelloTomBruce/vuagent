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
}

export interface TrajectoryEvents {
  toggle: [id: string, open: boolean];
}
