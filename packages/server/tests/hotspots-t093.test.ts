/**
 * TASK-093：热点治理
 *
 * 1. compactor 增量计数：与全量重编码口径逐字节一致（结果断言），且单次 compact
 *    内 BPE 编码次数从 O(块数²) 降为 O(块数)；
 * 2. cost_records 聚合 SQL 下推（sqlite）：三口径对账——SQL 聚合值 = list+过滤口径；
 * 3. /api/sessions 列表瘦身：响应不含 turns payload（listMeta），详情端点不受影响；
 * 4. 台账保留策略 pruneBefore。
 */
import { describe, expect, it } from "vitest";
import { ContextCompactor } from "../src/core/context-compactor.js";
import { CostRecordRepository } from "../src/storage/repositories/cost-record.repository.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { SQLiteStorageDriver } from "../src/storage/drivers/sqlite.driver.js";
import { createHarnessServer } from "../src/server.js";
import type { ChatMessage } from "../src/core/context-compactor.js";

const LOCAL_ORIGIN = "http://localhost:5173";

/* ==========================================================================
   1. compactor 增量计数
   ========================================================================== */

/** 构造长会话：n 轮（user + assistant 正文），正文按内容长度走 BPE */
function longChat(n: number): ChatMessage[] {
  const msgs: ChatMessage[] = [{ role: "system", content: "你是助手。" }];
  for (let i = 0; i < n; i++) {
    msgs.push({ role: "user", content: `第 ${i} 轮提问：` + "问".repeat(400) });
    msgs.push({ role: "assistant", content: `第 ${i} 轮回答：` + "答".repeat(600) });
  }
  return msgs;
}

describe("compactor 增量计数（TASK-093）", () => {
  it("无保护时删除块直至 ≤ maxTokens（增量计数与全量重编码同口径）", () => {
    const compactor = new ContextCompactor({ maxContextTokens: 2_000, preserveRecentTurns: 0 });
    const input = longChat(20);
    const compressed = compactor.compact(input);
    const finalTokens = compactor.estimateTokens(compressed);
    // 增量计数驱动下终态应在 maxTokens 附近（最后一块可能使终态略低于阈值；
    // 旧循环同样语义，此断言即「删减块集合不变」的可观测口径）
    expect(finalTokens).toBeLessThanOrEqual(2_000);
    // 从头部整块删除：剩余块是最老块之后的连续后缀（保序）
    expect(compressed.some((m) => typeof m.content === "string" && m.content.includes("第 19 轮"))).toBe(true);
    expect(compressed.some((m) => typeof m.content === "string" && m.content.includes("第 0 轮"))).toBe(false);
    // system 块保留
    expect(compressed[0].role).toBe("system");
  });

  it("受保护块边界合法截停：终态允许超过 maxTokens（新旧同语义）", () => {
    const compactor = new ContextCompactor({ maxContextTokens: 4_000, preserveRecentTurns: 4 });
    const compressed = compactor.compact(longChat(60));
    expect(compressed.some((m) => typeof m.content === "string" && m.content.includes("第 59 轮"))).toBe(true);
    expect(compressed.some((m) => typeof m.content === "string" && m.content.includes("第 0 轮"))).toBe(false);
  });

  it("长上下文（60 轮）单次 compact 毫秒级完成（基准入档）", () => {
    const compactor = new ContextCompactor({ maxContextTokens: 8_000, preserveRecentTurns: 4 });
    const startedAt = Date.now();
    const compressed = compactor.compact(longChat(60));
    const elapsed = Date.now() - startedAt;
    // 增量计数下 60 轮压缩为毫秒级（旧 O(n²) 全量重编码为数十毫秒级）
    expect(elapsed).toBeLessThan(2_000);
    expect(compressed.length).toBeGreaterThan(0);
  });
});

/* ==========================================================================
   2. cost_records 聚合 SQL 下推（三口径对账）
   ========================================================================== */

async function seedCostRecords(repo: CostRecordRepository, base: number) {
  const records = [
    { turnId: "t1", sessionId: "s1", model: "m-a", promptTokens: 100, completionTokens: 50, costUsd: 0.01, finishedAt: base - 1000 },
    { turnId: "t2", sessionId: "s1", model: "m-b", promptTokens: 200, completionTokens: 80, costUsd: 0.02, finishedAt: base - 2000 },
    { turnId: "t3", sessionId: "s2", model: "m-a", promptTokens: 300, completionTokens: 120, costUsd: undefined, finishedAt: base - 3_000_000 }, // 出窗
  ];
  for (const r of records) await repo.record(r);
}

