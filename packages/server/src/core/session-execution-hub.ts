import type { HarnessStreamEvent, AgentTurnRequest } from "./types.js";
import type { AgentLoop } from "./agent-loop.js";

export interface ActiveExecution {
  sessionId: string;
  turnId: string;
  prompt: string;
  startedAt: number;
  abortController: AbortController;
  events: HarnessStreamEvent[];
  subscribers: Set<(event: HarnessStreamEvent | "[DONE]") => void>;
  isDone: boolean;
  /** 已被手动中止：订阅全部断开，但后台继续抽干事件流直至 agent-loop 落库完成 */
  aborted?: boolean;
}

/**
 * 会话执行调度与重连管理中心 (SessionExecutionHub)
 * 将 Agent 执行生命周期与 Session 解耦于前端单一 HTTP 连接：
 * 1. 会话后台持续执行：用户切换会话或临时断网不会中断执行回环
 * 2. 实时事件缓冲 (Event Replay Buffer)：支持断线重连或切回会话时按序重放
 * 3. 多端/跨标签页订阅：支持多个 SSE 连接同时监听同一运行中的会话
 */
export class SessionExecutionHub {
  private activeRuns = new Map<string, ActiveExecution>();

  constructor(private agentLoop: AgentLoop) {}

  /**
   * 检查指定会话是否正在运行（已中止的会话在抽干落库前视为不在运行）
   */
  isRunning(sessionId: string): boolean {
    const run = this.activeRuns.get(sessionId);
    return Boolean(run && !run.isDone && !run.aborted);
  }

  /**
   * 获取指定会话的运行中状态信息
   */
  getActiveRun(sessionId: string): ActiveExecution | undefined {
    const run = this.activeRuns.get(sessionId);
    if (run && run.aborted) return undefined;
    return run;
  }

  /**
   * 启动单轮执行，若当前会话已在运行则直接复用
   */
  async startOrAttachTurn(
    req: AgentTurnRequest,
    onEvent: (event: HarnessStreamEvent | "[DONE]") => void,
    fromEventIndex: number = 0
  ): Promise<{ unsubscribe: () => void; isNew: boolean }> {
    let run = this.activeRuns.get(req.sessionId);

    if (run && !run.isDone && !run.aborted) {
      // 会话已在运行中：先重放历史缓冲事件，再接入实时广播流
      const buffered = run.events.slice(fromEventIndex);
      for (const ev of buffered) {
        onEvent(ev);
      }
      run.subscribers.add(onEvent);
      return {
        unsubscribe: () => run?.subscribers.delete(onEvent),
        isNew: false,
      };
    }

    // 开启全新独立后台轮次
    const abortController = new AbortController();
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    run = {
      sessionId: req.sessionId,
      turnId,
      prompt: req.prompt,
      startedAt: Date.now(),
      abortController,
      events: [],
      subscribers: new Set(),
      isDone: false,
    };
    this.activeRuns.set(req.sessionId, run);
    run.subscribers.add(onEvent);

    const currentRun = run;

    // 启动非阻塞后台任务循环
    (async () => {
      try {
        const eventStream = this.agentLoop.runTurn(req, currentRun.abortController.signal);
        // 注意：这里不能因 abortSignal 而 break——必须持续抽干事件流，
        // 让 AgentLoop 的中止分支走完 turn_end 并 appendTurn 落库
        for await (const event of eventStream) {
          currentRun.events.push(event);
          for (const sub of currentRun.subscribers) {
            try {
              sub(event);
            } catch {
              // 忽略单个断开的订阅者
            }
          }
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errEvent: HarnessStreamEvent = {
          type: "error",
          message: errorMsg,
        };
        currentRun.events.push(errEvent);
        for (const sub of currentRun.subscribers) {
          try {
            sub(errEvent);
          } catch {}
        }
      } finally {
        currentRun.isDone = true;
        for (const sub of currentRun.subscribers) {
          try {
            sub("[DONE]");
          } catch {}
        }
        currentRun.subscribers.clear();
        // 延迟 30 秒保留完成的 run，供刚刷新的页面做最后的重放兜底
        setTimeout(() => {
          if (this.activeRuns.get(req.sessionId) === currentRun) {
            this.activeRuns.delete(req.sessionId);
          }
        }, 30_000);
      }
    })();

    return {
      unsubscribe: () => currentRun.subscribers.delete(onEvent),
      isNew: true,
    };
  }

  /**
   * 订阅指定会话的正在进行流（重放 + 实时）
   * 已中止（抽干中）的会话返回 null：调用方应回退到数据库历史
   */
  subscribe(
    sessionId: string,
    onEvent: (event: HarnessStreamEvent | "[DONE]") => void,
    fromEventIndex: number = 0
  ): (() => void) | null {
    const run = this.activeRuns.get(sessionId);
    if (!run || run.aborted) return null;

    // 先重放历史事件
    const buffered = run.events.slice(fromEventIndex);
    for (const ev of buffered) {
      onEvent(ev);
    }

    if (run.isDone) {
      onEvent("[DONE]");
      return () => {};
    }

    run.subscribers.add(onEvent);
    return () => run.subscribers.delete(onEvent);
  }

  /**
   * 中止指定会话的执行
   * 广播中止提示并断开订阅者，但不销毁 run：后台事件循环继续抽干，
   * 让 AgentLoop 在 abort 分支里走完 turn_end 并 appendTurn 落库
   * （否则手动中止的轮次刷新后会从历史中消失）
   */
  abort(sessionId: string): boolean {
    const run = this.activeRuns.get(sessionId);
    if (!run || run.isDone || run.aborted) return false;
    run.abortController.abort();
    run.aborted = true;
    for (const sub of run.subscribers) {
      try {
        sub({
          type: "text_delta",
          messageId: `msg-${run.turnId}`,
          delta: "\n\n*(任务已被手动中止)*",
        });
        sub("[DONE]");
      } catch {}
    }
    run.subscribers.clear();
    return true;
  }
}
