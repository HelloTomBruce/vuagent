/**
 * 会话级成本聚合 API（TASK-056）
 *
 * 与 /api/finops/summary（既有）同域；summary 场景由 finops/summary 承担，
 * 本文件只覆盖净新增的 by-session 聚合与窗口钳制（对账断言含仓储直查口径）。
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
    costRepo.record({ turnId: "t1", sessionId: "s1", model: "m-a", promptTokens: 1000, completionTokens: 400, finishedAt: base, costUsd: 0.001 }),
    costRepo.record({ turnId: "t2", sessionId: "s1", model: "m-a", promptTokens: 2000, completionTokens: 600, finishedAt: base + 1, costUsd: 0.002 }),
    costRepo.record({ turnId: "t3", sessionId: "s2", model: "m-b", promptTokens: 500, completionTokens: 100, finishedAt: base + 2, costUsd: 0.0005 }),
  ]);
}

describe("会话级成本聚合", () => {
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

  it("by-session 聚合 = 仓储直查（对账），批量一次返回", async () => {
    const { app, assertRepo } = makeStack();
    await seed(assertRepo);

    const res = await app.request("/api/finops/by-session", { headers: H });
    expect(res.status).toBe(200);
    const json = await res.json();

    const direct = await assertRepo.sumWindowBySession(86_400_000);
    expect(json.bySession).toEqual(direct);
    expect(json.bySession["s1"]).toEqual({ tokens: 4000, costUsd: 0.003, recordCount: 2 });
    expect(json.bySession["s2"].tokens).toBe(600);
  });

  it("windowMs 钳制：非法回落 24h，超限压 30d，过小抬 1min", async () => {
    const { app } = makeStack();
    const day = 86_400_000;
    for (const [q, expected] of [
      ["abc", day],
      ["-5", day],
      ["1000", 60_000],
      [String(365 * day), 30 * day],
    ] as const) {
      const json = await (await app.request(`/api/finops/by-session?windowMs=${q}`, { headers: H })).json();
      expect(json.windowMs, q).toBe(expected);
    }
  });

  it("空库：bySession 空对象", async () => {
    const { app } = makeStack();
    const json = await (await app.request("/api/finops/by-session", { headers: H })).json();
    expect(json.bySession).toEqual({});
  });
});
