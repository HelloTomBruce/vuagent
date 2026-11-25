/**
 * TASK-092：session 存储拆表迁移
 *
 * - 旧格式（内联 turns）读时合并，只读不迁移；
 * - 首写惰性迁移：内联 turns 搬行存储，主文档 turns 清空 + turnCount 落账；
 * - updateTurn / recordCheckpoint 拆表后 O(turn)：不再重写整会话（写放大断言）；
 * - 顺序保持（index 排序）+ appendTurn upsert 原位替换；
 * - memory 与 sqlite 双驱动同接口；恢复语义（persistence-recovery）回归绿。
 */
import { describe, expect, it, vi } from "vitest";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { SQLiteStorageDriver, escapeSqlLikePattern } from "../src/storage/drivers/sqlite.driver.js";
import { MetricsRegistry } from "../src/core/metrics-registry.js";
import type { IStorageDriver } from "../src/storage/drivers/base.driver.js";
import type { SessionEntity, TurnEntity } from "../src/storage/interfaces.js";

/** 写观测代理：记录每个 collection 的 set 次数与最近一次主文档写入的载荷体积 */
function countingWrapper(driver: IStorageDriver) {
  const setCounts = new Map<string, number>();
  const lastPayloads = new Map<string, number>();
  return {
    driver: {
      get: (c: string, id: string) => driver.get(c, id),
      set: async (c: string, id: string, v: unknown) => {
        setCounts.set(c, (setCounts.get(c) ?? 0) + 1);
        lastPayloads.set(c, JSON.stringify(v).length);
        await driver.set(c, id, v);
      },
      delete: (c: string, id: string) => driver.delete(c, id),
      list: (c: string) => driver.list(c),
      clear: (c?: string) => driver.clear(c),
    } as IStorageDriver,
    setCounts,
    lastPayloads,
  };
}

function makeTurn(i: number, sessionId: string, content: string): TurnEntity {
  return {
    id: `turn-${i}`,
    sessionId,
    prompt: `prompt ${i}`,
    content,
    status: "done",
    stepCount: 1,
    checkpoints: [{ id: `cp-${i}`, turnId: `turn-${i}`, stepIndex: 1, messagesSnapshot: [], snapshotAt: 1 }],
    cards: [],
    createdAt: 1_000 + i,
    completedAt: 2_000 + i,
  } as unknown as TurnEntity;
}

/** 直写驱动构造旧格式会话（内联 turns，无 turnCount） */
async function seedLegacySession(driver: IStorageDriver, id: string, turnCount: number) {
  const turns = Array.from({ length: turnCount }, (_, i) => makeTurn(i, id, `legacy-${i}`));
  const legacy: SessionEntity = {
    id,
    workspaceId: "ws-1",
    title: "Legacy Session",
    status: "active",
    turns,
    createdAt: 1,
    updatedAt: 1,
  };
  await driver.set("sessions", id, legacy);
  return { legacy, turns };
}

