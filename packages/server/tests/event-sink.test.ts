import { describe, it, expect, afterEach, vi } from "vitest";
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
import {
  compositeSink,
  createConsoleNdjsonSink,
  levelForEvent,
  shouldLog,
  type HarnessEventSink,
  type HarnessOpsEvent,
} from "../src/core/event-sink.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";
import type { HarnessTool } from "../src/core/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 内存收集 sink */
function memorySink(): HarnessEventSink & { events: HarnessOpsEvent[] } {
  const events: HarnessOpsEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

describe("运维事件出口（TASK-051）", () => {
  /** injected=null 表示不注入模型驱动（loop 按档案自建真驱动，走生产路径） */
  async function setupLoop(sink: HarnessEventSink, injected: IModelDriver | null = new MockDriver()) {
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
      ...(injected ? { modelDriver: injected } : {}),
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
    // 不注入模型驱动：loop 按档案 apiKey/baseUrl 自建真驱动，
    // baseUrl 指向不可达端口 → ECONNREFUSED → network 分类
    const { loop, session, ws, settingsRepo } = await setupLoop(sink, null);
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
    override async *generateStream(req: ModelDriverRequest): AsyncGenerator<ModelStreamChunk> {
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

    // 恢复扫描随 createHarnessServer 触发：预置 running 行后创建实例即扫描
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
    const sess = await (
      await app2.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, title: "s" }),
      })
    ).json();
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

  it("沙箱演示分支：turn_start 与 turn_finish 配对（TASK-060：此前直接 return 绕过收尾）", async () => {
    const sink = memorySink();
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws = await workspaceRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "demo" });
    // 无 apiKey 的档案（分支条件之一：hasApiKey=false）
    await settingsRepo.createProfile({
      id: "p1",
      name: "P",
      provider: "openai",
      model: "m",
      isDefault: true,
    });
    // 未注入模型驱动 + 无 API Key → 进入沙箱演示分支
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      eventSink: sink,
    });

    const prevEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      for await (const _ of loop.runTurn({ sessionId: session.id, workspaceId: ws.id, prompt: "演示" })) {
        // drain
      }
    } finally {
      if (prevEnv !== undefined) process.env.OPENAI_API_KEY = prevEnv;
    }

    const types = sink.events.map((e) => e.type);
    expect(types[0]).toBe("turn_start");
    expect(types[types.length - 1]).toBe("turn_finish");
    const finish = sink.events[sink.events.length - 1] as Extract<
      HarnessOpsEvent,
      { type: "turn_finish" }
    >;
    expect(finish.status).toBe("done");
    expect(finish.stepCount).toBe(1);
  });
});

describe("LOG_LEVEL 门控（TASK-096）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shouldLog：缺省 info（仅 debug 静默）；LOG_LEVEL=error 只放行 error；debug 全放行", () => {
    // 未设（空串与 undefined 同口径）
    vi.stubEnv("LOG_LEVEL", "");
    expect(shouldLog("debug")).toBe(false);
    expect(shouldLog("info")).toBe(true);
    expect(shouldLog("warn")).toBe(true);
    expect(shouldLog("error")).toBe(true);

    vi.stubEnv("LOG_LEVEL", "error");
    expect(shouldLog("error")).toBe(true);
    expect(shouldLog("warn")).toBe(false);
    expect(shouldLog("info")).toBe(false);
    expect(shouldLog("debug")).toBe(false);

    vi.stubEnv("LOG_LEVEL", "debug");
    expect(shouldLog("debug")).toBe(true);
    expect(shouldLog("info")).toBe(true);
    expect(shouldLog("warn")).toBe(true);
    expect(shouldLog("error")).toBe(true);
  });

  it("shouldLog：非法值 fail-safe 回落 info，大小写不敏感", () => {
    vi.stubEnv("LOG_LEVEL", "VERBOSE");
    expect(shouldLog("debug")).toBe(false);
    expect(shouldLog("info")).toBe(true);

    vi.stubEnv("LOG_LEVEL", "WARN");
    expect(shouldLog("info")).toBe(false);
    expect(shouldLog("warn")).toBe(true);

    // 显式 raw 覆盖 env（供调用方注入非环境来源的配置）；raw=undefined 走默认参数回落 env（当前 stub 为 WARN）
    expect(shouldLog("error", "error")).toBe(true);
    expect(shouldLog("info", "error")).toBe(false);
    expect(shouldLog("info", undefined)).toBe(false);
    expect(shouldLog("warn", undefined)).toBe(true);
  });

  it("levelForEvent：error/abort=error；warn/重试/降级/失败工具=warn；其余=info", () => {
    const base = { at: 1, sessionId: "s", turnId: "t" };
    expect(levelForEvent({ type: "error", ...base, code: "TURN_PERSIST_FAILED" })).toBe("error");
    expect(levelForEvent({ type: "abort", ...base, reason: "user", code: "TURN_ABORTED" })).toBe(
      "error"
    );
    expect(
      levelForEvent({ type: "turn_finish", ...base, status: "error", stepCount: 1, durationMs: 1 })
    ).toBe("error");
    expect(levelForEvent({ type: "warn", ...base, code: "RECOVERED_TURNS" })).toBe("warn");
    expect(
      levelForEvent({
        type: "tool_result",
        ...base,
        tool: "bash_run",
        ok: false,
        durationMs: 1,
      })
    ).toBe("warn");
    expect(
      levelForEvent({
        type: "model_retry",
        at: 1,
        attempt: 1,
        errorClass: "server",
        delayMs: 0,
        reason: "500",
      })
    ).toBe("warn");
    expect(
      levelForEvent({ type: "turn_start", ...base, model: "m" })
    ).toBe("info");
    expect(
      levelForEvent({ type: "turn_finish", ...base, status: "done", stepCount: 1, durationMs: 1 })
    ).toBe("info");
    expect(
      // 中止后 done + code → warn（abort 本体已在 error 级可见，收尾行降为 warn 不双倍告警）
      levelForEvent({
        type: "turn_finish",
        ...base,
        status: "done",
        stepCount: 1,
        durationMs: 1,
        code: "TURN_ABORTED",
      })
    ).toBe("warn");
  });

  it("createConsoleNdjsonSink：LOG_LEVEL=error 静默 info 事件，error 事件走 stderr", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = createConsoleNdjsonSink();

    sink.emit({ type: "turn_start", at: 1, sessionId: "s", turnId: "t" });
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();

    sink.emit({ type: "error", at: 2, code: "TURN_PERSIST_FAILED" });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const emitted = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as { type: string };
    expect(emitted.type).toBe("error");
  });

  it("createConsoleNdjsonSink：缺省（未设 LOG_LEVEL）与历史行为一致——info 事件仍输出到 stdout", () => {
    vi.stubEnv("LOG_LEVEL", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createConsoleNdjsonSink().emit({ type: "turn_start", at: 1, sessionId: "s", turnId: "t" });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).not.toHaveBeenCalled();
    const emitted = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as { type: string };
    expect(emitted.type).toBe("turn_start");
  });
});
