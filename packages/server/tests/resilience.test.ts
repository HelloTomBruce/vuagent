import { describe, it, expect, vi, afterEach } from "vitest";
import {
  classifyModelError,
  isRetriableErrorClass,
  parseRetryAfterMs,
  resolveResiliencePolicy,
  createResilientFetch,
  backoffDelay,
  combineAbortSignals,
  ClassifiedModelError,
  formatModelErrorDetail,
  type ResolvedResiliencePolicy,
} from "../src/adapters/resilience.js";
import { OpenAICompatibleDriver } from "../src/adapters/openai-driver.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";
import type { HarnessStreamEvent } from "../src/core/types.js";

const immediatePolicy: ResolvedResiliencePolicy = {
  maxRetries: 2,
  backoffBaseMs: 0,
  requestTimeoutMs: 0,
};

/** 构造指定状态码的 Response（body 为空流） */
function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("classifyModelError（七分类）", () => {
  it("Response 状态码分类", () => {
    expect(classifyModelError(res(401))).toBe("auth");
    expect(classifyModelError(res(403))).toBe("auth");
    expect(classifyModelError(res(429))).toBe("rate_limit");
    expect(classifyModelError(res(500))).toBe("server");
    expect(classifyModelError(res(502))).toBe("server");
    expect(classifyModelError(res(529))).toBe("server");
    expect(classifyModelError(res(404))).toBe("bad_request");
    expect(classifyModelError(res(400, {}))).toBe("bad_request");
  });

  it("400 + context length 消息 → context_overflow", () => {
    const err = Object.assign(new Error("This model's maximum context length is 8192 tokens"), {
      status: 400,
    });
    expect(classifyModelError(err)).toBe("context_overflow");
  });

  it("带 status 属性的异常", () => {
    expect(classifyModelError(Object.assign(new Error("x"), { status: 429 }))).toBe("rate_limit");
    expect(classifyModelError(Object.assign(new Error("x"), { statusCode: 503 }))).toBe("server");
  });

  it("fetch reject TypeError 与 undici 错误码 → network（含 cause 链）", () => {
    expect(classifyModelError(new TypeError("fetch failed"))).toBe("network");
    expect(classifyModelError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe("network");
    expect(
      classifyModelError(Object.assign(new Error("x"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }))
    ).toBe("network");
  });

  it("旧版包装错误消息兜底（历史抛出路径兼容）", () => {
    expect(classifyModelError(new Error("模型 API 返回错误 (429 Too Many Requests): {…}"))).toBe("rate_limit");
    expect(classifyModelError(new Error("模型 API 返回错误 (401 Unauthorized): {}"))).toBe("auth");
    expect(classifyModelError(new Error("连接模型 API [http://x] 失败: boom"))).toBe("network");
  });

  it("ClassifiedModelError 原样保留 class；null/未知 → unknown", () => {
    const cm = new ClassifiedModelError("x", "rate_limit", 429);
    expect(classifyModelError(cm)).toBe("rate_limit");
    expect(classifyModelError(null)).toBe("unknown");
    expect(classifyModelError(new Error("whatever"))).toBe("unknown");
  });
});

describe("isRetriableErrorClass", () => {
  it("仅 rate_limit/server/network 可重试", () => {
    expect(isRetriableErrorClass("rate_limit")).toBe(true);
    expect(isRetriableErrorClass("server")).toBe(true);
    expect(isRetriableErrorClass("network")).toBe(true);
    expect(isRetriableErrorClass("auth")).toBe(false);
    expect(isRetriableErrorClass("bad_request")).toBe(false);
    expect(isRetriableErrorClass("context_overflow")).toBe(false);
    expect(isRetriableErrorClass("unknown")).toBe(false);
  });
});

describe("parseRetryAfterMs（三分支 + 钳制）", () => {
  const now = 1_000_000;

  it("秒数形态", () => {
    expect(parseRetryAfterMs("30", now)).toBe(30_000);
    expect(parseRetryAfterMs(" 5 ", now)).toBe(5_000);
    expect(parseRetryAfterMs("-3", now)).toBe(0); // 负数钳 0
    expect(parseRetryAfterMs("999", now)).toBe(60_000); // 上限 60s
  });

  it("HTTP-date 形态（now 可注入）", () => {
    const future = new Date(now + 10_000).toUTCString();
    expect(parseRetryAfterMs(future, now)).toBe(10_000);
    const past = new Date(now - 10_000).toUTCString();
    expect(parseRetryAfterMs(past, now)).toBe(0);
  });

  it("非法值返回 undefined（回落指数退避）", () => {
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
    expect(parseRetryAfterMs("", now)).toBeUndefined();
    expect(parseRetryAfterMs("soon", now)).toBeUndefined();
  });
});

describe("resolveResiliencePolicy（钳制）", () => {
  it("缺省策略", () => {
    const p = resolveResiliencePolicy(undefined);
    expect(p.maxRetries).toBe(2);
    expect(p.backoffBaseMs).toBe(1000);
    expect(p.requestTimeoutMs).toBe(60_000);
  });

  it("越界钳制：retries 0–5 / timeout 5s–300s", () => {
    expect(resolveResiliencePolicy({ maxRetries: 99 }).maxRetries).toBe(5);
    expect(resolveResiliencePolicy({ maxRetries: -3 }).maxRetries).toBe(0);
    expect(resolveResiliencePolicy({ requestTimeoutMs: 1 }).requestTimeoutMs).toBe(5_000);
    expect(resolveResiliencePolicy({ requestTimeoutMs: 999_999 }).requestTimeoutMs).toBe(300_000);
  });

  it("false → 全零关闭形态", () => {
    expect(resolveResiliencePolicy(false)).toEqual({
      maxRetries: 0,
      backoffBaseMs: 0,
      requestTimeoutMs: 0,
    });
  });

  it("指数退避公式：base * 2^n + jitter ∈ [0, 500]", () => {
    for (let i = 0; i < 20; i++) {
      const d = backoffDelay(1000, 2);
      expect(d).toBeGreaterThanOrEqual(4000);
      expect(d).toBeLessThanOrEqual(4500);
    }
  });
});

describe("createResilientFetch", () => {
  const sleep = () => Promise.resolve();
  const hooks = { sleep };

  it("2xx 原样透传，无重试", async () => {
    let calls = 0;
    const f = createResilientFetch(
      async () => {
        calls++;
        return res(200);
      },
      immediatePolicy,
      hooks
    );
    const r = await f("http://x");
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("500 后 200 → 重试一次后成功", async () => {
    let calls = 0;
    const retries: number[] = [];
    const f = createResilientFetch(
      async () => {
        calls++;
        return calls === 1 ? res(500) : res(200);
      },
      immediatePolicy,
      { sleep, onRetry: (i) => retries.push(i.attempt) }
    );
    const r = await f("http://x");
    expect(r.status).toBe(200);
    expect(calls).toBe(2);
    expect(retries).toEqual([1]);
  });

  it("重试用尽仍 500 → 原样返回响应由调用方分类", async () => {
    let calls = 0;
    const f = createResilientFetch(
      async () => {
        calls++;
        return res(500);
      },
      immediatePolicy,
      hooks
    );
    const r = await f("http://x");
    expect(r.status).toBe(500);
    expect(calls).toBe(3); // 1 + maxRetries(2)
  });

  it("401 auth 不可重试 → 立即返回不重试", async () => {
    let calls = 0;
    const f = createResilientFetch(
      async () => {
        calls++;
        return res(401);
      },
      immediatePolicy,
      hooks
    );
    const r = await f("http://x");
    expect(r.status).toBe(401);
    expect(calls).toBe(1);
  });

  it("429 尊重 Retry-After：delay 取 max(retryAfter, backoff)", async () => {
    let calls = 0;
    let capturedDelay = 0;
    const f = createResilientFetch(
      async () => {
        calls++;
        return calls === 1 ? res(429, { "retry-after": "7" }) : res(200);
      },
      { ...immediatePolicy, backoffBaseMs: 100 },
      {
        sleep: async (ms) => {
          capturedDelay = ms;
        },
      }
    );
    await f("http://x");
    // retry-after 7s > backoff(100*2^0+jitter≤500 = ≤600ms) → 取 7000
    expect(capturedDelay).toBe(7000);
  });

  it("fetch reject（network）→ 重试后成功", async () => {
    let calls = 0;
    const f = createResilientFetch(
      async () => {
        calls++;
        if (calls === 1) throw new TypeError("fetch failed");
        return res(200);
      },
      immediatePolicy,
      hooks
    );
    const r = await f("http://x");
    expect(r.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("调用方主动 abort → 立即上抛不重试", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const f = createResilientFetch(
      async (_input, init) => {
        calls++;
        // 模拟 fetch 对已中止 signal 的行为
        if (init?.signal?.aborted) throw new Error("This operation was aborted");
        return res(200);
      },
      immediatePolicy,
      hooks
    );
    await expect(f("http://x", { signal: controller.signal })).rejects.toThrow("aborted");
    // R4 循环顶部 abort 检查：预中止信号不再发起任何请求（此前会发一次必失败请求）
    expect(calls).toBe(0);
  });

  it("响应头前超时 → 按 network 重试，用尽后上抛", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      // 永不返回响应的 fetch：仅在 signal 中止时 reject
      const neverFetch = (async (_input: unknown, init?: RequestInit) => {
        calls++;
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }) as typeof fetch;
      const f = createResilientFetch(
        neverFetch,
        { maxRetries: 1, backoffBaseMs: 0, requestTimeoutMs: 5_000 },
        { sleep: () => Promise.resolve() }
      );
      const pending = f("http://x");
      const assertTask = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5_000 + 1);
      await vi.advanceTimersByTimeAsync(5_000 + 1);
      await assertTask;
      expect(calls).toBe(2); // 超时按 network 重试了一次
    } finally {
      vi.useRealTimers();
    }
  });
});

/** SSE 流 mock fetch：返回 OpenAI chat.completions 流式响应 */
function sseFetch(chunks: Array<Record<string, unknown>>, status = 200): typeof fetch {
  return (async () => {
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    return new Response(stream, {
      status,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
}

describe("OpenAICompatibleDriver 韧性集成", () => {
  const sseChunk = {
    choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
  };

  it("流式 happy path 经韧性 fetch 正常解析", async () => {
    const driver = new OpenAICompatibleDriver("sk-test", "http://x/v1", {
      fetchImpl: sseFetch([sseChunk]),
    });
    const chunks: ModelStreamChunk[] = [];
    for await (const c of driver.generateStream({ model: "m", messages: [] })) {
      chunks.push(c);
    }
    expect(chunks.some((c) => c.type === "text_delta" && c.text === "hello")).toBe(true);
    expect(chunks.some((c) => c.type === "done")).toBe(true);
  });

  it("429 重试用尽 → ClassifiedModelError(rate_limit)", async () => {
    let calls = 0;
    const driver = new OpenAICompatibleDriver("sk-test", "http://x/v1", {
      fetchImpl: (async () => {
        calls++;
        return res(429);
      }) as typeof fetch,
      resilience: { maxRetries: 2, backoffBaseMs: 0 },
    });
    await expect(async () => {
      for await (const _ of driver.generateStream({ model: "m", messages: [] })) {
        // drain
      }
    }).rejects.toMatchObject({ errorClass: "rate_limit", status: 429 });
    expect(calls).toBe(3); // 1 + maxRetries(2)
  });

  it("流读取中断 → ClassifiedModelError（诚实边界，不透明重跑）", async () => {
    // 响应头正常但 body 中途抛网络层错误（带 undici 错误码，可分类）
    const brokenFetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(sseChunk)}\n\n`));
        },
        pull(controller) {
          controller.error(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }));
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const driver = new OpenAICompatibleDriver("sk-test", "http://x/v1", {
      fetchImpl: brokenFetch,
      resilience: { maxRetries: 3, backoffBaseMs: 0 },
    });
    const received: ModelStreamChunk[] = [];
    await expect(async () => {
      for await (const c of driver.generateStream({ model: "m", messages: [] })) {
        received.push(c);
      }
    }).rejects.toMatchObject({ errorClass: "network" });
    // 已吐出的增量被上层消费过（证明不透明重跑：重试会使 text_delta 重复出现）
    const textDeltas = received.filter((c) => c.type === "text_delta");
    expect(textDeltas.length).toBeLessThanOrEqual(1);
  });
});

/** 卡死在流中的测试桩：吐一个增量后挂起，直到 abort 才继续/抛错。
 *  继承 MockDriver 以复用 agent-loop 的 isMock 判定（非 Mock driver 会被逐步重建替换）。 */
class HangingAfterFirstChunkDriver extends MockDriver implements IModelDriver {
  override async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    yield { type: "text_delta", text: "partial" };
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
    if (req.abortSignal?.aborted) throw new Error("Stream aborted by signal");
    yield { type: "text_delta", text: "never" };
  }
}

describe("AgentLoop 整轮看门狗（TASK-048）", () => {
  async function setup(modelDriver: IModelDriver) {
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
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      modelDriver,
    });
    return { loop, sessionRepo, session, ws };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("看门狗超时：卡死的模型流被中止，错误消息带超时口径，轮次落库为 error", async () => {
    vi.useFakeTimers();
    const { loop, sessionRepo, session } = await setup(new HangingAfterFirstChunkDriver());
    const events: HarnessStreamEvent[] = [];
    const consumption = (async () => {
      for await (const ev of loop.runTurn(
        { sessionId: session.id, workspaceId: (await sessionRepo.get(session.id))!.workspaceId, prompt: "hi", timeoutMs: 40_000 },
        undefined
      )) {
        events.push(ev);
      }
    })();

    // 推进到看门狗触发点（req.timeoutMs=40s，钳制下限 30s 之上）
    await vi.advanceTimersByTimeAsync(40_001);
    await consumption;

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { message: string }).message).toContain("超时");
    expect((errorEvent as { message: string }).message).toContain("看门狗");

    const after = await sessionRepo.get(session.id);
    expect(after!.turns.length).toBe(1);
    expect(after!.turns[0].status).toBe("error");
    expect(after!.turns[0].content).toContain("partial"); // 已完成的增量保留
  }, 15_000);

  it("客户端中止（非看门狗）：错误消息不带超时口径", async () => {
    const { loop, sessionRepo, session } = await setup(new HangingAfterFirstChunkDriver());
    const controller = new AbortController();
    const events: HarnessStreamEvent[] = [];
    const consumption = (async () => {
      for await (const ev of loop.runTurn(
        { sessionId: session.id, workspaceId: (await sessionRepo.get(session.id))!.workspaceId, prompt: "hi" },
        controller.signal
      )) {
        events.push(ev);
      }
    })();

    // 等首个增量到达后再中止（确保已卡在模型流 await 上）
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "text_delta")).toBe(true);
    });
    controller.abort();
    await consumption;

    const errorEvent = events.find((e) => e.type === "error") as { message: string } | undefined;
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).not.toContain("看门狗");
    expect(errorEvent!.message).not.toContain("超时");

    const after = await sessionRepo.get(session.id);
    expect(after!.turns.length).toBe(1);
  }, 15_000);

  it("req.timeoutMs 低于 30s 下限时被钳制（仍会触发，只是不早于 30s）——此处仅验证解析不抛错", async () => {
    vi.useFakeTimers();
    const { loop, sessionRepo, session } = await setup(new HangingAfterFirstChunkDriver());
    const events: HarnessStreamEvent[] = [];
    const consumption = (async () => {
      for await (const ev of loop.runTurn(
        { sessionId: session.id, workspaceId: (await sessionRepo.get(session.id))!.workspaceId, prompt: "hi", timeoutMs: 1 },
        undefined
      )) {
        events.push(ev);
      }
    })();
    // 1ms 被钳到 30s → 30s 内不应触发；推进到 29.9s 验证尚未中止
    await vi.advanceTimersByTimeAsync(29_900);
    expect(events.some((e) => e.type === "error" && String((e as { message?: string }).message).includes("超时"))).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await consumption;
    expect(events.some((e) => e.type === "error")).toBe(true);
  }, 15_000);
});

// ==========================================================================
// TASK-060 O2：combineAbortSignals 已 @deprecated（实现委托原生 AbortSignal.any，
// 消除手写监听器累积隐患）——保留行为回归：任一触发即触发 + reason 透传
// ==========================================================================
describe("combineAbortSignals（deprecated，委托 AbortSignal.any）", () => {
  it("任一输入触发即触发，reason 透传", () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined.aborted).toBe(false);
    const reason = new Error("timeout fired");
    b.abort(reason);
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe(reason);
  });

  it("预先已中止的输入立即使组合 signal 中止", () => {
    const a = new AbortController();
    a.abort(new Error("already aborted"));
    const b = new AbortController();
    const combined = combineAbortSignals(a.signal, b.signal);
    expect(combined.aborted).toBe(true);
  });
});

describe("formatModelErrorDetail 友好错误信息提取", () => {
  it("从标准 JSON error.message 提取清晰提示", () => {
    const raw = JSON.stringify({
      error: {
        message: "Invalid API key provided",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
    expect(formatModelErrorDetail(raw)).toBe("[invalid_request_error] Invalid API key provided");
  });

  it("支持提取顶层 detail 或 msg 字段", () => {
    expect(formatModelErrorDetail(JSON.stringify({ detail: "Token limit exceeded" }))).toBe("Token limit exceeded");
    expect(formatModelErrorDetail(JSON.stringify({ msg: "服务开小差了", code: 500 }))).toBe("[500] 服务开小差了");
  });

  it("非 JSON 文本安全回落原始字符串", () => {
    expect(formatModelErrorDetail("502 Bad Gateway nginx")).toBe("502 Bad Gateway nginx");
    expect(formatModelErrorDetail("")).toBe("无详细错误响应体");
  });
});
