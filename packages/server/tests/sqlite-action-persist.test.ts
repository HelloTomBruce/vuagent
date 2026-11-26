/**
 * SQLite 单机形态送达后幂等（遗留尾巴）
 *
 * Redis 外置形态（redis-externalize.test.ts / action-envelope.test.ts）已覆盖
 * 幂等契约（同键同体 200 delivered:false / 同键异体 422 ACTION_PAYLOAD_MISMATCH）；
 * 本文件证明同一契约在 SQLite 单机形态成立：
 * - store 级：decisions 表落账/读取全量回存（含 toolName/args 冗余列）、损坏行
 *   fail-open、pendings 诚实最小实现（空操作 + 空列表）；
 * - 路由级：送达 → 同体重放 → 200 delivered:false + prior；异体 → 422；
 *   「重启」语义（同一 db 文件新建第二个 server 实例）重放仍幂等（持久化证明）；
 *   未送达挂起跨「重启」404（挂起不外置的诚实语义）；
 *   旧形态 {approved, reason} 与新信封两种载荷都能落账/重放。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessServer } from "../src/server.js";
import { createSqliteActionPersist } from "../src/storage/sqlite-action-persist.js";
import { SQLiteStorageDriver } from "../src/storage/drivers/sqlite.driver.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const H = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

/* ==========================================================================
   store 级：createSqliteActionPersist
   ========================================================================== */

describe("createSqliteActionPersist（store 级）", () => {
  let dir: string;
  let dbPath: string;
  let driver: SQLiteStorageDriver;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vuagent-sqlite-idem-"));
    dbPath = join(dir, "harness.db");
    driver = new SQLiteStorageDriver(dbPath);
  });

  afterEach(() => {
    driver.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("决策落账/读取：全量回存（envelope/toolName/args），冗余列同步落账", async () => {
    const store = createSqliteActionPersist(driver.database);
    const payload = {
      approved: true,
      note: "ship it",
      toolName: "bash_run",
      args: { command: "deploy" },
      envelope: { kind: "submit" as const, values: { approved: true }, meta: { editedFields: [] } },
    };
    await store.saveDecision("act-1", payload);
    const got = await store.getDecision("act-1");
    expect(got).toEqual(payload);

    // 冗余列（直查友好）：toolName/args 提取自响应体
    const db = driver.database;
    const row = db.prepare("SELECT toolName, args, created_at FROM decisions WHERE actionId = ?").get("act-1") as {
      toolName: string | null;
      args: string | null;
      created_at: number;
    };
    expect(row.toolName).toBe("bash_run");
    expect(JSON.parse(row.args as string)).toEqual({ command: "deploy" });
    expect(row.created_at).toBeGreaterThan(0);
  });

  it("同 actionId 重复落账以最后一次为准（INSERT OR REPLACE）", async () => {
    const store = createSqliteActionPersist(driver.database);
    await store.saveDecision("act-r", { approved: true });
    await store.saveDecision("act-r", { approved: false, note: "changed" });
    expect(await store.getDecision("act-r")).toEqual({ approved: false, note: "changed" });
  });

  it("旧形态 {approved, reason, note} 同样落账/读取；无 args 时冗余列为 NULL", async () => {
    const store = createSqliteActionPersist(driver.database);
    await store.saveDecision("act-legacy", { approved: true, reason: "manual", note: "ok" });
    expect(await store.getDecision("act-legacy")).toEqual({ approved: true, reason: "manual", note: "ok" });
    const row = driver.database.prepare("SELECT toolName, args FROM decisions WHERE actionId = ?").get("act-legacy") as {
      toolName: string | null;
      args: string | null;
    };
    expect(row.toolName).toBeNull();
    expect(row.args).toBeNull();
  });

  it("损坏 payload fail-open：getDecision 返回 undefined（路由层回落「无法判定」）", async () => {
    const store = createSqliteActionPersist(driver.database);
    driver.database
      .prepare("INSERT INTO decisions (actionId, payload, toolName, args, created_at) VALUES (?, ?, NULL, NULL, ?)")
      .run("act-corrupt", "{{not json", Date.now());
    expect(await store.getDecision("act-corrupt")).toBeUndefined();
    expect(await store.getDecision("act-missing")).toBeUndefined();
  });

  it("pendings 诚实最小实现：savePending/deletePending 空操作，listPending 恒空", async () => {
    const store = createSqliteActionPersist(driver.database);
    await store.savePending({
      actionId: "act-p",
      toolName: "bash_run",
      args: {},
      sessionId: "s1",
      createdAt: Date.now(),
      timeoutMs: 180_000,
    });
    await store.deletePending("act-p");
    expect(await store.listPending()).toEqual([]);
  });

  it("跨实例持久化：新开连接（同一 db 文件）读同一决策（重启语义 store 级证明）", async () => {
    const store = createSqliteActionPersist(driver.database);
    await store.saveDecision("act-x", { approved: true, note: "persisted" });

    const driver2 = new SQLiteStorageDriver(dbPath);
    try {
      const store2 = createSqliteActionPersist(driver2.database);
      expect(await store2.getDecision("act-x")).toEqual({ approved: true, note: "persisted" });
    } finally {
      driver2.close();
    }
  });
});

