/**
 * TASK-090：SSE 心跳注释帧 + 增量重连（seq 寻址订阅）
 *
 * 1. createSSEResponse：空闲期 : keepalive 注释帧（fake timer）、事件保序、
 *    DONE 收尾、abort 退订、attach null → TURN_PREEMPTED 收尾；
 * 2. hub.subscribeFromSeq：full（无 fromSeq / 缺口回退）/ partial（seq 过滤）/
 *    live（无未读）三模式 + isDone 即 [DONE]；缓冲上限淘汰触发缺口回退；
 * 3. 路由级：/api/sessions/:id/stream 带 Last-Event-ID → 只收增量，
 *    x-vuagent-replay 头标注实际模式。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSSEResponse } from "../src/core/sse-response.js";
import { SessionExecutionHub, RUN_EVENT_BUFFER_CAP } from "../src/core/session-execution-hub.js";
import { createRedisEventLog } from "../src/core/redis-externalize.js";
import { createHarnessServer } from "../src/server.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { AgentLoop } from "../src/core/agent-loop.js";
import type { AgentTurnRequest, HarnessStreamEvent } from "../src/core/types.js";
import type { HarnessStreamEvent as ProtocolEvent } from "../src/core/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOCAL_ORIGIN = "http://localhost:5173";

type GenFactory = (signal: AbortSignal) => AsyncGenerator<HarnessStreamEvent>;

function makeHub(genFactory: GenFactory): SessionExecutionHub {
  return new SessionExecutionHub({
    runTurn: (_req: AgentTurnRequest, signal?: AbortSignal) => genFactory(signal as AbortSignal),
  } as unknown as AgentLoop);
}

/* ==========================================================================
   createSSEResponse 单元
   ========================================================================== */

/** 读完整个 SSE Response 文本（流收尾后） */
async function readAll(res: Response): Promise<string> {
  return await res.text();
}

