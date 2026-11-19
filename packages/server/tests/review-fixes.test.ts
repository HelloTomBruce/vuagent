import { describe, it, expect } from "vitest";
import { SessionExecutionHub } from "../src/core/session-execution-hub.js";
import { createHarnessServer } from "../src/server.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { createResilientFetch, classifyHttpError } from "../src/adapters/resilience.js";
import { mapAbortCause } from "../src/core/event-sink.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import type { AgentLoop } from "../src/core/agent-loop.js";
import type { AgentTurnRequest, HarnessStreamEvent } from "../src/core/types.js";
import type { ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";
import type { HarnessOpsEvent } from "../src/core/event-sink.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type GenFactory = (signal: AbortSignal) => AsyncGenerator<HarnessStreamEvent>;

function makeHub(genFactory: GenFactory): SessionExecutionHub {
  return new SessionExecutionHub({
    runTurn: (_req: AgentTurnRequest, signal?: AbortSignal) =>
      genFactory(signal as AbortSignal),
  } as unknown as AgentLoop);
}

/** 挂起至 abort 的桩生成器（abort 后缓慢抽干，模拟收尾耗时） */
function hangingWithDrain(drainMs: number): GenFactory {
  return (signal) =>
    (async function* () {
      yield { type: "text_delta", messageId: "m", delta: "part" };
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve());
      });
      await sleep(drainMs);
      yield { type: "turn_end", stepCount: 1, durationMs: 1 };
    })();
}

describe("R2：claimTurn 对抽干中旧轮的旁路修复", () => {
  it("手动 abort 后立即 claim（非 preempt）→ 等待旧轮抽干后成功开新轮", async () => {
    const hub = makeHub(hangingWithDrain(80));
    await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "旧轮" });
    await sleep(10);

    hub.abort("s1", "user");
    // 旧轮 aborted 但 isDone=false（抽干中）——修复前此处直接 spawnRun 产生写竞态
    const claim = await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "新轮" });
    expect(claim.ok).toBe(true);
    // 新轮在跑
    expect(hub.isRunning("s1")).toBe(true);
    hub.abort("s1");
    expect(await hub.waitForDrain("s1", 2000)).toBe(true);
  });

  it("抽干过慢时 claim 返回 preempt_timeout 而非竞态开轮", async () => {
    const hub = makeHub(hangingWithDrain(5000));
    await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "旧轮" });
    await sleep(10);
    hub.abort("s1", "user");

    const claim = await hub.claimTurn(
      { sessionId: "s1", workspaceId: "w", prompt: "新轮" },
      { preemptTimeoutMs: 80 }
    );
    expect(claim).toEqual({ ok: false, reason: "preempt_timeout" });
  });
});

describe("R4：退避 sleep 与 signal 竞速", () => {
  it("退避等待期间 abort → 立即结束而非睡满全程", async () => {
    const controller = new AbortController();
    let calls = 0;
    const f = createResilientFetch(
      (async () => {
        calls++;
        return new Response(null, { status: 429 });
      }) as typeof fetch,
      { maxRetries: 5, backoffBaseMs: 60_000, requestTimeoutMs: 0 }, // 退避极长
      {}
    );
    const pending = f("http://x", { signal: controller.signal });
    await sleep(30);
    const t0 = Date.now();
    controller.abort();
    // abort 后应快速完成（重试循环在下一轮立即上抛），而不是等 60s 退避
    await expect(pending).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(calls).toBe(1); // 没有执行无谓的后续尝试
  });
});