/* ==========================================================================
   路由级：文件型 db + harness server（无 redisClient → SQLite 决策外置生效）
   ========================================================================== */

describe("SQLite 形态送达后幂等（路由级）", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vuagent-sqlite-route-"));
    dbPath = join(dir, "harness.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("送达 → 同体重放 200 delivered:false + prior；异体重放 422 ACTION_PAYLOAD_MISMATCH", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath });
    const promise = actionHub.waitForAction("act-deliver", {
      toolName: "bash_run",
      args: { command: "deploy" },
      timeoutMs: 5000,
    });

    const body = { kind: "submit", values: { approved: true }, meta: { editedFields: [] } };
    const first = await app.request("/api/action/act-deliver", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    const resolved = await promise;
    expect(resolved.approved).toBe(true);

    // 同体重放：prior 命中（送达后落账），不再 404 谎报「无此挂起」
    const replay = await app.request("/api/action/act-deliver", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    const replayJson = (await replay.json()) as { success: boolean; delivered: boolean; prior?: unknown };
    expect(replayJson.success).toBe(true);
    expect(replayJson.delivered).toBe(false);
    expect(replayJson.prior).toBeTruthy();

    // 异体重放：422 防误重试覆盖
    const conflict = await app.request("/api/action/act-deliver", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { approved: false, note: "改主意了" } }),
    });
    expect(conflict.status).toBe(422);
    expect(((await conflict.json()) as { code: string }).code).toBe("ACTION_PAYLOAD_MISMATCH");
  });

  it("「重启」语义：同一 db 文件新建第二个 server 实例 → 重放仍 200 幂等（持久化证明）", async () => {
    const first = createHarnessServer({ dbPath });
    const promise = first.actionHub.waitForAction("act-restart", {
      toolName: "bash_run",
      args: { command: "deploy" },
      timeoutMs: 5000,
    });
    const body = { approved: true, note: "approved before restart" };
    const res1 = await first.app.request("/api/action/act-restart", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(res1.status).toBe(200);
    expect((await promise).approved).toBe(true);

    // 模拟进程重启：全新 server 实例，同一 db 文件（内存挂起全丢，仅决策留档）
    const second = createHarnessServer({ dbPath });
    const replay = await second.app.request("/api/action/act-restart", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    const replayJson = (await replay.json()) as { success: boolean; delivered: boolean; prior?: unknown };
    expect(replayJson.success).toBe(true);
    expect(replayJson.delivered).toBe(false);
    expect(replayJson.prior).toBeTruthy();

    // 重启后的异体重放同样 422（哈希比较源来自持久化行）
    const conflict = await second.app.request("/api/action/act-restart", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: false, note: "tampered after restart" }),
    });
    expect(conflict.status).toBe(422);
    expect(((await conflict.json()) as { code: string }).code).toBe("ACTION_PAYLOAD_MISMATCH");
  });

  it("未送达挂起跨「重启」：404 诚实语义（挂起不外置，决策无账可查）", async () => {
    const first = createHarnessServer({ dbPath });
    // 挂起仍在第一实例内存态（永不送达）
    void first.actionHub.waitForAction("act-lost", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 30_000,
    });

    const second = createHarnessServer({ dbPath });
    const res = await second.app.request("/api/action/act-lost", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: true }),
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(false);
  });

  it("旧形态 {approved, reason} 与新信封都能落账/重放", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath });

    // 旧形态：无 kind 的 {approved, reason}（兼容映射为 L1 submit 信封参与哈希）
    const legacyPromise = actionHub.waitForAction("act-old-form", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });
    const legacyBody = { approved: true, reason: "manual" };
    const legacyFirst = await app.request("/api/action/act-old-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify(legacyBody),
    });
    expect(legacyFirst.status).toBe(200);
    expect((await legacyPromise).approved).toBe(true);
    const legacyReplay = await app.request("/api/action/act-old-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify(legacyBody),
    });
    expect(legacyReplay.status).toBe(200);
    const legacyJson = (await legacyReplay.json()) as { success: boolean; delivered: boolean; prior?: unknown };
    expect(legacyJson.success).toBe(true);
    expect(legacyJson.delivered).toBe(false);
    expect(legacyJson.prior).toBeTruthy();

    // 新信封：{kind:"submit", values, meta}
    const envPromise = actionHub.waitForAction("act-env-form", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });
    const envBody = { kind: "submit", values: { approved: true, note: "go" }, meta: { editedFields: ["note"] } };
    const envFirst = await app.request("/api/action/act-env-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify(envBody),
    });
    expect(envFirst.status).toBe(200);
    expect((await envPromise).approved).toBe(true);
    const envReplay = await app.request("/api/action/act-env-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify(envBody),
    });
    expect(envReplay.status).toBe(200);
    const envJson = (await envReplay.json()) as { success: boolean; delivered: boolean; prior?: unknown };
    expect(envJson.success).toBe(true);
    expect(envJson.delivered).toBe(false);
    expect(envJson.prior).toBeTruthy();

    // 旧形态落账的异体重放同样 422
    const conflict = await app.request("/api/action/act-old-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: false, reason: "manual" }),
    });
    expect(conflict.status).toBe(422);
    expect(((await conflict.json()) as { code: string }).code).toBe("ACTION_PAYLOAD_MISMATCH");
  });
});
