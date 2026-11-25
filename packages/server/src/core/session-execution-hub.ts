import type { HarnessStreamEvent, AgentTurnRequest } from "./types.js";
import type { AgentLoop } from "./agent-loop.js";
import { createNoopSink, mapAbortCause, type HarnessEventSink } from "./event-sink.js";
import type { TurnLeaseManager } from "./turn-lease.js";

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

/**
 * 活跃 run 事件缓冲上限（TASK-090）：防长轮次 delta 把缓冲撑爆内存。
 * 淘汰最旧（seq 保序）；增量重连检测到缺口（请求 fromSeq 早于缓冲最旧 seq）
 * 时回退全量重放并以 x-vuagent-replay: full 标注——诚实降级优于静默丢事件。
 */
export const RUN_EVENT_BUFFER_CAP = 2000;

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
/**
 * 跨副本租约配置（Redis 分布式形态，TASK-074）：
 * 同一会话同一时刻全集群只允许一轮执行——claimTurn 进程内互斥通过后，
 * 再经 Redis SET NX PX 取跨副本租约（fail-closed：拿不到即拒绝开轮）；
 * 运行期 ttl/3 心跳续期，连续失败达阈值中止本副本轮次（防 TTL 过期后他副本双主）；
 * 抽干落库后释放。
 */
export interface LeaseOptions {
  manager: TurnLeaseManager;
  /** 本副本实例标识（VUAGENT_INSTANCE_ID / hostname） */
  instanceId: string;
  /** 租约 TTL（毫秒），缺省 30_000 */
  ttlMs?: number;
  /** 心跳连续失败阈值（达到即中止本副本轮次），缺省 3 */
  maxHeartbeatFailures?: number;
}

/**
 * 事件缓冲外置（TASK-100，可选）：Redis 形态下广播事件同步落 Redis ring，
 * 进程重启后客户端重连可补看中断前增量（轮次本身由恢复机制诚实标记）。
 */
export interface EventLogStore {
  append(sessionId: string, event: HarnessStreamEvent & { seq?: number }): Promise<void>;
  /**
   * 读取 seq > fromSeq 的缓冲事件（评审 #5 诚实缺口语义）：
   * - gap=false：返回事件与客户端进度连续（首条返回 seq === fromSeq+1，或无可补事件
   *   且缓冲确认覆盖到 fromSeq）；
   * - gap=true：无法确认连续——ring 头部已被裁剪（首条返回 seq > fromSeq+1）、
   *   ring 空但 fromSeq>0、或 ring 最大 seq 落后于客户端进度。调用方应从 ring 头
   *   全量重放（readAfter(sessionId, 0)）并以 full 标注，不得静默当作增量。
   */
  readAfter(
    sessionId: string,
    fromSeq: number
  ): Promise<{ events: Array<HarnessStreamEvent & { seq?: number }>; gap: boolean }>;
}

export interface SessionExecutionHubOptions {
  eventLog?: EventLogStore;
}

export class SessionExecutionHub {
  private activeRuns = new Map<string, ActiveExecution>();
  /** 运维事件出口（TASK-051）：preempt/abort 等生命周期事件 */
  private sink: HarnessEventSink;
  /** 跨副本租约（Redis 形态可选；缺省单副本无租约语义） */
  private lease?: LeaseOptions;
  /** 事件缓冲外置（TASK-100，Redis 形态可选） */
  private eventLog?: EventLogStore;

  constructor(
    private agentLoop: AgentLoop,
    sink?: HarnessEventSink,
    lease?: LeaseOptions,
    options?: SessionExecutionHubOptions
  ) {
    this.sink = sink ?? createNoopSink();
    this.lease = lease;
    this.eventLog = options?.eventLog;
  }

  /** 外置缓冲读取（路由层重连回放用；未启用返回 undefined） */
  getEventLog(): EventLogStore | undefined {
    return this.eventLog;
  }