describe("createSSEResponse 心跳与生命周期（TASK-090）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("空闲期按间隔输出 : keepalive 注释帧；事件与 DONE 保序收尾", async () => {
    const res = createSSEResponse({
      heartbeatMs: 1000,
      attach: (pump) => {
        // 模拟订阅先行：先到 1 个事件，其余挂到定时器（挂在 fake timeline 上）
        pump({ type: "turn_start", turnId: "t1", sessionId: "s1", prompt: "p" } as unknown as HarnessStreamEvent);
        setTimeout(() => {
          pump({ type: "text_delta", messageId: "m", delta: "hi" } as HarnessStreamEvent);
          pump("[DONE]");
        }, 3500);
        return { unsubscribe: () => {} };
      },
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const bodyPromise = readAll(res);
    await vi.advanceTimersByTimeAsync(3600);
    const text = await bodyPromise;
    // 心跳帧出现在第一个事件后（1500ms/2500ms 两个空闲点 × 1s 间隔）
    expect(text.startsWith("data: ")).toBe(true);
    expect((text.match(/: keepalive/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(text).toContain('"delta":"hi"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("订阅先行期间到达的事件不丢失（start 排空 pending）", async () => {
    const res = createSSEResponse({
      heartbeatMs: 0,
      attach: (pump) => {
        pump({ type: "text_delta", messageId: "m", delta: "a" } as HarnessStreamEvent);
        pump({ type: "text_delta", messageId: "m", delta: "b" } as HarnessStreamEvent);
        pump("[DONE]");
        return { unsubscribe: () => {} };
      },
    });
    const text = await readAll(res);
    expect(text).toContain('"delta":"a"');
    expect(text).toContain('"delta":"b"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("abort 信号触发退订；attach null 发送 attachFailedEvent 并收尾", async () => {
    let unsubCalls = 0;
    const controller = new AbortController();
    const res = createSSEResponse({
      heartbeatMs: 0,
      signal: controller.signal,
      attach: () => ({ unsubscribe: () => void ++unsubCalls }),
    });
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(unsubCalls).toBe(1);
    await res.body?.cancel();

    const failed = createSSEResponse({
      heartbeatMs: 0,
      attach: () => null,
      attachFailedEvent: { type: "error", message: "preempted", code: "TURN_PREEMPTED" },
    });
    const text = await readAll(failed);
    expect(text).toContain("TURN_PREEMPTED");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });
});

/* ==========================================================================
   hub.subscribeFromSeq 三模式 + 缓冲上限缺口回退
   ========================================================================== */

describe("subscribeFromSeq 增量重连（TASK-090）", () => {
  const delta = (n: number): HarnessStreamEvent =>
    ({ type: "text_delta", messageId: "m", delta: `d${n}` }) as HarnessStreamEvent;

  it("无 fromSeq → full 全量重放；fromSeq 命中 → partial 只补未读", async () => {
    const hub = makeHub((signal) =>
      (async function* () {
        yield delta(1);
        yield delta(2);
        yield delta(3);
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve());
        });
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      })()
    );
    await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "p" });
    await sleep(20);

    const seenFull: string[] = [];
    const full = hub.subscribeFromSeq("s1", (ev) => {
      if (ev !== "[DONE]") seenFull.push((ev as ProtocolEvent & { delta?: string }).delta ?? "");
    });
    expect(full?.replayMode).toBe("full");
    expect(seenFull).toEqual(["d1", "d2", "d3"]);
    full?.unsubscribe();

    // 假设客户端已消费到 seq=2（d1=seq1, d2=seq2）：只应补 d3
    const seenPartial: string[] = [];
    const partial = hub.subscribeFromSeq("s1", (ev) => {
      if (ev !== "[DONE]") seenPartial.push((ev as ProtocolEvent & { delta?: string }).delta ?? "");
    }, 2);
    expect(partial?.replayMode).toBe("partial");
    expect(seenPartial).toEqual(["d3"]);
    partial?.unsubscribe();

    // 已追平（fromSeq = 当前最大 seq）→ live 直连
    const live = hub.subscribeFromSeq("s1", () => {}, 3);
    expect(live?.replayMode).toBe("live");
    live?.unsubscribe();

    hub.abort("s1");
  });

  it("fromSeq 早于缓冲最旧 seq（缺口）→ 回退 full；abort 的会话返回 null", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const hub = makeHub(() =>
      (async function* () {
        for (let i = 1; i <= RUN_EVENT_BUFFER_CAP + 50; i++) yield delta(i);
        await gate;
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      })()
    );
    await hub.claimTurn({ sessionId: "s2", workspaceId: "w", prompt: "p" });
    await sleep(60); // 等待缓冲产出并触发淘汰

    const run = hub.getActiveRun("s2")!;
    expect(run.events.length).toBeLessThanOrEqual(RUN_EVENT_BUFFER_CAP);
    const oldestSeq = (run.events[0] as ProtocolEvent & { seq?: number }).seq!;

    const seen: number[] = [];
    const sub = hub.subscribeFromSeq("s2", (ev) => {
      if (ev !== "[DONE]") seen.push((ev as ProtocolEvent & { seq?: number }).seq ?? 0);
    }, oldestSeq - 10); // 缺口：请求进度早于缓冲窗口 10 个事件
    expect(sub?.replayMode).toBe("full");
    expect(seen[0]).toBe(oldestSeq); // 从缓冲头开始，诚实全量
    sub?.unsubscribe();

    hub.abort("s2");
    release();
    expect(hub.subscribeFromSeq("s2", () => {}, 0)).toBeNull();
  });

  it("#2 重启后新 run + 旧 Last-Event-ID（fromSeq 超前于新 run 全部 seq）→ full 全量重放", async () => {
    // 第一代 run（重启前）：seq 1..3，客户端已消费到 Last-Event-ID=3
    const hub1 = makeHub(() =>
      (async function* () {
        yield delta(1);
        yield delta(2);
        yield delta(3);
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      })()
    );
    await hub1.claimTurn({ sessionId: "s-gen", workspaceId: "w", prompt: "p" });
    await hub1.waitForDrain("s-gen");

    // 第二代 run（模拟重启后）：新 hub 实例 seqCounter 归零，只产出 2 个事件
    const hub2 = makeHub((signal) =>
      (async function* () {
        yield delta(1);
        yield delta(2);
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve());
        });
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      })()
    );
    await hub2.claimTurn({ sessionId: "s-gen", workspaceId: "w", prompt: "p" });
    await sleep(20);

    // 旧 Last-Event-ID=3 超前于新 run 的全部已知 seq（1..2）→ 换代：静默 live 会
    // 永久丢事件，诚实语义 = 从缓冲头全量重放并标 full
    const seen: string[] = [];
    const sub = hub2.subscribeFromSeq("s-gen", (ev) => {
      if (ev !== "[DONE]") seen.push((ev as ProtocolEvent & { delta?: string }).delta ?? "");
    }, 3);
    expect(sub?.replayMode).toBe("full");
    expect(seen).toEqual(["d1", "d2"]); // 从缓冲头全量
    sub?.unsubscribe();

    // 恰好追平（fromSeq === 新 run 最大 seq=2）仍是活跃 run 的正常 live 契约
    const live = hub2.subscribeFromSeq("s-gen", () => {}, 2);
    expect(live?.replayMode).toBe("live");
    live?.unsubscribe();

    hub2.abort("s-gen");
  });

  it("isDone 后订阅只重放 + [DONE]（replayMode 保持）", async () => {
    const hub = makeHub(() =>
      (async function* () {
        yield delta(1);
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      })()
    );
    await hub.claimTurn({ sessionId: "s3", workspaceId: "w", prompt: "p" });
    await sleep(20);
    let done = false;
    // 缓冲 = [delta1(seq1), turn_end(seq2)]：fromSeq=2 已追平 → live；fromSeq=1 → partial 补 turn_end
    const sub = hub.subscribeFromSeq("s3", (ev) => {
      if (ev === "[DONE]") done = true;
    }, 2);
    expect(sub?.replayMode).toBe("live");
    expect(done).toBe(true);
  });
});