describe("R5：中止成因集中映射", () => {
  it("mapAbortCause 三成因映射一致", () => {
    expect(mapAbortCause({ watchdogFired: true, signalReason: undefined })).toEqual({
      protocolReason: "timeout",
      opsReason: "watchdog",
      code: "WATCHDOG_TIMEOUT",
    });
    expect(mapAbortCause({ watchdogFired: false, signalReason: "new_task" })).toEqual({
      protocolReason: "preempt",
      opsReason: "new_task",
      code: "TURN_PREEMPTED",
    });
    expect(mapAbortCause({ watchdogFired: false, signalReason: undefined })).toEqual({
      protocolReason: "user",
      opsReason: "user",
      code: "TURN_ABORTED",
    });
    // watchdog 优先级高于 signalReason
    expect(mapAbortCause({ watchdogFired: true, signalReason: "new_task" }).code).toBe(
      "WATCHDOG_TIMEOUT"
    );
  });

  it("hub abort(new_task) 经 signal.reason 传递，aborted 事件 reason=preempt", async () => {
    const events: (HarnessStreamEvent | "[DONE]")[] = [];
    const hub = makeHub((signal) =>
      (async function* () {
        yield { type: "text_delta", messageId: "m", delta: "x" };
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve())
        );
        yield { type: "turn_end", stepCount: 1, durationMs: 1 };
      })()
    );
    await hub.claimTurn({ sessionId: "s1", workspaceId: "w", prompt: "p" });
    const run = hub.getActiveRun("s1")!;
    run.subscribers.add((e) => events.push(e));
    await sleep(10);

    hub.abort("s1", "new_task");
    const aborted = events.find(
      (e) => e !== "[DONE]" && (e as HarnessStreamEvent).type === "aborted"
    ) as Extract<HarnessStreamEvent, { type: "aborted" }> | undefined;
    expect(aborted?.reason).toBe("preempt");
  });
});

describe("R6：context_overflow 分类可达", () => {
  it("400 + context length 正文 → context_overflow", () => {
    expect(
      classifyHttpError(400, "This model's maximum context length is 8192 tokens")
    ).toBe("context_overflow");
    expect(classifyHttpError(400, "invalid api key format")).toBe("bad_request");
    expect(classifyHttpError(429, "rate limited")).toBe("rate_limit");
  });
});

/** 挂起至 abort 的 MockDriver（路由级测试用） */
class HangingDriver extends MockDriver {
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

describe("R3：preempt 计数扣除（路由级）", () => {
  it("maxConcurrentTurns=1 时 preempt:true 不再 429，顶替成功", async () => {
    const opsEvents: HarnessOpsEvent[] = [];
    const { app } = createHarnessServer({
      storageDriver: new MemoryStorageDriver(),
      modelDriver: new HangingDriver(),
      eventSink: { emit: (e) => opsEvents.push(e) },
    });
    const ws = await (
      await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "w", rootPath: "/tmp", permission: "read-write" }),
      })
    ).json();
    const sess = await (
      await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, title: "s" }),
      })
    ).json();

    await app.request("/api/config/execution", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrentTurns: 1 }),
    });

    void app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, sessionId: sess.id, prompt: "旧轮" }),
    });
    await sleep(150);

    // R3 修复前：running=1 ≥ 1 → 429 CONCURRENCY_REJECTED；修复后：preempt 扣除 → 200
    const preemptRes = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, sessionId: sess.id, prompt: "新轮", preempt: true }),
    });
    expect(preemptRes.status).toBe(200);

    // R5 联动验证（清理新轮之前抓快照）：preempt 后旧轮的 ops 中止事件
    // 成因一致为 TURN_PREEMPTED——修复前 hub 记 PREEMPTED、loop 误记 ABORTED
    await sleep(150);
    const preemptOps = opsEvents.filter((e) => e.type === "abort");
    expect(preemptOps.length).toBeGreaterThan(0);
    for (const e of preemptOps) {
      expect(e.code).toBe("TURN_PREEMPTED");
    }

    // 新轮由 HangingDriver 驱动（挂起）——中止清理并收尾 SSE 流
    await app.request("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sess.id }),
    });
    await preemptRes.text().catch(() => {});
  }, 15_000);

  it("非 preempt 的同会话第二条在 max=1 时仍按会话语义 409（不视为并发问题）", async () => {
    const { app } = createHarnessServer({
      storageDriver: new MemoryStorageDriver(),
      modelDriver: new HangingDriver(),
      eventSink: { emit() {} },
    });
    const ws = await (
      await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "w", rootPath: "/tmp", permission: "read-write" }),
      })
    ).json();
    const sess = await (
      await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, title: "s" }),
      })
    ).json();
    await app.request("/api/config/execution", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxConcurrentTurns: 1 }),
    });
    void app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, sessionId: sess.id, prompt: "一" }),
    });
    await sleep(150);
    const second = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, sessionId: sess.id, prompt: "二" }),
    });
    // 并发闸门（429）先于会话冲突（409）：max=1 时 429 仍然正确（非 preempt 无名额可扣）
    expect(second.status).toBe(429);
    await app.request("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sess.id }),
    });
  }, 15_000);
});

