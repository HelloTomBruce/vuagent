import { describe, it, expect } from "vitest";
import { SessionExecutionHub } from "../src/core/session-execution-hub.js";
import { createHarnessServer } from "../src/server.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import type { AgentLoop } from "../src/core/agent-loop.js";
import type { AgentTurnRequest, HarnessStreamEvent } from "../src/core/types.js";
import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GenFactory = (signal: AbortSignal) => AsyncGenerator<HarnessStreamEvent>;

function makeHub(genFactory: GenFactory): SessionExecutionHub {
  return new SessionExecutionHub({
    runTurn: (_req: AgentTurnRequest, signal?: AbortSignal) =>
      genFactory(signal as AbortSignal),
  } as unknown as AgentLoop);
}

describe("SessionExecutionHub.claimTurn — 并发语义（TASK-050）", () => {
  /** 挂起至 abort 的桩生成器 */
  const hangUntilAbort: GenFactory = (signal) =>
    (async function* () {
      yield { type: "text_delta", messageId: "m", delta: "part-1" };
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve());
      });
      yield { type: "turn_end", stepCount: 1, durationMs: 1 };
    })();

  it("运行中的会话 claimTurn 默认拒绝（reason: running）", async () => {
    const hub = makeHub(hangUntilAbort);
    const first = await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "p1" });
    expect(first.ok).toBe(true);

    const second = await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "p2" });
    expect(second).toEqual({ ok: false, reason: "running" });

    hub.abort("s1");
  });

  it("preempt 顶替：旧轮抽干完成后新轮启动，runningCount 随之变化", async () => {
    let oldDrained = false;
    const hub = makeHub((signal) =>
      (async function* () {
        yield { type: "text_delta", messageId: "m", delta: "old" };
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve());
        });
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
        oldDrained = true;
      })()
    );

    await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "old" });
    await sleep(10);
    expect(hub.runningCount()).toBe(1);

    const claim = await hub.claimTurn(
      { sessionId: "s1", workspaceId: "w", prompt: "new" },
      { preempt: true }
    );
    expect(claim.ok).toBe(true);
    // 旧轮已抽干完成（顶替等待语义）
    expect(oldDrained).toBe(true);
    // 新轮在跑
    expect(hub.isRunning("s1")).toBe(true);
    expect(hub.runningCount()).toBe(1);

    hub.abort("s1");
    expect(await hub.waitForDrain("s1", 1000)).toBe(true);
    expect(hub.runningCount()).toBe(0);
  });

  it("preempt 超时：旧轮无视 abort 不抽干 → reason: preempt_timeout", async () => {
    // 无视 abort 的桩：永不响应中止信号
    let stubbornDrained = false;
    const hub = makeHub(() =>
      (async function* () {
        yield { type: "text_delta", messageId: "m", delta: "stubborn" };
        await sleep(5000);
        stubbornDrained = true;
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      })()
    );

    await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "old" });
    const claim = await hub.claimTurn(
      { sessionId: "s1", workspaceId: "w", prompt: "new" },
      { preempt: true, preemptTimeoutMs: 80 }
    );
    expect(claim).toEqual({ ok: false, reason: "preempt_timeout" });
    await sleep(30);
    // 旧轮未抽干（仍挂在 5s sleep 中）；isRunning 对已中止 run 返回 false（既有语义）
    expect(stubbornDrained).toBe(false);
  });

  it("waitForDrain：无活跃轮次立即 true；活跃轮次抽干后 true", async () => {
    const hub = makeHub(hangUntilAbort);
    expect(await hub.waitForDrain("ghost", 100)).toBe(true); // 无此轮次

    await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "p" });
    const pending = hub.waitForDrain("s1", 2000);
    await sleep(10);
    hub.abort("s1");
    expect(await pending).toBe(true);
  });
});

/** 路由级测试用：挂起至 abort 的 MockDriver（isMock=true 跳过沙箱分支） */
class HangingDriver extends MockDriver implements IModelDriver {
  override async *generateStream(req: ModelDriverRequest): AsyncGenerator<ModelStreamChunk> {
    yield { type: "text_delta", text: "hanging" };
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 120_000);
      req.abortSignal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
    if (req.abortSignal?.aborted) throw new Error("aborted");
    yield { type: "text_delta", text: "never" };
  }
}

describe("POST /api/chat 同会话并发（路由级，TASK-050）", () => {
  async function setupServer() {
    const driver = new MemoryStorageDriver();
    const { app } = createHarnessServer({
      storageDriver: driver,
      modelDriver: new HangingDriver(),
    });
    const ws = await (await app.request("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ws", rootPath: "/tmp", permission: "read-write" }),
    })).json();
    return { app, workspaceId: ws.id as string };
  }

  it("会话运行中第二条 POST → 409 SESSION_RUNNING，不产生新 turn", async () => {
    const { app, workspaceId } = await setupServer();
    const sess = await (await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, title: "s" }),
      })).json();

    // 第一条：后台启动（挂起）
    const first = app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, sessionId: sess.id, prompt: "第一条" }),
    });
    await sleep(150);

    // 第二条：默认拒绝
    const second = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, sessionId: sess.id, prompt: "第二条" }),
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.code).toBe("SESSION_RUNNING_REJECTED");

    // 中止第一条并等待抽干落库
    await app.request("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sess.id }),
    });
    await sleep(100);
    void first; // 挂起的 SSE 连接由测试进程回收

    const after = await (await app.request(`/api/sessions/${sess.id}`)).json();
    expect(after.turns.length).toBe(1); // 第二条未产生 turn
    expect(after.turns[0].status).toBe("error"); // 第一条被中止落库
  });

  it("preempt:true 顶替 → 旧轮中止落库，新轮正常执行", async () => {
    const { app, workspaceId } = await setupServer();
    const sess = await (await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, title: "s" }),
      })).json();

    void app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, sessionId: sess.id, prompt: "旧轮" }),
    });
    await sleep(150);

    const second = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, sessionId: sess.id, prompt: "新轮", preempt: true }),
    });
    expect(second.status).toBe(200);
    // 新轮同样由 HangingDriver 驱动（挂起）——主动中止使其收尾
    await sleep(100);
    await app.request("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sess.id }),
    });
    await second.text(); // [DONE] 到达后流完成
    await sleep(100);

    const after = await (await app.request(`/api/sessions/${sess.id}`)).json();
    expect(after.turns.length).toBe(2);
    expect(after.turns[0].status).toBe("error"); // 旧轮被顶替中止
    expect(after.turns[0].prompt).toBe("旧轮");
    expect(["error", "done"]).toContain(after.turns[1].status); // 新轮已收尾
    expect(after.turns[1].prompt).toBe("新轮");
  }, 15_000);
});
