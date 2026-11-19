import type { HarnessStreamEvent, AgentTurnRequest } from "./types.js";
import type { AgentLoop } from "./agent-loop.js";
import { createNoopSink, mapAbortCause, type HarnessEventSink } from "./event-sink.js";

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
  /** 抽干完成 promise（TASK-050 preempt 顶替等待旧轮落库） */
  drainPromise?: Promise<void>;
  /** drainPromise 的 resolve 句柄（spawnRun 内部注入，抽干完成时调用） */
  drainResolve?: () => void;
  /** TASK-054：广播序号计数器（seq 从 1 递增，增量重连去重寻址） */
  seqCounter: number;
}

/** 中止成因：user=用户显式停止 / new_task=同会话新请求顶替（TASK-050） */
export type AbortKind = "user" | "new_task";

/** claimTurn 结果：ok=false 时 reason 区分冲突形态（路由据此映射 409 code） */
export type ClaimTurnResult =
  | { ok: true }
  | { ok: false; reason: "running" | "preempt_timeout" };

/**
 * 会话执行调度与重连管理中心 (SessionExecutionHub)
 * 将 Agent 执行生命周期与 Session 解耦于前端单一 HTTP 连接：
 * 1. 会话后台持续执行：用户切换会话或临时断网不会中断执行回环
 * 2. 实时事件缓冲 (Event Replay Buffer)：支持断线重连或切回会话时按序重放
 * 3. 多端/跨标签页订阅：支持多个 SSE 连接同时监听同一运行中的会话
 */
export class SessionExecutionHub {
  private activeRuns = new Map<string, ActiveExecution>();
  /** 运维事件出口（TASK-051）：preempt/abort 等生命周期事件 */
  private sink: HarnessEventSink;

  constructor(private agentLoop: AgentLoop, sink?: HarnessEventSink) {
    this.sink = sink ?? createNoopSink();
  }

  /** sink 故障不阻断主链路 */
  private emit(event: Parameters<HarnessEventSink["emit"]>[0]): void {
    try {
      this.sink.emit(event);
    } catch {
      // 静默
    }
  }

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
   * 启动单轮执行，若当前会话已在运行则直接复用（attach 语义，遗留兼容：
   * 既有测试与潜在调用方仍依赖；POST /api/chat 已改走 claimTurn 纯开始语义）
   */
  async startOrAttachTurn(
    req: AgentTurnRequest,
    onEvent: (event: HarnessStreamEvent | "[DONE]") => void,
    fromEventIndex: number = 0
  ): Promise<{ unsubscribe: () => void; isNew: boolean }> {
    const run = this.activeRuns.get(req.sessionId);

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
    const currentRun = this.spawnRun(req);
    currentRun.subscribers.add(onEvent);

    return {
      unsubscribe: () => currentRun.subscribers.delete(onEvent),
      isNew: true,
    };
  }

  /**
   * 声明式开轮（TASK-050 纯开始语义）：会话运行中默认拒绝（reason:"running"，
   * 路由映射 409）；opts.preempt 顶替语义 = 中止旧轮（new_task 成因）→ 等待抽干
   * 落库（上限 preemptTimeoutMs，缺省 10s）→ 开新轮；超时未抽干拒绝
   * （reason:"preempt_timeout"）。
   * R2 修复：任何 !isDone 的旧轮（含「已 abort 仍在抽干」）都视为占用——
   * 手动停止后立刻发新 prompt 不再直接 spawn（此前与旧轮收尾 appendTurn
   * 形成跨 generator 的 session doc 读-改-写竞态，最坏丢失整轮历史）。
   */
  async claimTurn(
    req: AgentTurnRequest,
    opts: { preempt?: boolean; preemptTimeoutMs?: number } = {}
  ): Promise<ClaimTurnResult> {
    const existing = this.activeRuns.get(req.sessionId);
    if (existing && !existing.isDone) {
      if (!existing.aborted) {
        if (!opts.preempt) {
          return { ok: false, reason: "running" };
        }
        // 顶替：中止旧轮并等待其抽干落库（避免新旧轮次对同一 session doc 的写竞态）
        this.abort(req.sessionId, "new_task");
      }
      // running 被 preempt 中止后 / 本已 aborted 抽干中：统一等待旧轮收尾落库
      const drained = await this.waitForDrain(req.sessionId, opts.preemptTimeoutMs ?? 10_000);
      if (!drained) {
        return { ok: false, reason: "preempt_timeout" };
      }
      // 抽干等待窗内另一请求可能已开新轮：防覆盖
      const after = this.activeRuns.get(req.sessionId);
      if (after && !after.isDone && after !== existing) {
        return { ok: false, reason: "running" };
      }
    }
    this.spawnRun(req);
    return { ok: true };
  }