describe("session 存储拆表迁移（TASK-092）· memory 驱动", () => {
  it("旧格式读时合并：get/list 返回内联 turns 原序，不触发迁移", async () => {
    const driver = new MemoryStorageDriver();
    const { turns } = await seedLegacySession(driver, "sess-legacy", 3);
    const repo = new SessionRepository(driver);

    const got = await repo.get("sess-legacy");
    expect(got?.turns.map((t) => t.id)).toEqual(turns.map((t) => t.id));
    const listed = await repo.list();
    expect(listed[0].turns).toHaveLength(3);

    // 只读不迁移：主文档仍是旧格式（内联非空）
    const raw = await driver.get<SessionEntity>("sessions", "sess-legacy");
    expect(raw?.turns).toHaveLength(3);
    expect(raw?.turnCount).toBeUndefined();
  });

  it("首写惰性迁移：appendTurn 后内联 turns 搬行存储、主文档 turns 清空 + turnCount 落账", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-mig", 2);
    const repo = new SessionRepository(driver);

    await repo.appendTurn("sess-mig", makeTurn(99, "sess-mig", "new-turn"));

    const raw = await driver.get<SessionEntity>("sessions", "sess-mig");
    expect(raw?.turns).toEqual([]); // 主文档不再内联
    expect(raw?.turnCount).toBe(3); // 2 迁移 + 1 新增

    const merged = await repo.get("sess-mig");
    expect(merged?.turns.map((t) => t.id)).toEqual(["turn-0", "turn-1", "turn-99"]);
  });

  it("updateTurn 拆表后写放大消除：主文档触碰为小元数据（载荷远小于全量）", async () => {
    const base = new MemoryStorageDriver();
    const { driver, lastPayloads } = countingWrapper(base);
    await seedLegacySession(driver, "sess-big", 200);
    const repo = new SessionRepository(driver);

    // 首写触发迁移（一次性搬库）
    await repo.updateTurn("sess-big", "turn-5", { content: "patched" });
    // 迁移后的主文档写 = 元数据（turns: []）
    const metaPayload = lastPayloads.get("sessions") ?? 0;
    expect(metaPayload).toBeLessThan(2_000); // 200 turns 全量约数十 KB；元数据 < 2KB

    const session = await repo.get("sess-big");
    expect(session?.turns.find((t) => t.id === "turn-5")?.content).toBe("patched");
    expect(session?.turns).toHaveLength(200);
  });

  it("顺序保持 + appendTurn upsert 原位替换", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-ord", 3);
    const repo = new SessionRepository(driver);

    await repo.appendTurn("sess-ord", makeTurn(4, "sess-ord", "appended"));
    await repo.appendTurn("sess-ord", { ...makeTurn(1, "sess-ord", "replaced-in-place") });

    const session = await repo.get("sess-ord");
    expect(session?.turns.map((t) => t.id)).toEqual(["turn-0", "turn-1", "turn-2", "turn-4"]);
    expect(session?.turns[1].content).toBe("replaced-in-place");
    expect(session?.turnCount).toBe(4); // upsert 不递增计数
  });

  it("recordCheckpoint 写单行；delete 连带清理轮次行", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-cp", 2);
    const repo = new SessionRepository(driver);

    await repo.recordCheckpoint("sess-cp", "turn-1", {
      id: "cp-new",
      turnId: "turn-1",
      stepIndex: 2,
      messagesSnapshot: [],
      snapshotAt: Date.now(),
    });
    const after = await repo.get("sess-cp");
    expect(after?.turns.find((t) => t.id === "turn-1")?.checkpoints.map((c) => c.id)).toContain("cp-new");

    await repo.delete("sess-cp");
    expect(await repo.get("sess-cp")).toBeNull();
    // 行存储已清：新仓储装配不出已删轮次
    const freshRepo = new SessionRepository(driver);
    expect((await freshRepo.list()).find((s) => s.id === "sess-cp")).toBeUndefined();
  });

  it("listMeta 只返回主文档元数据（TASK-093 列表瘦身数据源）", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-meta", 5);
    const repo = new SessionRepository(driver);
    await repo.appendTurn("sess-meta", makeTurn(9, "sess-meta", "x")); // 触发迁移

    const metas = await repo.listMeta();
    expect(metas[0].turns).toEqual([]);
    expect(metas[0].turnCount).toBe(6);
  });
});