  /** 外置缓冲追加（fire-and-forget fail-open） */
  private logEvent(sessionId: string, event: HarnessStreamEvent): void {
    this.eventLog?.append(sessionId, event).catch(() => {});
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
    // 跨副本租约门禁（Redis 形态）：fail-closed——拿不到租约即拒绝，映射 running 409
    if (this.lease) {
      const ttl = this.lease.ttlMs ?? 30_000;
      const leaseTurnId =
        req.turnId ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const acquired = await this.lease.manager.acquire(req.sessionId, leaseTurnId, ttl);
      if (!acquired) {
        this.emit({
          type: "warn",
          at: Date.now(),
          code: "SESSION_RUNNING_REJECTED",
          sessionId: req.sessionId,
          detail: `跨副本租约获取失败（fail-closed，instanceId=${this.lease.instanceId}）`,
        });
        return { ok: false, reason: "running" };
      }
      this.spawnRun(req, { turnId: leaseTurnId, leaseTtlMs: ttl });
      return { ok: true };
    }
    this.spawnRun(req);
    return { ok: true };
  }

  /** 创建 run 并启动后台消费循环（同步登记，原子 wrt 事件循环） */
  private spawnRun(
    req: AgentTurnRequest,
    leaseOpts?: { turnId: string; leaseTtlMs: number }
  ): ActiveExecution {
    const abortController = new AbortController();
    // 租约形态：turnId 由 claimTurn 租约门禁预生成（租约身份 = sessionId+turnId 配对）；
    // 单副本形态：回落自生成（与 agent-loop 回落口径一致）
    const turnId = leaseOpts?.turnId ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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

    // 跨副本租约心跳（ttl/3）：连续失败达阈值即中止本副本轮次——
    // TTL 过期后他副本可重取同会话租约，保不住续期就不能继续持有执行权（防双主）
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let heartbeatFailures = 0;
    if (this.lease && leaseOpts) {
      const ttl = leaseOpts.leaseTtlMs;
      const leaseTurnId = leaseOpts.turnId;
      heartbeatTimer = setInterval(() => {
        void this.lease!.manager.heartbeat(req.sessionId, leaseTurnId, ttl).then((ok) => {
          if (ok) {
            heartbeatFailures = 0;
            return;
          }
          heartbeatFailures++;
          this.emit({
            type: "warn",
            at: Date.now(),
            code: "TURN_LEASE_HEARTBEAT_FAILED",
            sessionId: req.sessionId,
            turnId: leaseTurnId,
            detail: `failures=${heartbeatFailures}/${this.lease?.maxHeartbeatFailures ?? 3}`,
          });
          if (heartbeatFailures >= (this.lease?.maxHeartbeatFailures ?? 3)) {
            this.emit({
              type: "error",
              at: Date.now(),
              code: "TURN_LEASE_LOST",
              sessionId: req.sessionId,
              turnId: leaseTurnId,
              detail: `instanceId=${this.lease?.instanceId}，中止本副本轮次防双主`,
            });
            // signalReason=lease_lost：mapAbortCause 映射 opsReason=lease_lost（协议 reason=user）
            run.abortController.abort("lease_lost");
          }
        });
      }, Math.ceil(ttl / 3));
      (heartbeatTimer as { unref?: () => void }).unref?.();
    }

    // 启动非阻塞后台任务循环
    (async () => {
      try {
        // TASK-058：turnId 单一事实来源——hub 生成的 turnId 随请求传入，
        // agent-loop 优先消费 req.turnId，turn_start/落库/ops 台账与
        // hub 的 aborted/abort 事件不再各说各话
        const eventStream = this.agentLoop.runTurn(
          { ...req, turnId },
          run.abortController.signal
        );
        // 注意：这里不能因 abortSignal 而 break——必须持续抽干事件流，
        // 让 AgentLoop 的中止分支走完 turn_end 并 appendTurn 落库
        for await (const event of eventStream) {
          // TASK-054：广播时注入递增 seq（事件寻址，增量重连去重用）
          const sequenced = Object.assign({}, event, { seq: ++run.seqCounter });
          run.events.push(sequenced);
          // TASK-090：缓冲上限淘汰最旧（seq 保序），缺口由 subscribeFromSeq 检测并诚实回退全量
          if (run.events.length > RUN_EVENT_BUFFER_CAP) {
            run.events.splice(0, run.events.length - RUN_EVENT_BUFFER_CAP);
          }
          // TASK-100：外置缓冲追加（Redis 形态；fire-and-forget）
          this.logEvent(run.sessionId, sequenced);
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
        // 评审 #9：终态事件与普通事件同一 seq 序列同步落外置缓冲——
        // 重启后补看才能看到错误徽标（内存流只 push 这一次，不重复）
        this.logEvent(run.sessionId, errEvent);
        for (const sub of run.subscribers) {
          try {
            sub(errEvent);
          } catch {}
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        // 释放跨副本租约（fail-open：删除失败依赖 TTL 自然过期兜底）
        if (this.lease && leaseOpts) {
          void this.lease.manager.release(req.sessionId, leaseOpts.turnId);
        }
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
   * 按 seq 寻址订阅（TASK-090 增量重连）：重放缓冲中 seq > fromSeq 的事件后接入实时流。
   * fromSeq 缺省 = 全量重放缓冲（与 legacy subscribe(fromEventIndex=0) 等价）。
   * replayMode 语义（路由以 x-vuagent-replay 头标注给客户端）：
   * - "full"：无 fromSeq，或请求的 fromSeq 早于缓冲最旧 seq（缺口 = 事件已被
   *   缓冲上限淘汰）→ 从缓冲头全量重放——诚实降级优于静默丢事件；
   * - "partial"：无缺口且缓冲中有 seq > fromSeq 的未读事件；
   * - "live"：无未读事件，直接接入实时流。
   * 返回 null 与 legacy subscribe 同义（会话无活跃 run 或已中止抽干中）。
   */
  subscribeFromSeq(
    sessionId: string,
    onEvent: (event: HarnessStreamEvent | "[DONE]") => void,
    fromSeq?: number
  ): { unsubscribe: () => void; replayMode: "full" | "partial" | "live" } | null {
    const run = this.activeRuns.get(sessionId);
    if (!run || run.aborted) return null;

    const seqOf = (ev: HarnessStreamEvent): number =>
      (ev as HarnessStreamEvent & { seq?: number }).seq ?? 0;

    let replayMode: "full" | "partial" | "live" = "full";
    if (fromSeq === undefined) {
      for (const ev of run.events) onEvent(ev);
    } else {
      const oldest = run.events.length > 0 ? seqOf(run.events[0]) : null;
      // 评审 #2：客户端 seq 空间换代检测——fromSeq 超前于本 run 全部已知 seq
      // （重启后 seqCounter 归零 / 新 run 重新计数）时，缓冲里没有任何可信增量，
      // 静默 live 会永久丢事件；诚实语义 = 从缓冲头全量重放并标 full
      // （与缓冲淘汰缺口同一处理）。恰好追平（fromSeq === 已知最大 seq）仍是
      // 活跃 run 的正常 live 契约，不在此列。
      const latestSeq = run.events.length > 0 ? seqOf(run.events[run.events.length - 1]) : 0;
      const fromBeyondRun = fromSeq > latestSeq;
      if (fromBeyondRun || (oldest !== null && fromSeq < oldest - 1)) {
        // 缺口/换代：淘汰或换代前的历史无法按增量补发，全量重放
        for (const ev of run.events) onEvent(ev);
      } else {
        const missed = run.events.filter((ev) => seqOf(ev) > fromSeq);
        replayMode = missed.length > 0 ? "partial" : "live";
        for (const ev of missed) onEvent(ev);
      }
    }

    if (run.isDone) {
      onEvent("[DONE]");
      return { unsubscribe: () => {}, replayMode };
    }
    run.subscribers.add(onEvent);
    return { unsubscribe: () => run.subscribers.delete(onEvent), replayMode };
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
    if (run.events.length > RUN_EVENT_BUFFER_CAP) {
      run.events.splice(0, run.events.length - RUN_EVENT_BUFFER_CAP);
    }
    // 评审 #9：中止控制事件与普通事件同一 seq 序列同步落外置缓冲（不重复进内存流），
    // 重启后补看含中止徽标
    this.logEvent(run.sessionId, abortedEvent);
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
