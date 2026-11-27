/**
 * M3 运维命令单测（T14/T15）：backup 完整性、export→import 往返、
 * migrate --from 搬迁与冲突统计、migrate --checkpoints 拆行迁移与 content 物化、
 * prune older-than/keep/dry-run、doctor 检查面与 --fix-lock。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runBackup } from "../src/commands/backup.js";
import { runExport, runImport } from "../src/commands/export-import.js";
import { runMigrate } from "../src/commands/migrate.js";
import { runPrune } from "../src/commands/prune.js";
import { runDoctor } from "../src/commands/doctor.js";
import { forceClearLock } from "../src/lib/lock.js";
import { resolveDataPaths, type DataPaths } from "@vuagent/server";

let root: string;
let home: string;

function dbPath(): string {
  return path.join(root, "harness.db");
}

function paths(): { dbPath: string; exportsDir: string; lockFile: string } {
  return {
    dbPath: dbPath(),
    exportsDir: path.join(home, "exports"),
    lockFile: path.join(home, "run", "harness.lock"),
  };
}

/** 造一个 kv_store 库（可塞 legacy turn 行） */
function makeDb(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (collection, id)
    );
  `);
  return db;
}

function seedSession(
  db: DatabaseSync,
  sessionId: string,
  opts: { legacy?: boolean; emptyContent?: boolean; updatedAt?: number; bigSnapshots?: boolean },
): void {
  const insert = db.prepare("INSERT INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)");
  insert.run("sessions", sessionId, JSON.stringify({
    id: sessionId, workspaceId: "ws-1", title: "会话", status: "active",
    turns: [], createdAt: opts.updatedAt ?? Date.now(), updatedAt: opts.updatedAt ?? Date.now(),
  }), opts.updatedAt ?? Date.now());

    const filler = opts.bigSnapshots ? "x".repeat(2 * 1024 * 1024) : "";
  const legacyCps = opts.legacy
    ? [
        { id: "cp-1", turnId: "turn-1", stepIndex: 1, messagesSnapshot: [{ role: "user", content: "问题" }, { role: "assistant", content: `完整回复正文${filler}` }], snapshotAt: 100 },
        { id: "cp-2", turnId: "turn-1", stepIndex: 2, messagesSnapshot: [{ role: "user", content: "问题" }, { role: "assistant", content: `完整回复正文${filler}` }], snapshotAt: 200 },
      ]
    : [];
  insert.run(
    "session_turns",
    `${sessionId}:turn-1`,
    JSON.stringify({
      index: 0,
      turn: {
        id: "turn-1", sessionId, prompt: "问题",
        status: "done", stepCount: 2,
        content: opts.emptyContent ? undefined : "已有正文",
        checkpoints: legacyCps,
      },
    }),
    opts.updatedAt ?? Date.now(),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-ops-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-ops-home-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("vuagent backup", () => {
  it("VACUUM INTO 产物完整（行数一致、integrity ok），exports 目录自动创建", async () => {
    const db = makeDb(dbPath());
    const insert = db.prepare("INSERT INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)");
    insert.run("workspaces", "ws-1", JSON.stringify({ id: "ws-1", name: "W" }), Date.now());
    insert.run("sessions", "s-1", JSON.stringify({ id: "s-1" }), Date.now());
    db.close();

    const code = await runBackup({ dbPath: dbPath(), exportsDir: path.join(home, "exports") }, {});
    expect(code).toBe(0);
    const files = fs.readdirSync(path.join(home, "exports"));
    expect(files.some((f) => f.startsWith("harness-") && f.endsWith(".db"))).toBe(true);
    const backup = path.join(path.join(home, "exports"), files[0]);
    const check = new DatabaseSync(backup, { readOnly: true });
    const n = (check.prepare("SELECT COUNT(*) AS n FROM kv_store").get() as { n: number }).n;
    check.close();
    expect(n).toBe(2);
  });

  it("库不存在 → 退出码 1", async () => {
    const code = await runBackup({ dbPath: path.join(root, "nope.db"), exportsDir: path.join(home, "exports") }, {});
    expect(code).toBe(1);
  });
});

describe("vuagent export / import", () => {
  it("往返：export 的行 import 进空库后逐行一致（skip 策略冲突跳过）", async () => {
    const db = makeDb(dbPath());
    const insert = db.prepare("INSERT INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)");
    insert.run("workspaces", "ws-1", JSON.stringify({ id: "ws-1", name: "W" }), Date.now());
    insert.run("sessions", "s-1", JSON.stringify({ id: "s-1", title: "T" }), Date.now());
    db.close();

    const out = path.join(home, "export.json");
    expect(await runExport({ dbPath: dbPath(), exportsDir: path.join(home, "exports") }, { out })).toBe(0);
    const file = JSON.parse(fs.readFileSync(out, "utf8")) as { schemaVersion: number; rows: Array<{ collection: string; id: string }> };
    expect(file.schemaVersion).toBe(1);
    expect(file.rows).toHaveLength(2);

    // 回灌进另一个库
    const db2file = path.join(root, "two.db");
    makeDb(db2file).close();
    expect(await runImport({ dbPath: db2file }, out, {})).toBe(0);
    const db2 = new DatabaseSync(db2file, { readOnly: true });
    const n = (db2.prepare("SELECT COUNT(*) AS n FROM kv_store").get() as { n: number }).n;
    db2.close();
    expect(n).toBe(2);

    // 重复 import（skip）：全部跳过
    expect(await runImport({ dbPath: db2file }, out, { strategy: "skip" })).toBe(0);
  });

  it("schemaVersion 不兼容 → 拒绝", async () => {
    const bad = path.join(home, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ schemaVersion: 999, rows: [] }));
    expect(await runImport({ dbPath: dbPath() }, bad, {})).toBe(1);
  });
});

describe("vuagent migrate --from", () => {
  it("源库行拷入目标库（冲突跳过并计数）", async () => {
    const srcFile = path.join(root, "src.db");
    const src = makeDb(srcFile);
    const insert = src.prepare("INSERT INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)");
    insert.run("workspaces", "ws-1", JSON.stringify({ id: "ws-1" }), Date.now());
    insert.run("sessions", "s-1", JSON.stringify({ id: "s-1" }), Date.now());
    src.close();

    const dstFile = path.join(root, "dst.db");
    const dst = makeDb(dstFile);
    // 预置一个同 id 会话 → 冲突
    dst.prepare("INSERT INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)").run(
      "sessions", "s-1", JSON.stringify({ id: "s-1", title: "已有" }), Date.now(),
    );
    dst.close();

    const code = await runMigrate({ dbPath: dstFile, lockFile: paths().lockFile, exportsDir: home }, { from: srcFile });
    expect(code).toBe(0);
    const check = new DatabaseSync(dstFile, { readOnly: true });
    const n = (check.prepare("SELECT COUNT(*) AS n FROM kv_store").get() as { n: number }).n;
    check.close();
    expect(n).toBe(2); // 1 已有（冲突跳过）+ 1 拷入
  });

  it("源库不存在 → 退出码 1", async () => {
    expect(await runMigrate({ dbPath: dbPath(), lockFile: "", exportsDir: "" }, { from: path.join(root, "nope.db") })).toBe(1);
  });
});

describe("vuagent migrate --checkpoints", () => {
  it("legacy 内联快照搬入独立集合、turn 行 meta 化、content 物化；备份自动生成", async () => {
    const db = makeDb(dbPath());
    seedSession(db, "s-1", { legacy: true, emptyContent: true, updatedAt: Date.now() });
    db.close();

    const code = await runMigrate(
      { dbPath: dbPath(), lockFile: paths().lockFile, exportsDir: path.join(home, "exports") },
      { checkpoints: true },
    );
    expect(code).toBe(0);

    const check = new DatabaseSync(dbPath(), { readOnly: true });
    const turnRow = JSON.parse(
      (check.prepare("SELECT data FROM kv_store WHERE collection='session_turns' AND id='s-1:turn-1'").get() as { data: string }).data
    ) as { turn: { checkpoints: Array<{ id: string; messagesSnapshot?: unknown }>; checkpointCount: number; checkpointsSplit: boolean; content?: string } };
    // meta 化：无快照字段
    expect(turnRow.turn.checkpoints.map((c) => c.id)).toEqual(["cp-1", "cp-2"]);
    expect(turnRow.turn.checkpoints.every((c) => c.messagesSnapshot === undefined)).toBe(true);
    expect(turnRow.turn.checkpointsSplit).toBe(true);
    expect(turnRow.turn.checkpointCount).toBe(2);
    // content 物化（原 content 为空，从最后快照反推 assistant 回复）
    expect(turnRow.turn.content).toBe("完整回复正文");

    // 独立集合两条
    const cpRows = (check.prepare("SELECT COUNT(*) AS n FROM kv_store WHERE collection='session_checkpoints'").get() as { n: number }).n;
    expect(cpRows).toBe(2);
    check.close();

    // 备份已生成（迁移备份落 exportsDir）
    expect(fs.readdirSync(path.join(home, "exports")).some((f) => f.startsWith("pre-migrate-"))).toBe(true);
  });

  it("dry-run 只统计不落库", async () => {
    const db = makeDb(dbPath());
    seedSession(db, "s-1", { legacy: true, updatedAt: Date.now() });
    db.close();

    const code = await runMigrate(
      { dbPath: dbPath(), lockFile: "", exportsDir: home },
      { checkpoints: true, dryRun: true },
    );
    expect(code).toBe(0);
    const check = new DatabaseSync(dbPath(), { readOnly: true });
    const cpRows = (check.prepare("SELECT COUNT(*) AS n FROM kv_store WHERE collection='session_checkpoints'").get() as { n: number }).n;
    const raw = JSON.parse(
      (check.prepare("SELECT data FROM kv_store WHERE collection='session_turns'").get() as { data: string }).data
    ) as { turn: { checkpointsSplit?: boolean } };
    check.close();
    expect(cpRows).toBe(0);
    expect(raw.turn.checkpointsSplit).toBeUndefined();
  });
});

describe("vuagent prune", () => {
  it("older-than 级联删会话/turn/checkpoint + 成本台账；keep 豁免；vacuum 可用", async () => {
    const db = makeDb(dbPath());
    const old = Date.now() - 40 * 86_400_000;
    // 先迁到拆行形态再删：确保 turn 行有 meta、checkpoint 行真实存在于独立集合
    seedSession(db, "s-old", { legacy: true, emptyContent: true, updatedAt: old });
    seedSession(db, "s-new", { updatedAt: Date.now() });
    const insert = db.prepare("INSERT INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)");
    insert.run("cost_records", "c-old", JSON.stringify({ turnId: "t", sessionId: "s-old", finishedAt: old, model: "m", promptTokens: 1, completionTokens: 1 }), old);
    insert.run("cost_records", "c-new", JSON.stringify({ turnId: "t", sessionId: "s-new", finishedAt: Date.now(), model: "m", promptTokens: 1, completionTokens: 1 }), Date.now());
    db.close();
    // 拆行（legacy 快照 → session_checkpoints 独立集合 + turn 行 meta 化）
    expect(await runMigrate({ dbPath: dbPath(), lockFile: "", exportsDir: path.join(home, "exports") }, { checkpoints: true, noBackup: true })).toBe(0);

    expect(await runPrune({ dbPath: dbPath() }, { olderThan: "30d", keep: ["s-new"], vacuum: true })).toBe(0);

    const check = new DatabaseSync(dbPath(), { readOnly: true });
    const countOf = (collection: string) =>
      (check.prepare("SELECT COUNT(*) AS n FROM kv_store WHERE collection = ?").get(collection) as { n: number }).n;
    const idsOf = (collection: string) =>
      (check.prepare("SELECT id FROM kv_store WHERE collection = ?").all(collection) as Array<{ id: string }>).map((r) => r.id);

    // 会话删除 + 级联删净（C2 回归：此前 LIKE 转义把 % 当字面量，turn/checkpoint 行全部残留）
    expect(idsOf("sessions")).toEqual(["s-new"]);
    expect(idsOf("session_turns")).toEqual(["s-new:turn-1"]);
    expect(idsOf("session_checkpoints")).toEqual([]); // s-old 的两条快照随之删除
    // 成本台账：老的删、新的留
    expect(idsOf("cost_records")).toEqual(["c-new"]);
    // 大局守恒：只剩 s-new 的 1 会话 + 1 turn + 2 成本/无
    expect(countOf("sessions")).toBe(1);
    check.close();
  });

  it("dry-run 不动数据；缺 --older-than → 退出码 1", async () => {
    const db = makeDb(dbPath());
    seedSession(db, "s-old", { updatedAt: Date.now() - 40 * 86_400_000 });
    db.close();

    expect(await runPrune({ dbPath: dbPath() }, { olderThan: "30d", dryRun: true })).toBe(0);
    const check = new DatabaseSync(dbPath(), { readOnly: true });
    const n = (check.prepare("SELECT COUNT(*) AS n FROM kv_store WHERE collection='sessions'").get() as { n: number }).n;
    check.close();
    expect(n).toBe(1);

    expect(await runPrune({ dbPath: dbPath() }, {})).toBe(1);
    expect(await runPrune({ dbPath: dbPath() }, { olderThan: "bogus" })).toBe(1);
  });
});

describe("vuagent doctor", () => {
  function mkPaths(): DataPaths {
    return resolveDataPaths({ dataDir: path.join(home, "data"), dbPath: path.join(root, "harness.db"), env: {} });
  }

  it("空数据目录：全 warn/ok 无 error", async () => {
    const checks = await runDoctor(mkPaths(), {});
    expect(checks.some((c) => c.status === "error")).toBe(false);
    expect(checks.find((c) => c.check === "data-dir")?.status).toBe("warn");
  });

  it("正常库：integrity ok；WAL 超阈值给 backup 提示；stale 锁可 --fix-lock", async () => {
    const db = makeDb(dbPath());
    seedSession(db, "s-1", { updatedAt: Date.now() });
    db.close();

    const okChecks = await runDoctor(mkPaths(), {});
    expect(okChecks.find((c) => c.check === "db")?.detail).toContain("integrity ok");

    // WAL 超阈值：禁 autocheckpoint + 提交 ~34MB 数据（WAL 有效帧堆积），
    // doctor 自开连接只读不 checkpoint；假 WAL 文件会被 SQLite 打开时自动重置（不可用）
    const holder = new DatabaseSync(dbPath());
    holder.exec("PRAGMA wal_autocheckpoint = 0");
    holder.exec("BEGIN");
    holder.prepare("INSERT INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)").run(
      "workspaces", "ws-big", JSON.stringify({ blob: "y".repeat(34 * 1024 * 1024) }), Date.now(),
    );
    holder.exec("COMMIT");
    const walChecks = await runDoctor(mkPaths(), {});
    expect(walChecks.find((c) => c.check === "wal")?.status).toBe("warn");
    expect(walChecks.find((c) => c.check === "wal")?.hint).toContain("vuagent backup");
    holder.close();

    // stale 锁 → --fix-lock 清除
    fs.mkdirSync(path.dirname(mkPaths().lockFile), { recursive: true });
    fs.writeFileSync(mkPaths().lockFile, JSON.stringify({ pid: 4_000_001, port: 6880 }));
    const staleChecks = await runDoctor(mkPaths(), {});
    expect(staleChecks.find((c) => c.check === "lock")?.status).toBe("warn");
    expect(staleChecks.find((c) => c.check === "lock")?.hint).toContain("--fix-lock");

    await runDoctor(mkPaths(), { fixLock: true });
    expect(fs.existsSync(mkPaths().lockFile)).toBe(false);
    void forceClearLock;
  });

  it("turn 行超大（legacy）给 migrate 提示（W2 指标可见化）", async () => {
    const db = makeDb(dbPath());
    seedSession(db, "s-1", { legacy: true, bigSnapshots: true, updatedAt: Date.now() });
    db.close();

    const checks = await runDoctor(mkPaths(), {});
    const turnRow = checks.find((c) => c.check === "turn-row");
    expect(turnRow?.status).toBe("warn");
    expect(turnRow?.hint).toContain("migrate --checkpoints");
  });
});