describe("session 存储拆表迁移（TASK-092）· sqlite 驱动同接口", () => {
  it("旧格式（直写 kv_store）读时合并 + 首写迁移 + updateTurn 单行语义", async () => {
    const driver = new SQLiteStorageDriver(":memory:");
    await seedLegacySession(driver, "sess-sql", 3);
    const repo = new SessionRepository(driver);

    const before = await repo.get("sess-sql");
    expect(before?.turns).toHaveLength(3);

    await repo.updateTurn("sess-sql", "turn-2", { content: "sql-patched" });
    const after = await repo.get("sess-sql");
    expect(after?.turns.find((t) => t.id === "turn-2")?.content).toBe("sql-patched");
    expect(after?.turns).toHaveLength(3);

    const raw = await driver.get<SessionEntity>("sessions", "sess-sql");
    expect(raw?.turns).toEqual([]); // 已迁移为行存储
  });

  it("纯新格式路径：create → appendTurn ×2 → updateTurn → get 全程正确", async () => {
    const driver = new SQLiteStorageDriver(":memory:");
    const repo = new SessionRepository(driver);
    await repo.create({ id: "sess-fresh", workspaceId: "w", title: "Fresh" });
    await repo.appendTurn("sess-fresh", makeTurn(0, "sess-fresh", "t0"));
    await repo.appendTurn("sess-fresh", makeTurn(1, "sess-fresh", "t1"));
    await repo.updateTurn("sess-fresh", "turn-0", { content: "t0-patched" });

    const session = await repo.get("sess-fresh");
    expect(session?.turns.map((t) => t.content)).toEqual(["t0-patched", "t1"]);
    const raw = await driver.get<SessionEntity>("sessions", "sess-fresh");
    expect(raw?.turnCount).toBe(2);
  });
});

/* ==========================================================================
   存储域审查修复回归：
   - C2/R1[Critical] 迁移状态机：水合产物伪装 legacy → 写路径重复搬库/回写全量；
   - R2[Required] 读放大：list 逐 doc 扫全表、单会话装配无前缀下推；
   - R3[Required] registry series 上限保险丝。
   ========================================================================== */