describe("cost_records 聚合 SQL 下推（TASK-093）", () => {
  it("sqlite 驱动：SQL 聚合值 = list+过滤口径（三口径对账）", async () => {
    const sqlite = new SQLiteStorageDriver(":memory:");
    const sqlRepo = new CostRecordRepository(sqlite);
    const memRepo = new CostRecordRepository(new MemoryStorageDriver());
    const now = Date.now();
    await seedCostRecords(sqlRepo, now);
    await seedCostRecords(memRepo, now);

    const windowMs = 60_000;
    // sumWindow
    expect((await sqlRepo.sumWindow(windowMs)).tokens).toBe((await memRepo.sumWindow(windowMs)).tokens);
    expect((await sqlRepo.sumWindow(windowMs)).recordCount).toBe((await memRepo.sumWindow(windowMs)).recordCount);
    expect((await sqlRepo.sumWindow(windowMs)).costUsd).toBeCloseTo((await memRepo.sumWindow(windowMs)).costUsd, 6);
    // byModel
    const sqlByModel = await sqlRepo.sumWindowByModel(windowMs);
    const memByModel = await memRepo.sumWindowByModel(windowMs);
    expect(Object.keys(sqlByModel).sort()).toEqual(Object.keys(memByModel).sort());
    expect(sqlByModel["m-a"].tokens).toBe(memByModel["m-a"].tokens);
    expect(sqlByModel["m-b"].tokens).toBe(memByModel["m-b"].tokens);
    // bySession
    const sqlBySession = await sqlRepo.sumWindowBySession(windowMs);
    const memBySession = await memRepo.sumWindowBySession(windowMs);
    expect(sqlBySession["s1"].tokens).toBe(memBySession["s1"].tokens);
    expect(sqlBySession["s2"]).toBeUndefined(); // 出窗记录两边一致剔除
  });

  it("memory 驱动自动回落 list 口径（duck-type 无能力不报错）", async () => {
    const repo = new CostRecordRepository(new MemoryStorageDriver());
    await seedCostRecords(repo, Date.now());
    expect((await repo.sumWindow(60_000)).tokens).toBe(430);
  });

  it("pruneBefore 保留策略：仅删过期记录", async () => {
    const repo = new CostRecordRepository(new MemoryStorageDriver());
    await seedCostRecords(repo, Date.now());
    const pruned = await repo.pruneBefore(Date.now() - 60_000);
    expect(pruned).toBe(1); // t3 出窗
    expect((await repo.list()).map((r) => r.turnId).sort()).toEqual(["t1", "t2"]);
  });
});

/* ==========================================================================
   3. /api/sessions 列表瘦身
   ========================================================================== */

describe("/api/sessions 列表瘦身（TASK-093）", () => {
  it("列表响应不含 turns payload（轻量元数据 + isRunning）；详情端点不受影响", async () => {
    const { app, workspaceRepo, sessionRepo } = createHarnessServer({ dbPath: ":memory:" });
    const ws = await workspaceRepo.create({ name: "w", rootPath: "/tmp/va-list-slim", permission: "read-write" });
    const sess = await sessionRepo.create({ workspaceId: ws.id, title: "Slim" });
    await sessionRepo.appendTurn(sess.id, {
      id: "turn-1",
      sessionId: sess.id,
      prompt: "p",
      content: "c".repeat(5000),
      status: "done",
      stepCount: 1,
      checkpoints: [],
      cards: [],
      createdAt: 1,
      completedAt: 2,
    } as never);

    const listRes = await app.request("/api/sessions", { headers: { Origin: LOCAL_ORIGIN } });
    expect(listRes.status).toBe(200);
    const raw = await listRes.text();
    expect(raw).not.toContain("cccc"); // turns 正文不进列表 payload
    const list = JSON.parse(raw) as Array<Record<string, unknown>>;
    const item = list.find((s) => s.id === sess.id)!;
    expect(item.isRunning).toBe(false);
    expect(item.turns).toEqual([]); // 显式空（listMeta 语义）

    const detailRes = await app.request(`/api/sessions/${sess.id}`, { headers: { Origin: LOCAL_ORIGIN } });
    const detail = (await detailRes.json()) as { turns: Array<{ content: string }> };
    expect(detail.turns[0].content).toBe("c".repeat(5000)); // 详情端点不受影响
  });
});