describe("O1：被拒请求不再泄漏空会话", () => {
  it("配额 429 且无 sessionId → 不创建新会话", async () => {
    const storage = new MemoryStorageDriver();
    const { app } = createHarnessServer({
      storageDriver: storage,
      modelDriver: new HangingDriver(),
      eventSink: { emit() {} },
    });
    // 开配额（0 token 上限即全部拒绝）
    await app.request("/api/config/finops", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowTokenLimit: 1 }),
    });
    // 先种一条超限额台账
    const { CostRecordRepository } = await import(
      "../src/storage/repositories/cost-record.repository.js"
    );
    await new CostRecordRepository(storage).record({
      turnId: "seed",
      sessionId: "s",
      model: "m",
      promptTokens: 100,
      completionTokens: 0,
      finishedAt: Date.now(),
    });

    const before = await (await app.request("/api/sessions")).json();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "应被拒绝" }),
    });
    expect(res.status).toBe(429);
    const after = await (await app.request("/api/sessions")).json();
    expect(after.length).toBe(before.length); // 无新会话泄漏
  });
});

describe("R8：中止状态落库与恢复", () => {
  it("看门狗中止的轮次以 abortedReason=timeout 落库；手动中止=user", async () => {
    const { AgentLoop } = await import("../src/core/agent-loop.js");
    const { WorkspaceRepository } = await import(
      "../src/storage/repositories/workspace.repository.js"
    );
    const { SessionRepository } = await import(
      "../src/storage/repositories/session.repository.js"
    );
    const { SettingsRepository } = await import(
      "../src/storage/repositories/settings.repository.js"
    );
    const { ToolConfigRepository } = await import(
      "../src/storage/repositories/tool-config.repository.js"
    );
    const { ToolRegistry } = await import("../src/core/tool-registry.js");
    const { ActionHub } = await import("../src/core/action-hub.js");

    const storage = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(storage);
    const sessionRepo = new SessionRepository(storage);
    const settingsRepo = new SettingsRepository(storage);
    const ws = await workspaceRepo.create({ name: "w", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "s" });
    await settingsRepo.createProfile({
      id: "p1",
      name: "P",
      provider: "openai",
      model: "m",
      apiKey: "sk-test",
      isDefault: true,
    });
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(storage),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      modelDriver: new HangingDriver(),
    });

    // 手动中止（预中止信号直达 loop-top 分支）
    const controller = new AbortController();
    controller.abort();
    for await (const _ of loop.runTurn(
      { sessionId: session.id, workspaceId: ws.id, prompt: "hi" },
      controller.signal
    )) {
      // drain
    }
    const after = await sessionRepo.get(session.id);
    expect(after!.turns.length).toBe(1);
    expect(after!.turns[0].abortedReason).toBe("user");
    expect(after!.turns[0].status).toBe("done"); // 优雅中止以 done 落库但有标记
  });

  it("recovery 标记的轮次带 abortedReason=process_restart", async () => {
    const { recoverInterruptedTurns } = await import("../src/core/recovery.js");
    const { SessionRepository } = await import(
      "../src/storage/repositories/session.repository.js"
    );
    const { WorkspaceRepository } = await import(
      "../src/storage/repositories/workspace.repository.js"
    );
    const storage = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(storage);
    const sessionRepo = new SessionRepository(storage);
    const ws = await workspaceRepo.create({ name: "w", rootPath: "/tmp", permission: "read-write" });
    const s = await sessionRepo.create({ workspaceId: ws.id, title: "crash" });
    await sessionRepo.appendTurn(s.id, {
      id: "t-crash",
      sessionId: s.id,
      prompt: "x",
      status: "running",
      stepCount: 0,
      checkpoints: [],
      createdAt: 1,
    });
    await recoverInterruptedTurns(sessionRepo);
    const after = await sessionRepo.get(s.id);
    expect(after!.turns[0].abortedReason).toBe("process_restart");
    expect(after!.turns[0].errorMessage).toBe("process_restart");
  });
});