describe("C2/R1 迁移状态机（存储域审查修复）", () => {
  it("C2/① 已迁移会话第二次 appendTurn 不重复搬库：TURNS_COLLECTION set 恰 1 次", async () => {
    const base = new MemoryStorageDriver();
    const { driver, setCounts } = countingWrapper(base);
    await seedLegacySession(driver, "sess-2nd", 6);
    const repo = new SessionRepository(driver);

    await repo.appendTurn("sess-2nd", makeTurn(90, "sess-2nd", "first-append")); // 首写触发迁移
    setCounts.set("session_turns", 0); // 归零，只观察第二次
    await repo.appendTurn("sess-2nd", makeTurn(91, "sess-2nd", "second-append"));

    // 修复前：get() 水合产物（7 turns）伪装 legacy → ensureMigrated 重复搬 7 行
    expect(setCounts.get("session_turns")).toBe(1);
    const session = await repo.get("sess-2nd");
    expect(session?.turns).toHaveLength(8);
  });

  it("C2/② 已迁移会话 updateStatus/update 不回写水合 turns，turnsSplit 保留", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-write", 2);
    const repo = new SessionRepository(driver);
    await repo.appendTurn("sess-write", makeTurn(9, "sess-write", "trigger-migration"));

    await repo.updateStatus("sess-write", "finished");
    let raw = await driver.get<SessionEntity>("sessions", "sess-write");
    expect(raw?.turns).toEqual([]); // 修复前：水合 turns 被回写进主文档
    expect(raw?.turnsSplit).toBe(true); // 显式存储标记透传保留
    expect(raw?.status).toBe("finished");
    expect(raw?.turnCount).toBe(3);

    await repo.update("sess-write", { title: "renamed" });
    raw = await driver.get<SessionEntity>("sessions", "sess-write");
    expect(raw?.turns).toEqual([]);
    expect(raw?.turnsSplit).toBe(true);
    expect(raw?.title).toBe("renamed");
    expect(raw?.turnCount).toBe(3);

    // 读路径不受写路径改动影响
    const session = await repo.get("sess-write");
    expect(session?.turns).toHaveLength(3);
    expect(session?.turnsSplit).toBe(true);
  });

  it("R1/③ legacy 会话经 updateTurn 触发迁移后 raw.turnCount === N", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-r1", 5);
    const repo = new SessionRepository(driver);

    await repo.updateTurn("sess-r1", "turn-2", { content: "patched" });
    const raw = await driver.get<SessionEntity>("sessions", "sess-r1");
    // 修复前：updateTurn 未接住 ensureMigrated 返回值 → turnCount 落 0
    expect(raw?.turnCount).toBe(5);
    expect(raw?.turns).toEqual([]);
    expect(raw?.turnsSplit).toBe(true);

    const session = await repo.get("sess-r1");
    expect(session?.turns.find((t) => t.id === "turn-2")?.content).toBe("patched");
    expect(session?.turns).toHaveLength(5);
  });

  it("R1/③b legacy 会话经 recordCheckpoint 触发迁移后 turnCount 同样落准", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-r1b", 4);
    const repo = new SessionRepository(driver);

    await repo.recordCheckpoint("sess-r1b", "turn-1", {
      id: "cp-x",
      turnId: "turn-1",
      stepIndex: 3,
      messagesSnapshot: [],
      snapshotAt: 1,
    });
    const raw = await driver.get<SessionEntity>("sessions", "sess-r1b");
    expect(raw?.turnCount).toBe(4);
    expect(raw?.turns).toEqual([]);
    expect(raw?.turnsSplit).toBe(true);
  });

  it("无标记 legacy 会话 update/updateStatus 只改元数据：不触发迁移、不丢内联 turns", async () => {
    const driver = new MemoryStorageDriver();
    await seedLegacySession(driver, "sess-legacy-meta", 3);
    const repo = new SessionRepository(driver);

    await repo.update("sess-legacy-meta", { title: "meta-only" });
    let raw = await driver.get<SessionEntity>("sessions", "sess-legacy-meta");
    expect(raw?.turns).toHaveLength(3); // 旧格式保持内联（元数据路径只读不迁移）
    expect(raw?.turnsSplit).toBeUndefined();
    expect(raw?.title).toBe("meta-only");

    await repo.updateStatus("sess-legacy-meta", "paused");
    raw = await driver.get<SessionEntity>("sessions", "sess-legacy-meta");
    expect(raw?.turns).toHaveLength(3);
    expect(raw?.turnsSplit).toBeUndefined();
    expect(raw?.status).toBe("paused");
  });
});

