/**
 * TASK-100：HITL 挂起 + 事件缓冲 Redis 外置
 *
 * - ActionPersistStore：挂起写入/列表/清理 + 孤儿决策落账（fake-redis）；
 * - ActionHub persist 钩子：waitForAction 外置、resolve/timeout 清理；
 * - EventLogStore：append ring（LTRIM cap + TTL）+ readAfter seq 过滤；
 * - 路由级：外置挂起出现在 suspended 列表；孤儿 resolve → delivered:false + 决策落账 +
 *   审批卡回写；无活跃 run 带 fromSeq → 外置增量回放（x-vuagent-history-only）。
 */
import { describe, expect, it } from "vitest";
import { ActionHub } from "../src/core/action-hub.js";
import { createRedisActionPersist, createRedisEventLog } from "../src/core/redis-externalize.js";
import { SessionExecutionHub } from "../src/core/session-execution-hub.js";
import { FakeRedis } from "./helpers/fake-redis.js";
import { createHarnessServer } from "../src/server.js";
import type { AgentTurnRequest } from "../src/core/types.js";
import type { HarnessStreamEvent as ProtocolEvent } from "../src/core/types.js";
import type { AgentLoop } from "../src/core/agent-loop.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOCAL_ORIGIN = "http://localhost:5173";
const H = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

const pendingInfo = {
  actionId: "act-1",
  toolName: "bash_run",
  args: { command: "rm -rf /" },
  sessionId: "sess-1",
  createdAt: Date.now(),
  timeoutMs: 180_000,
};

describe("ActionPersistStore（TASK-100）", () => {
  it("savePending → listPending 可见；deletePending 后消失", async () => {
    const client = new FakeRedis();
    const store = createRedisActionPersist(client);
    await store.savePending(pendingInfo);
    const list = await store.listPending();
    expect(list).toHaveLength(1);
    expect(list[0].actionId).toBe("act-1");
    expect(list[0].sessionId).toBe("sess-1");
    expect(list[0].expiresAt).toBeGreaterThan(Date.now());

    await store.deletePending("act-1");
    expect(await store.listPending()).toHaveLength(0);
  });

  it("孤儿决策落账：saveDecision → getDecision 取回；pending 形态不误判为 decision", async () => {
    const client = new FakeRedis();
    const store = createRedisActionPersist(client);
    await store.savePending(pendingInfo);
    expect(await store.getDecision("act-1")).toBeUndefined();

    await store.saveDecision("act-2", { approved: true, note: "post-restart approve" });
    const decision = await store.getDecision("act-2");
    expect(decision?.approved).toBe(true);
    expect(decision?.note).toBe("post-restart approve");
  });
});

describe("ActionHub persist 钩子（TASK-100）", () => {
  it("waitForAction 外置挂起；resolve 后清理；timeout 路径同样清理", async () => {
    const client = new FakeRedis();
    const store = createRedisActionPersist(client);
    const hub = new ActionHub(store);

    const promise = hub.waitForAction("act-a", { toolName: "bash_run", args: {}, sessionId: "s1" });
    await sleep(5);
    expect((await store.listPending()).map((a) => a.actionId)).toContain("act-a");

    hub.resolveAction("act-a", { approved: true });
    const result = await promise;
    expect(result.approved).toBe(true);
    await sleep(5);
    expect((await store.listPending()).map((a) => a.actionId)).not.toContain("act-a");

    // timeout 清理（fake 时钟省略——用极短真实超时验证）
    const shortHub = new ActionHub(store);
    await shortHub.waitForAction("act-b", { toolName: "x", args: {}, timeoutMs: 30 });
    await sleep(60);
    expect((await store.listPending()).map((a) => a.actionId)).not.toContain("act-b");
  });
});

