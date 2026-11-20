import { describe, expect, it } from "vitest";
import { SessionExecutionHub } from "../src/core/session-execution-hub.js";
import type { AgentLoop } from "../src/core/agent-loop.js";
import type { AgentTurnRequest, HarnessStreamEvent } from "../src/core/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GenFactory = (
  signal: AbortSignal
) => AsyncGenerator<HarnessStreamEvent>;

function makeHub(genFactory: GenFactory): SessionExecutionHub {
  // Hub 仅依赖 agentLoop.runTurn(req, signal)，用最小桩替换即可
  return new SessionExecutionHub({
    runTurn: (_req: AgentTurnRequest, signal?: AbortSignal) =>
      genFactory(signal as AbortSignal),
  } as unknown as AgentLoop);
}

describe("SessionExecutionHub.abort — 抽干落库语义", () => {
  it("abort 后后台事件循环继续抽干直至 generator 完成", async () => {
    let drainedToCompletion = false;
    const hub = makeHub(async function* (signal) {
      yield { type: "text_delta", messageId: "m", delta: "part-1" };
      // 模拟模型流：挂起直到 abort 打断
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve());
      });
      yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      drainedToCompletion = true;
    });

    const events: (HarnessStreamEvent | "[DONE]")[] = [];
    await hub.startOrAttachTurn(
      { sessionId: "s1", workspaceId: "w1", prompt: "p" },
      (e) => events.push(e)
    );
    await sleep(10);
    expect(hub.isRunning("s1")).toBe(true);

    expect(hub.abort("s1")).toBe(true);
    // 订阅者立刻收到中止提示与 [DONE]
    expect(events.filter((e) => e === "[DONE]")).toHaveLength(1);

    // 后台继续抽干（旧的直接 delete 会导致 generator 永远挂起、轮次不落库）
    await sleep(30);
    expect(drainedToCompletion).toBe(true);
    expect(hub.isRunning("s1")).toBe(false);
  });

  it("abort 后同会话可立即开启新一轮（新 run 不复用抽干中的旧 run）", async () => {
    const hub = makeHub(async function* (signal) {
      yield { type: "text_delta", messageId: "m", delta: "x" };
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve())
      );
      await sleep(50); // 抽干耗时
    });

    await hub.startOrAttachTurn(
      { sessionId: "s2", workspaceId: "w1", prompt: "1" },
      () => {}
    );
    await sleep(5);
    hub.abort("s2");

    const second = await hub.startOrAttachTurn(
      { sessionId: "s2", workspaceId: "w1", prompt: "2" },
      () => {}
    );
    expect(second.isNew).toBe(true);
    expect(hub.isRunning("s2")).toBe(true);
  });

  it("抽干中的已中止会话 subscribe 返回 null（前端回退数据库历史）", async () => {
    const hub = makeHub(async function* (signal) {
      yield { type: "text_delta", messageId: "m", delta: "x" };
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve())
      );
      await sleep(50);
    });

    await hub.startOrAttachTurn(
      { sessionId: "s3", workspaceId: "w1", prompt: "p" },
      () => {}
    );
    await sleep(5);
    hub.abort("s3");
    expect(hub.subscribe("s3", () => {})).toBeNull();
    expect(hub.getActiveRun("s3")).toBeUndefined();
  });
});

describe("SessionExecutionHub 跨副本租约（LeaseOptions）", () => {
  it("租约持有期间同会话 claimTurn 拒绝（409 running 语义）；轮次抽干落库后释放可再获取", async () => {
    const { createTestClock, FakeRedis } = await import("./helpers/fake-redis.js");
    const fake = new FakeRedis(createTestClock().now);
    const { TurnLeaseManager } = await import("../src/core/turn-lease.js");
    const manager = new TurnLeaseManager(fake, "pod-a");

    let finishStream: (() => void) | undefined;
    const hub = new SessionExecutionHub(
      {
        runTurn: async function* (_req: AgentTurnRequest, signal?: AbortSignal) {
          yield { type: "text_delta", messageId: "m", delta: "x" } as HarnessStreamEvent;
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else finishStream = resolve;
          });
          yield { type: "turn_end", stepCount: 1, durationMs: 1 } as HarnessStreamEvent;
        },
      } as unknown as AgentLoop,
      undefined,
      { manager, instanceId: "pod-a", ttlMs: 60_000 }
    );

    const first = await hub.claimTurn({ sessionId: "s-lease", workspaceId: "w", prompt: "p1" });
    expect(first).toEqual({ ok: true });

    // 进程内互斥 + 跨副本租约均拒绝第二请求
    const second = await hub.claimTurn({ sessionId: "s-lease", workspaceId: "w", prompt: "p2" });
    expect(second).toEqual({ ok: false, reason: "running" });

    // 流结束后租约释放（抽干落库 → finally release）：manager2 重试获取成功即证明已释放
    finishStream?.();
    const manager2 = new TurnLeaseManager(fake, "pod-a");
    let again = false;
    const deadline = Date.now() + 500;
    while (!again && Date.now() < deadline) {
      await sleep(5);
      again = await manager2.acquire("s-lease", "turn-next", 60_000);
    }
    expect(again).toBe(true);
  });

  it("租约获取失败（fail-closed）→ claimTurn 返回 running", async () => {
    const { FakeRedis } = await import("./helpers/fake-redis.js");
    const fake = new FakeRedis();
    fake.failAll = true;
    const { TurnLeaseManager } = await import("../src/core/turn-lease.js");
    const hub = new SessionExecutionHub(
      { runTurn: async function* () { yield { type: "turn_end", stepCount: 1, durationMs: 1 }; } } as unknown as AgentLoop,
      undefined,
      { manager: new TurnLeaseManager(fake as never, "pod-a"), instanceId: "pod-a" }
    );
    const result = await hub.claimTurn({ sessionId: "s-x", workspaceId: "w", prompt: "p" });
    expect(result).toEqual({ ok: false, reason: "running" });
  });
});