describe("R2 读放大修复（存储域审查）", () => {
  it("list() 行存储只全量读一次（禁逐 doc 各扫一遍全表）", async () => {
    const base = new MemoryStorageDriver();
    const listCalls: string[] = [];
    // 不带 listByPrefix 的观测代理：走仓储回落口径，数 TURNS_COLLECTION 的 list 次数
    const driver: IStorageDriver = {
      get: (c, id) => base.get(c, id),
      set: (c, id, v) => base.set(c, id, v),
      delete: (c, id) => base.delete(c, id),
      list: (c) => {
        listCalls.push(c);
        return base.list(c);
      },
      clear: (c) => base.clear(c),
    };
    const repo = new SessionRepository(driver);
    for (const sid of ["s1", "s2", "s3"]) {
      await repo.create({ id: sid, workspaceId: "w" });
      await repo.appendTurn(sid, makeTurn(0, sid, `t-${sid}`));
    }

    listCalls.length = 0;
    const listed = await repo.list();
    expect(listed).toHaveLength(3);
    expect(listed.flatMap((s) => s.turns)).toHaveLength(3);
    // 修复前：逐 doc 装配各扫一遍全表 → 3 次
    expect(listCalls.filter((c) => c === "session_turns")).toHaveLength(1);
  });

  it("get() 单会话装配优先 listByPrefix（驱动具备该能力时），不扫全表", async () => {
    const sessions = new Map<string, unknown>();
    const turns = new Map<string, unknown>();
    const calls = { turnList: 0, listByPrefix: 0, prefixes: [] as string[] };
    const driver = {
      get: async <T>(c: string, id: string) =>
        (((c === "sessions" ? sessions : turns).get(id) as T | undefined) ?? null),
      set: async (c: string, id: string, v: unknown) => {
        (c === "sessions" ? sessions : turns).set(id, v);
      },
      delete: async (c: string, id: string) => (c === "sessions" ? sessions : turns).delete(id),
      list: async <T>(c: string) => {
        if (c === "session_turns") calls.turnList++;
        return Array.from((c === "sessions" ? sessions : turns).values()) as T[];
      },
      clear: async () => {
        sessions.clear();
        turns.clear();
      },
      listByPrefix: async <T>(c: string, prefix: string) => {
        calls.listByPrefix++;
        calls.prefixes.push(prefix);
        const col = c === "sessions" ? sessions : turns;
        const out: unknown[] = [];
        for (const [id, v] of col) if (String(id).startsWith(prefix)) out.push(v);
        return out as T[];
      },
    } as IStorageDriver;
    const repo = new SessionRepository(driver);
    await repo.create({ id: "sess-px", workspaceId: "w" });
    await repo.appendTurn("sess-px", makeTurn(0, "sess-px", "t0"));
    await repo.appendTurn("sess-px", makeTurn(1, "sess-px", "t1"));

    calls.turnList = 0;
    calls.listByPrefix = 0;
    calls.prefixes = [];
    const session = await repo.get("sess-px");
    expect(session?.turns.map((t) => t.id)).toEqual(["turn-0", "turn-1"]);
    expect(calls.listByPrefix).toBe(1);
    // turnKey = `${sessionId}:${turnId}`（冒号分隔，见 session.repository.ts）
    expect(calls.prefixes[0]).toBe("sess-px:");
    expect(calls.turnList).toBe(0); // 单会话装配不再扫全表
  });
});

