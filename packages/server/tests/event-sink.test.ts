import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { createHarnessServer } from "../src/server.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { OpenAICompatibleDriver } from "../src/adapters/openai-driver.js";
import { recoverInterruptedTurns } from "../src/core/recovery.js";
import {
  compositeSink,
  type HarnessEventSink,
  type HarnessOpsEvent,
} from "../src/core/event-sink.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import type { HarnessTool } from "../src/core/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 内存收集 sink */
function memorySink(): HarnessEventSink & { events: HarnessOpsEvent[] } {
  const events: HarnessOpsEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

describe("运维事件出口（TASK-051）", () => {
  async function setupLoop(sink: HarnessEventSink, mock = new MockDriver()) {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws = await workspaceRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "s" });
    await settingsRepo.createProfile({
      id: "p1",
      name: "P",
      provider: "openai",
      model: "m",
      apiKey: "sk-test",
      isDefault: true,
    });
    const registry = new ToolRegistry();
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: registry,
      actionHub: new ActionHub(),
      modelDriver: mock,
      eventSink: sink,
    });
    return { loop, registry, sessionRepo, session, ws, settingsRepo };
  }

  it("成功轮次：完整事件序列 turn_start → step_finish(es) → turn_finish(done)", async () => {
    const sink = memorySink();
    const mock = new MockDriver();
    mock.setScript({ steps: [[{ type: "text", text: "纯文本" }]] });
    const { loop, session, ws } = await setupLoop(sink, mock);

    for await (const _ of loop.runTurn({ sessionId: session.id, workspaceId: ws.id, prompt: "hi" })) {
      // drain
    }

    const types = sink.events.map((e) => e.type);
    expect(types[0]).toBe("turn_start");
    expect(types).toContain("step_finish");
    expect(types[types.length - 1]).toBe("turn_finish");

    const start = sink.events[0] as Extract<HarnessOpsEvent, { type: "turn_start" }>;
    expect(start.sessionId).toBe(session.id);
    expect(start.model).toBe("m");

    const finish = sink.events[sink.events.length - 1] as Extract<
      HarnessOpsEvent,
      { type: "turn_finish" }
    >;
    expect(finish.status).toBe("done");
    expect(finish.code).toBeUndefined(); // 正常收尾无分类码
    expect(finish.totalTokens).toBeGreaterThan(0);
  });

  it("工具失败：tool_result ok:false + code TOOL_EXECUTION_FAILED", async () => {
    const sink = memorySink();
    const mock = new MockDriver();
    const boom: HarnessTool = {
      name: "boom_probe",
      description: "必失败工具",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("boom");
      },
    };
    const { loop, registry, session, ws } = await setupLoop(sink, mock);
    registry.register(boom);
    mock.setScript({
      steps: [
        [{ type: "tool_call", id: "c1", name: "boom_probe", arguments: {} }],
        [{ type: "text", text: "失败后继续" }],
      ],
    });

    for await (const _ of loop.runTurn({ sessionId: session.id, workspaceId: ws.id, prompt: "hi" })) {
      // drain
    }

    const toolResult = sink.events.find((e) => e.type === "tool_result") as Extract<
      HarnessOpsEvent,
      { type: "tool_result" }
    >;
    expect(toolResult.ok).toBe(false);
    expect(toolResult.code).toBe("TOOL_EXECUTION_FAILED");
    expect(toolResult.error).toContain("boom");

    const finish = sink.events[sink.events.length - 1] as Extract<
      HarnessOpsEvent,
      { type: "turn_finish" }
    >;
    expect(finish.status).toBe("done"); // 工具失败不终结轮次
  });

  it("已分类模型错误：turn_finish error + MODEL_NETWORK 码 + SSE error 带 code", async () => {
    const sink = memorySink();
    // 注入非 Mock driver 使 loop 走真驱动路径（loop 会按 profile.baseUrl 重建真驱动，
    // 注入对象本身不参与执行）；profile 指向不可达端口 → ECONNREFUSED → network
    const { loop, session, ws, settingsRepo } = await setupLoop(sink, {
      generateStream: async function* () {},
    } as never);
    await settingsRepo.updateProfile("p1", { baseUrl: "http://127.0.0.1:9" });

    const events: unknown[] = [];
    for await (const ev of loop.runTurn({ sessionId: session.id, workspaceId: ws.id, prompt: "hi" })) {
      events.push(ev);
    }

    const finish = sink.events[sink.events.length - 1] as Extract<
      HarnessOpsEvent,
      { type: "turn_finish" }
    >;
    expect(finish.status).toBe("error");
    expect(finish.code).toBe("MODEL_NETWORK"); // ECONNREFUSED → network 分类

    const sseError = events.find((e) => (e as { type: string }).type === "error") as {
      code?: string;
    };
    expect(sseError?.code).toBe("MODEL_NETWORK");
  }, 20_000);

  it("轮间中止（预中止信号直达 abort 分支）：abort 事件 + turn_finish code TURN_ABORTED", async () => {
    const sink = memorySink();
    const { loop, session, ws } = await setupLoop(sink);

    const controller = new AbortController();
    controller.abort(); // 预中止：首个 loop-top 检查即命中 abort 分支
    const events: unknown[] = [];
    for await (const ev of loop.runTurn(
      { sessionId: session.id, workspaceId: ws.id, prompt: "hi" },
      controller.signal
    )) {
      events.push(ev);
    }

    const abortEvent = sink.events.find((e) => e.type === "abort") as Extract<
      HarnessOpsEvent,
      { type: "abort" }
    >;
    expect(abortEvent).toBeDefined();
    expect(abortEvent.reason).toBe("user");
    expect(abortEvent.code).toBe("TURN_ABORTED");

    const sseError = events.find((e) => (e as { type: string }).type === "error") as {
      code?: string;
    };
    expect(sseError?.code).toBe("TURN_ABORTED");

    const finish = sink.events.find((e) => e.type === "turn_finish") as Extract<
      HarnessOpsEvent,
      { type: "turn_finish" }
    >;
    expect(finish.status).toBe("done"); // 中止走 break → 正常收尾路径
    expect(finish.code).toBe("TURN_ABORTED"); // code 标记异常收尾
  });
});

