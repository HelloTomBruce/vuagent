export type TrajectoryLane = "input" | "model" | "tool";
export type TrajectoryRole = "user" | "assistant" | "tool" | "system";

export interface TrajectoryEvent {
  id: string;
  at: number;
  endAt?: number;
  lane: TrajectoryLane;
  role: TrajectoryRole;
  title: string;
  detail?: string;
  result?: string;
  turn: number;
  durationMs?: number;
}

export interface TelemetrySummary {
  turnId: string;
  turnNumber: number;
  totalDurationMs: number;
  ttftMs?: number;
  stepCount: number;
  tokens: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  events: TrajectoryEvent[];
}

/**
 * 全链路遥测与轨迹台账收集器 (TelemetryLedger)
 * 记录三泳道时序流水、延时指标与 Token 计费台账
 */
export class TelemetryLedger {
  private events: TrajectoryEvent[] = [];
  private startTime = Date.now();
  private firstTokenTime?: number;
  private promptTokens = 0;
  private completionTokens = 0;

  constructor(private turnId: string, private turnNumber: number = 1) {}

  /**
   * 记录首 Token 到达时间 (TTFT)
   */
  recordFirstToken() {
    if (!this.firstTokenTime) {
      this.firstTokenTime = Date.now();
    }
  }

  /**
   * 累加 Token 统计
   */
  addTokens(prompt: number, completion: number) {
    this.promptTokens += prompt;
    this.completionTokens += completion;
  }

  /**
   * 记录泳道事件
   */
  recordEvent(event: Omit<TrajectoryEvent, "id" | "turn"> & { id?: string }): TrajectoryEvent {
    const entry: TrajectoryEvent = {
      ...event,
      id: event.id || `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      turn: this.turnNumber,
      durationMs: event.endAt ? event.endAt - event.at : undefined,
    };
    this.events.push(entry);
    return entry;
  }

  /**
   * 导出台账与度量摘要
   */
  exportSummary(): TelemetrySummary {
    const now = Date.now();
    return {
      turnId: this.turnId,
      turnNumber: this.turnNumber,
      totalDurationMs: now - this.startTime,
      ttftMs: this.firstTokenTime ? this.firstTokenTime - this.startTime : undefined,
      stepCount: this.events.filter((e) => e.lane === "model").length,
      tokens: {
        promptTokens: this.promptTokens,
        completionTokens: this.completionTokens,
        totalTokens: this.promptTokens + this.completionTokens,
      },
      events: [...this.events],
    };
  }

  getEvents(): TrajectoryEvent[] {
    return [...this.events];
  }
}

/** 轨迹事件正文截断上限（SSE 推送与落库共用，控制载荷体积） */
const TRAJ_TEXT_LIMIT = 500;

/** 截断轨迹事件的 detail/result（返回新对象，不修改原事件） */
export function clipTrajectoryEvent(e: TrajectoryEvent): TrajectoryEvent {
  const clip = (s?: string) =>
    s && s.length > TRAJ_TEXT_LIMIT ? `${s.slice(0, TRAJ_TEXT_LIMIT)}…[截断]` : s;
  return { ...e, detail: clip(e.detail), result: clip(e.result) };
}