/* ==========================================================================
   路由级：Last-Event-ID / fromSeq 消费 + x-vuagent-replay 标注
   ========================================================================== */

describe("/api/sessions/:id/stream 增量重连（TASK-090）", () => {
  function scriptedServer() {
    const mockDriver = new MockDriver();
    mockDriver.setScript({
      steps: [[{ type: "text", text: "resume-ok" }]],
    });
    return createHarnessServer({ dbPath: ":memory:", modelDriver: mockDriver });
  }

  it("无活跃会话 → JSON {isRunning:false}（不走 SSE）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/sessions/none/stream", {
      headers: { Origin: LOCAL_ORIGIN },
    });
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = (await res.json()) as { isRunning: boolean };
    expect(json.isRunning).toBe(false);
  });

  it("活跃会话全量重连 → x-vuagent-replay: full + 事件流；带 Last-Event-ID 的头已透传给 hub", async () => {
    const { app } = scriptedServer();
    const chatRes = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: LOCAL_ORIGIN },
      body: JSON.stringify({ prompt: "hello", sessionId: "sess-resume" }),
    });
    expect(chatRes.status).toBe(200);
    await chatRes.text(); // 消费流（本连接的 [DONE]）

    // 轮次结束后 stream 路由走 isRunning:false 分支——改在活跃窗口内验证：
    // 先等第二轮 SSE 响应头返回（此时 claim 成功、run 活跃），再发重连请求
    const chat2Promise = app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: LOCAL_ORIGIN },
      body: JSON.stringify({ prompt: "second", sessionId: "sess-resume" }),
    });
    const chat2Res = await chat2Promise; // 响应头就绪 = run 已激活
    const streamRes = await app.request("/api/sessions/sess-resume/stream", {
      headers: { Origin: LOCAL_ORIGIN, "Last-Event-ID": "999999" },
    });
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    // 评审 #2：fromSeq=999999 超前于本 run 全部缓冲 seq（客户端 seq 空间已换代，
    // 如重启后 seqCounter 归零）→ 诚实语义 = full + 从缓冲头全量重放，
    // 不再返回空 missed + live（旧契约把 999999→live 固化为静默丢事件）
    expect(streamRes.headers.get("x-vuagent-replay")).toBe("full");
    const text = await Promise.race([streamRes.text(), sleep(3000).then(() => "timeout")]);
    expect(text).not.toBe("timeout");
    // 全量重放证据：缓冲头事件（turn_start）必须出现在补看流中
    expect(text).toContain('"turn_start"');
    await chat2Res.text();
  });
});

/* ==========================================================================
   #9 终态事件落外置 eventLog（重启补看）+ #5 外置 ring 缺口诚实标注
   ========================================================================== */

const seqDelta = (n: number): ProtocolEvent & { seq?: number } =>
  ({ type: "text_delta", messageId: "m", delta: `d${n}`, seq: n }) as ProtocolEvent & { seq?: number };

/** 内存 eventLog（实现 hub EventLogStore 新契约：append + readAfter {events, gap}） */
function memoryEventLog() {
  const store = new Map<string, Array<HarnessStreamEvent & { seq?: number }>>();
  return {
    entriesOf(sessionId: string): Array<HarnessStreamEvent & { seq?: number }> {
      return store.get(sessionId) ?? [];
    },
    async append(sessionId: string, event: HarnessStreamEvent & { seq?: number }): Promise<void> {
      const list = store.get(sessionId) ?? [];
      list.push(event);
      store.set(sessionId, list);
    },
    async readAfter(sessionId: string, fromSeq: number) {
      const events = (store.get(sessionId) ?? []).filter((e) => (e.seq ?? 0) > fromSeq);
      return { events, gap: false };
    },
  };
}