describe("OpenAICompatibleDriver onRetry → model_retry 事件（fake fetch 驱动）", () => {
  it("500 → 重试 → 200：sink 捕获 model_retry 事件", async () => {
    const sink = memorySink();
    let calls = 0;
    const driver = new OpenAICompatibleDriver("sk-test", "http://x/v1", {
      fetchImpl: (async () => {
        calls++;
        return calls === 1
          ? new Response(null, { status: 500 })
          : new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
                  c.close();
                },
              }),
              { status: 200, headers: { "Content-Type": "text/event-stream" } }
            );
      }) as typeof fetch,
      resilience: { maxRetries: 2, backoffBaseMs: 0 },
      onRetry: (info) => {
        sink.emit({
          type: "model_retry",
          at: Date.now(),
          attempt: info.attempt,
          errorClass: info.errorClass,
          delayMs: info.delayMs,
          reason: info.reason,
        });
      },
    });

    for await (const _ of driver.generateStream({ model: "m", messages: [] })) {
      // drain
    }

    expect(calls).toBe(2);
    const retry = sink.events[0] as Extract<HarnessOpsEvent, { type: "model_retry" }>;
    expect(retry.type).toBe("model_retry");
    expect(retry.attempt).toBe(1);
    expect(retry.errorClass).toBe("server");
    expect(retry.reason).toContain("500");
  });
});

describe("路由级事件（TASK-051）", () => {
  /** 挂起至 abort 的 MockDriver */
  class HangingDriver extends MockDriver {
    override async *generateStream(req: { abortSignal?: AbortSignal }): AsyncGenerator<{ type: string; text?: string }> {
      yield { type: "text_delta", text: "hanging" };
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 120_000);
        req.abortSignal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (req.abortSignal?.aborted) throw new Error("aborted");
      yield { type: "text_delta", text: "never" };
    }
  }

  it("409 拒绝产生 SESSION_RUNNING_REJECTED warn 事件；恢复扫描产生 RECOVERED_TURNS", async () => {
    const sink = memorySink();
    const storage = new MemoryStorageDriver();
    const { app } = createHarnessServer({
      storageDriver: storage,
      modelDriver: new HangingDriver(),
      eventSink: sink,
    });

    // 预置一个遗留 running 轮次 → 启动恢复扫描应产生 RECOVERED_TURNS
    const wsRepo = new WorkspaceRepository(storage);
    const sessionRepo = new SessionRepository(storage);
    const ws = await wsRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const crashSession = await sessionRepo.create({ workspaceId: ws.id, title: "crash" });
    await sessionRepo.appendTurn(crashSession.id, {
      id: "turn-crash",
      sessionId: crashSession.id,
      prompt: "x",
      status: "running",
      stepCount: 0,
      checkpoints: [],
      createdAt: 1,
    });

    // 新 server 实例的恢复扫描针对同一 storage——重建以触发扫描
    const { app: app2 } = createHarnessServer({
      storageDriver: storage,
      modelDriver: new HangingDriver(),
      eventSink: sink,
    });

    // 等待恢复扫描完成
    await sleep(30);
    const recovered = sink.events.find((e) => e.type === "warn" && e.code === "RECOVERED_TURNS");
    expect(recovered).toBeDefined();

    // 409 路径
    const sess = await app2
      .request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, title: "s" }),
      })
      .then((r) => r.json());
    void app2.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, sessionId: sess.id, prompt: "一" }),
    });
    await sleep(150);
    const second = await app2.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, sessionId: sess.id, prompt: "二" }),
    });
    expect(second.status).toBe(409);
    const rejected = sink.events.find((e) => e.type === "warn" && e.code === "SESSION_RUNNING_REJECTED");
    expect(rejected).toBeDefined();

    // 清理
    await app2.request("/api/chat/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sess.id }),
    });
  });

  it("compositeSink 广播到多个下游", async () => {
    const a = memorySink();
    const b = memorySink();
    const combined = compositeSink(a, b);
    combined.emit({ type: "warn", at: 1, code: "RECOVERED_TURNS" });
    expect(a.events.length).toBe(1);
    expect(b.events.length).toBe(1);
  });
});