describe("EventLogStore（TASK-100）", () => {
  it("append 写入 ring；readAfter 按 seq 过滤；无 list ops 客户端降级 null", async () => {
    const client = new FakeRedis();
    const log = createRedisEventLog(client, { cap: 3, ttlSeconds: 60 });
    expect(log).not.toBeNull();
    const delta = (n: number) =>
      ({ type: "text_delta", messageId: "m", delta: `d${n}`, seq: n }) as ProtocolEvent & { seq?: number };
    for (let i = 1; i <= 5; i++) await log!.append("s1", delta(i));

    // cap=3：只留最近 3 条（seq 3/4/5）
    const after2 = await log!.readAfter("s1", 2);
    expect(after2.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(after2.gap).toBe(false); // 客户端已见 seq 2，3 无洞 → 连续，非缺口
    const after1 = await log!.readAfter("s1", 1);
    expect(after1.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(after1.gap).toBe(true); // 客户端只见 seq 1，首条 3 > 1+1 → seq 2 缺失，诚实标注
    const caughtUp = await log!.readAfter("s1", 5);
    expect(caughtUp.events).toEqual([]);
    expect(caughtUp.gap).toBe(false); // 追平不算缺口

    // list ops 缺失（无 rpush 的客户端）→ null 降级
    const bare = { get: async () => null } as never;
    expect(createRedisEventLog(bare)).toBeNull();
    void client;
  });

  it("hub 广播同步落外置缓冲（options.eventLog 接线）", async () => {
    const client = new FakeRedis();
    const eventLog = createRedisEventLog(client)!;
    const hub = new SessionExecutionHub({
      runTurn: (_req: AgentTurnRequest, signal?: AbortSignal) =>
        (async function* () {
          yield { type: "text_delta", messageId: "m", delta: "part" };
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else signal!.addEventListener("abort", () => resolve());
          });
          yield { type: "turn_end", stepCount: 1, durationMs: 1 };
        })(),
    } as unknown as AgentLoop, undefined, undefined, { eventLog });

    await hub.claimTurn({ sessionId: "s-log", workspaceId: "w", prompt: "p" });
    await sleep(20);
    expect(client.peekList("vuagent:events:s-log").length).toBeGreaterThan(0);
    hub.abort("s-log");
  });
});

describe("路由级外置语义（TASK-100）", () => {
  function scriptedServer(redis: FakeRedis) {
    return createHarnessServer({ dbPath: ":memory:", redisClient: redis as never });
  }

  it("外置挂起出现在 /api/action/suspended 列表", async () => {
    const redis = new FakeRedis();
    const { app } = scriptedServer(redis);
    const store = createRedisActionPersist(redis);
    await store.savePending({
      actionId: "act-orphan",
      toolName: "bash_run",
      args: {},
      sessionId: "sess-x",
      createdAt: Date.now(),
      timeoutMs: 180_000,
    });
    const res = await app.request("/api/action/suspended", { headers: { Origin: LOCAL_ORIGIN } });
    const list = (await res.json()) as Array<{ actionId: string }>;
    expect(list.map((a) => a.actionId)).toContain("act-orphan");
  });

  it("孤儿 resolve：delivered:false + 决策落账 + 挂起条目清理", async () => {
    const redis = new FakeRedis();
    const { app } = scriptedServer(redis);
    const store = createRedisActionPersist(redis);
    await store.savePending({
      actionId: "act-orphan-2",
      toolName: "bash_run",
      args: {},
      sessionId: undefined,
      createdAt: Date.now(),
      timeoutMs: 180_000,
    });

    const res = await app.request("/api/action/act-orphan-2", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: true, note: "late approval" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; delivered: boolean };
    expect(json.success).toBe(true);
    expect(json.delivered).toBe(false);
    // 决策落账 + 挂起清理
    expect(await store.getDecision("act-orphan-2")).toBeTruthy();
    expect((await store.listPending()).map((a) => a.actionId)).not.toContain("act-orphan-2");
  });

  it("无活跃 run 带 fromSeq：外置增量回放（history-only 标注）后收尾", async () => {
    const redis = new FakeRedis();
    const { app, executionHub } = scriptedServer(redis);
    const eventLog = createRedisEventLog(redis)!;
    // 直接写外置缓冲（模拟重启前的轮次事件）
    await eventLog.append("sess-dead", { type: "text_delta", messageId: "m", delta: "cut", seq: 1 } as never);
    await eventLog.append("sess-dead", { type: "turn_end", stepCount: 1, durationMs: 1, seq: 2 } as never);
    expect(executionHub.getEventLog()).not.toBeNull();

    const res = await app.request("/api/sessions/sess-dead/stream?fromSeq=0", {
      headers: { Origin: LOCAL_ORIGIN },
    });
    expect(res.headers.get("x-vuagent-history-only")).toBe("1");
    const text = await res.text();
    expect(text).toContain('"delta":"cut"');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);

    // 无 fromSeq → 维持 JSON isRunning:false 行为
    const plain = await app.request("/api/sessions/sess-dead/stream", { headers: { Origin: LOCAL_ORIGIN } });
    expect((await plain.json()) as { isRunning: boolean }).toEqual({ isRunning: false });
  });

  it("SQLite 形态（无 redisClient）：外置关闭、suspended/行为与旧版一致", async () => {
    const { app, executionHub } = createHarnessServer({ dbPath: ":memory:" });
    expect(executionHub.getEventLog()).toBeUndefined();
    const res = await app.request("/api/action/suspended", { headers: { Origin: LOCAL_ORIGIN } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