describe("#9 终态事件落外置 eventLog（重启补看）", () => {
  it("error/aborted 与普通事件同一 seq 序列落 eventLog；新 hub 实例补看可取回", async () => {
    const log = memoryEventLog();

    // error 路径：生成器抛错 → error 事件按连续 seq 落 eventLog
    const errHub = new SessionExecutionHub(
      {
        runTurn: () =>
          (async function* () {
            yield seqDelta(1);
            throw new Error("turn exploded");
          })(),
      } as unknown as AgentLoop,
      undefined,
      undefined,
      { eventLog: log }
    );
    await errHub.claimTurn({ sessionId: "s-err", workspaceId: "w", prompt: "p" });
    await errHub.waitForDrain("s-err");
    const errRun = log.entriesOf("s-err");
    expect(errRun.map((e) => e.type)).toEqual(["text_delta", "error"]);
    expect(errRun[1]).toMatchObject({ type: "error", message: "turn exploded", seq: 2 });

    // aborted 路径：abort() 的 aborted 控制事件按连续 seq 落 eventLog
    const abortHub = new SessionExecutionHub(
      {
        runTurn: (_req: AgentTurnRequest, signal?: AbortSignal) =>
          (async function* () {
            yield seqDelta(1);
            await new Promise<void>((resolve) => {
              if (signal?.aborted) resolve();
              else signal!.addEventListener("abort", () => resolve());
            });
            yield { type: "turn_end", stepCount: 1, durationMs: 1 };
          })(),
      } as unknown as AgentLoop,
      undefined,
      undefined,
      { eventLog: log }
    );
    await abortHub.claimTurn({ sessionId: "s-abort", workspaceId: "w", prompt: "p" });
    await sleep(20);
    expect(abortHub.abort("s-abort")).toBe(true);
    await abortHub.waitForDrain("s-abort");
    const abortRun = log.entriesOf("s-abort");
    // seq 序列连续：普通事件 → aborted（控制事件，非重复 push）→ turn_end
    expect(abortRun.map((e) => e.type)).toEqual(["text_delta", "aborted", "turn_end"]);
    expect(abortRun.map((e) => e.seq)).toEqual([1, 2, 3]);

    // 重启补看：全新 hub 实例（仅持有同一外置 store）读出 error/aborted 终态徽标
    const freshHub = new SessionExecutionHub({} as unknown as AgentLoop, undefined, undefined, {
      eventLog: log,
    });
    const replayErr = await freshHub.getEventLog()!.readAfter("s-err", 0);
    expect(replayErr.gap).toBe(false);
    expect(replayErr.events.some((e) => e.type === "error")).toBe(true);
    const replayAbort = await freshHub.getEventLog()!.readAfter("s-abort", 1);
    expect(replayAbort.gap).toBe(false);
    expect(replayAbort.events.some((e) => e.type === "aborted")).toBe(true);
  });
});

describe("#5 外置 ring 回放缺口诚实标注（readAfter gap）", () => {
  /** 最小 FakeRedis：仅 event log 所需 list 操作（rpush/ltrim/lrange/expire，含负索引语义） */
  function fakeRedis() {
    const lists = new Map<string, string[]>();
    const slice = (arr: string[], start: number, end: number): string[] => {
      const len = arr.length;
      const s = start < 0 ? Math.max(len + start, 0) : start;
      const e = end < 0 ? len + end : Math.min(end, len - 1);
      return s > e ? [] : arr.slice(s, e + 1);
    };
    return {
      async rpush(key: string, ...values: string[]) {
        const list = lists.get(key) ?? [];
        list.push(...values);
        lists.set(key, list);
        return list.length;
      },
      async ltrim(key: string, start: number, end: number) {
        lists.set(key, slice(lists.get(key) ?? [], start, end));
        return "OK";
      },
      async lrange(key: string, start: number, end: number) {
        return slice(lists.get(key) ?? [], start, end);
      },
      async expire() {
        return 1;
      },
    };
  }

  it("ring 裁剪（LTRIM 头部）后首条返回 seq 越过 fromSeq+1 → gap=true；追平/全新会话不误报", async () => {
    const log = createRedisEventLog(fakeRedis() as never, { cap: 3, ttlSeconds: 60 })!;
    for (let i = 1; i <= 5; i++) await log.append("g1", seqDelta(i)); // cap=3 → ring 只剩 seq 3/4/5

    // 连续：客户端在 seq2，ring 头正好是 seq3（fromSeq+1）
    expect(await log.readAfter("g1", 2)).toEqual({
      events: [seqDelta(3), seqDelta(4), seqDelta(5)],
      gap: false,
    });
    // 缺口：客户端在 seq1，seq2 已被 LTRIM 裁剪 → 无法确认连续，诚实标 gap
    expect(await log.readAfter("g1", 1)).toEqual({
      events: [seqDelta(3), seqDelta(4), seqDelta(5)],
      gap: true,
    });
    // 追平：客户端已消费到 ring 尾
    expect(await log.readAfter("g1", 5)).toEqual({ events: [], gap: false });
    // ring 空 + fromSeq>0 → 无法确认连续
    expect(await log.readAfter("g-none", 4)).toEqual({ events: [], gap: true });
    // 全新会话 fromSeq=0：无进度声明，空不算缺口
    expect(await log.readAfter("g-none", 0)).toEqual({ events: [], gap: false });
  });
});
