/**
 * 成本查询 API（TASK-054）
 *
 * 三口径对账是硬验收：summary 聚合值 = 仓储直查结果 = cost_records 明细求和。
 * 测试经共享 SQLite 文件播种（server 与断言侧各自实例化仓储，同一物理库）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessServer } from "../src/server.js";
import { SQLiteStorageDriver } from "../src/storage/drivers/sqlite.driver.js";
import { CostRecordRepository } from "../src/storage/repositories/cost-record.repository.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const H = { Origin: LOCAL_ORIGIN };

function seed(costRepo: CostRecordRepository) {
  const base = Date.now() - 1000;
  return Promise.all([
    costRepo.record({ turnId: "t1", sessionId: "s1", model: "deepseek-chat", promptTokens: 1000, completionTokens: 400, finishedAt: base, costUsd: 0.001 }),
    costRepo.record({ turnId: "t2", sessionId: "s1", model: "deepseek-chat", promptTokens: 2000, completionTokens: 600, finishedAt: base + 1, costUsd: 0.002 }),
    costRepo.record({ turnId: "t3", sessionId: "s2", model: "kimi-k2", promptTokens: 500, completionTokens: 100, finishedAt: base + 2, costUsd: 0.0005 }),
  ]);
}

describe("成本查询 API", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vuagent-costs-"));
    dbPath = join(dir, "harness.db");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function makeStack() {
    const { app } = createHarnessServer({ dbPath });
    const assertRepo = new CostRecordRepository(new SQLiteStorageDriver(dbPath));
    return { app, assertRepo };
  }

  it("summary 聚合 = 仓储直查（三口径对账）", async () => {
    const { app, assertRepo } = makeStack();
    await seed(assertRepo);

    const res = await app.request("/api/costs/summary", { headers: H });
    expect(res.status).toBe(200);
    const json = await res.json();

    // 口径 1：summary vs 口径 2：仓储直查
    const direct = await assertRepo.sumWindow(86_400_000);
    expect(json.usage).toEqual(direct);
    const directByModel = await assertRepo.sumWindowByModel(86_400_000);
    expect(json.byModel).toEqual(directByModel);

    // 口径 3：明细求和
    const records = await assertRepo.list();
    const detailSum = records.reduce(
      (acc, r) => ({ tokens: acc.tokens + r.promptTokens + r.completionTokens, costUsd: acc.costUsd + (r.costUsd ?? 0) }),
      { tokens: 0, costUsd: 0 }
    );
    expect(json.usage.tokens).toBe(detailSum.tokens);
    expect(json.usage.costUsd).toBeCloseTo(Number(detailSum.costUsd.toFixed(6)), 6);

    // 分桶抽查
    expect(json.byModel["deepseek-chat"].tokens).toBe(4000);
    expect(json.byModel["kimi-k2"].costUsd).toBe(0.0005);
    expect(json.quota).toBeNull(); // 未配配额
  });

  it("by-session 聚合：会话徽标数据源，一次批量", async () => {
    const { app, assertRepo } = makeStack();
    await seed(assertRepo);

    const res = await app.request("/api/costs/by-session", { headers: H });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bySession["s1"].tokens).toBe(4000);
    expect(json.bySession["s1"].recordCount).toBe(2);
    expect(json.bySession["s2"].tokens).toBe(600);
  });

  it("windowMs 钳制：非法值回落 24h，超限压到 30d，过小抬到 1min", async () => {
    const { app } = makeStack();
    const day = 86_400_000;
    for (const [q, expected] of [
      ["abc", day],
      ["-5", day],
      ["1000", 60_000],
      [String(365 * day), 30 * day],
      [String(day), day],
    ] as const) {
      const json = await (await app.request(`/api/costs/summary?windowMs=${q}`, { headers: H })).json();
      expect(json.windowMs, q).toBe(expected);
    }
  });

  it("空库：tokens=0 / costUsd=0，byModel 空对象，quota null", async () => {
    const { app } = makeStack();
    const json = await (await app.request("/api/costs/summary", { headers: H })).json();
    expect(json.usage).toEqual({ tokens: 0, costUsd: 0, recordCount: 0 });
    expect(json.byModel).toEqual({});
    expect(json.quota).toBeNull();
  });
});