describe("R3/N1 metrics registry 保险丝（存储域审查修复）", () => {
  it("R3/⑤ counter series 超上限：新 series 丢弃 + overflow_total 计数 + 渲染注释标注", () => {
    const registry = new MetricsRegistry({ maxSeries: 3 });
    for (let i = 0; i < 5; i++) {
      registry.incCounter("vuagent_tool_calls_total", { tool: `tool-${i}` });
    }
    const out = registry.renderPrometheus();
    // 已入账样本保留且值正确
    expect(out).toContain('vuagent_tool_calls_total{tool="tool-0"} 1');
    expect(out).toContain('vuagent_tool_calls_total{tool="tool-2"} 1');
    // 超限新 series 丢弃（不上屏）
    expect(out).not.toContain('tool="tool-3"');
    expect(out).not.toContain('tool="tool-4"');
    // overflow_total 计数器上屏 + 渲染注释标注
    expect(out).toContain(
      'vuagent_metric_series_overflow_total{metric="vuagent_tool_calls_total"} 2'
    );
    expect(out).toContain("series cap 3 reached");

    // 已有 series 继续正常累计，不受上限影响
    registry.incCounter("vuagent_tool_calls_total", { tool: "tool-0" });
    expect(registry.renderPrometheus()).toContain('vuagent_tool_calls_total{tool="tool-0"} 2');
  });

  it("R3/⑤b histogram series 同样受限；gauge 不受限", () => {
    const registry = new MetricsRegistry({ maxSeries: 2 });
    for (let i = 0; i < 4; i++) {
      registry.observeHistogram("vuagent_http_request_duration_ms", 10, { route: `/r${i}` });
    }
    for (const lane of ["a", "b", "c", "d"]) {
      registry.setGauge("vuagent_running_turns", 1, { lane });
    }
    const out = registry.renderPrometheus();
    expect(out).toContain('route="/r0"');
    expect(out).not.toContain('route="/r3"'); // histogram 超限丢弃
    expect(out).toContain(
      'vuagent_metric_series_overflow_total{metric="vuagent_http_request_duration_ms"} 2'
    );
    expect(out).toContain('lane="c"'); // gauge 不设限（有界标签集，天然低基数）
    expect(out).toContain('lane="d"');
  });

  it("N1 incGauge/decGauge 配对；counter 出现负值 series 时 render 给出一次 warn（去重）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const registry = new MetricsRegistry();
      registry.incGauge("vuagent_sse_active_connections", { route: "/chat" });
      registry.incGauge("vuagent_sse_active_connections", { route: "/chat" });
      expect(registry.renderPrometheus()).toContain(
        'vuagent_sse_active_connections{route="/chat"} 2'
      );
      registry.decGauge("vuagent_sse_active_connections", { route: "/chat" });
      expect(registry.renderPrometheus()).toContain(
        'vuagent_sse_active_connections{route="/chat"} 1'
      );

      // counter 上做负增量（incCounter/decGauge 混搭误用的防御性告警）
      registry.incCounter("vuagent_turn_tokens_total", undefined, 5);
      registry.incCounter("vuagent_turn_tokens_total", undefined, -10);
      const out = registry.renderPrometheus();
      expect(out).toContain("vuagent_turn_tokens_total -5");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("vuagent_turn_tokens_total");
      registry.renderPrometheus(); // 再次渲染不重复告警（「一次」语义）
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("④ escapeSqlLikePattern 毒键（sqlite listByPrefix 参数化 LIKE + ESCAPE）", () => {
  it("纯函数：% _ \\ 逐一转义，普通字符（含 ' 引号）原样", () => {
    expect(escapeSqlLikePattern("plain-id")).toBe("plain-id");
    expect(escapeSqlLikePattern("100%")).toBe("100\\%");
    expect(escapeSqlLikePattern("a_b")).toBe("a\\_b");
    expect(escapeSqlLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeSqlLikePattern("it's-a-quote")).toBe("it's-a-quote");
    expect(escapeSqlLikePattern("%_\\%")).toBe("\\%\\_\\\\\\%");
  });

  it("sqlite listByPrefix：含 % _ \\ 的毒键 sessionId 前缀精确匹配，互不串扰", async () => {
    const driver = new SQLiteStorageDriver(":memory:");
    const repo = new SessionRepository(driver);
    const poisonIds = ["sess%", "sess_100", "sess\\x", "sess"];
    for (const sid of poisonIds) {
      await repo.create({ id: sid, workspaceId: "w" });
      await repo.appendTurn(sid, makeTurn(0, sid, `turn-of-${sid}`));
    }
    // get → listByPrefix 前缀下推：每个毒键会话只装配到自己的行
    for (const sid of poisonIds) {
      const session = await repo.get(sid);
      expect(session?.turns).toHaveLength(1);
      expect(session?.turns[0].content).toBe(`turn-of-${sid}`);
      expect(session?.turns[0].sessionId).toBe(sid);
    }
    // 无转义时 "sess%" 的 LIKE 模式会扩匹配串扰到 "sess" 等会话——此处锁死不发生
    const plain = await repo.get("sess");
    expect(plain?.turns[0].sessionId).toBe("sess");
  });

  it("memory 驱动 listByPrefix 同语义（前缀过滤）", async () => {
    const driver = new MemoryStorageDriver();
    const repo = new SessionRepository(driver);
    await repo.create({ id: "m-1", workspaceId: "w" });
    await repo.create({ id: "m-2", workspaceId: "w" });
    await repo.appendTurn("m-1", makeTurn(0, "m-1", "a"));
    await repo.appendTurn("m-2", makeTurn(0, "m-2", "b"));

    const rows = await driver.listByPrefix<{ turn: { sessionId: string } }>("session_turns", "m-1:");
    expect(rows).toHaveLength(1);
    expect(rows[0].turn.sessionId).toBe("m-1");
  });
});