  /** 创建 run 并启动后台消费循环（同步登记，原子 wrt 事件循环） */
  private spawnRun(req: AgentTurnRequest): ActiveExecution {
    const abortController = new AbortController();
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let drainResolve!: () => void;
    const drainPromise = new Promise<void>((resolve) => {
      drainResolve = resolve;
    });
    const run: ActiveExecution = {
      sessionId: req.sessionId,
      turnId,
      prompt: req.prompt,
      startedAt: Date.now(),
      abortController,
      events: [],
      subscribers: new Set(),
      isDone: false,
      drainResolve,
      drainPromise,
      seqCounter: 0,
    };
    this.activeRuns.set(req.sessionId, run);

    // 启动非阻塞后台任务循环
    (async () => {
      try {
        const eventStream = this.agentLoop.runTurn(req, run.abortController.signal);
        // 注意：这里不能因 abortSignal 而 break——必须持续抽干事件流，
        // 让 AgentLoop 的中止分支走完 turn_end 并 appendTurn 落库
        for await (const event of eventStream) {
          // TASK-054：广播时注入递增 seq（事件寻址，增量重连去重用）
          const sequenced = Object.assign({}, event, { seq: ++run.seqCounter });
          run.events.push(sequenced);
          for (const sub of run.subscribers) {
            try {
              sub(sequenced);
            } catch {
              // 忽略单个断开的订阅者
            }
          }
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errEvent: HarnessStreamEvent & { seq?: number } = Object.assign(
          { type: "error" as const, message: errorMsg },
          { seq: ++run.seqCounter }
        );
        run.events.push(errEvent);
        for (const sub of run.subscribers) {
          try {
            sub(errEvent);
          } catch {}
        }
      } finally {
        run.isDone = true;
        drainResolve();
        for (const sub of run.subscribers) {
          try {
            sub("[DONE]");
          } catch {}
        }
        run.subscribers.clear();
        // 延迟 30 秒保留完成的 run，供刚刷新的页面做最后的重放兜底
        setTimeout(() => {
          if (this.activeRuns.get(req.sessionId) === run) {
            this.activeRuns.delete(req.sessionId);
          }
        }, 30_000);
      }
    })();

    return run;
  }

  /** 当前 running 状态的轮次数（并发准入计数来源，TASK-052 将消费） */
  runningCount(): number {
    let count = 0;
    for (const run of this.activeRuns.values()) {
      if (!run.isDone && !run.aborted) count++;
    }
    return count;
  }

  /**
   * 等待指定会话的活跃轮次抽干落库完成。
   * 无活跃轮次立即返回 true；限时内未抽干返回 false（不抛错）。
   */
  async waitForDrain(sessionId: string, timeoutMs: number = 10_000): Promise<boolean> {
    const run = this.activeRuns.get(sessionId);
    if (!run || run.isDone) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (v: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => settle(false), timeoutMs);
      (timer as { unref?: () => void }).unref?.();
      void (run.drainPromise ?? Promise.resolve()).then(() => settle(true));
    });
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
   * （否则手动中止的轮次刷新后会从历史中消失）。
   * reason 区分广播文案：user=手动中止 / new_task=新请求顶替（TASK-050）。
   */
  abort(sessionId: string, reason: AbortKind = "user"): boolean {
    const run = this.activeRuns.get(sessionId);
    if (!run || run.isDone || run.aborted) return false;
    // R5 修复：成因经 signal.reason 传递给 agent-loop（ops 台账归因一致），
    // 映射逻辑集中在 mapAbortCause（hub 与 agent-loop 共用同一事实来源）
    run.abortController.abort(reason);
    run.aborted = true;
    const cause = mapAbortCause({ watchdogFired: false, signalReason: reason });
    // TASK-051：中止运维事件（new_task=顶替 / user=手动停止）
    this.emit({
      type: "abort",
      at: Date.now(),
      sessionId: run.sessionId,
      turnId: run.turnId,
      reason: cause.opsReason,
      code: cause.code,
    });
    // TASK-054：aborted 控制事件广播（取代旧假 text_delta 斜体文案，
    // 控制语义与数据语义分离；前端 reducer 渲染中止徽标）。
    const abortedEvent: HarnessStreamEvent & { seq?: number } = {
      type: "aborted",
      turnId: run.turnId,
      reason: cause.protocolReason,
    };
    const seq = ++run.seqCounter;
    run.events.push(Object.assign(abortedEvent, { seq }));
    for (const sub of run.subscribers) {
      try {
        sub(abortedEvent);
        sub("[DONE]");
      } catch {}
    }
    run.subscribers.clear();
    return true;
  }
}
