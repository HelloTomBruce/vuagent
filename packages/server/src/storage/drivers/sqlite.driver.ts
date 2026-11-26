import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IStorageDriver } from "./base.driver.js";

/**
 * SQL LIKE 模式转义（存储域审查 R2 纯函数）：把用户可控的 id 前缀中的
 * 通配符 %、_ 与转义符 \ 一律字面化（配合 SQL 里 ESCAPE '\' 子句），
 * 防止毒键（如 "100%"、"a_b"）扩匹配串扰他人行。参数化占位保证引号等
 * 其余字符安全，无需在此处理。
 */
export function escapeSqlLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** TASK-093 成本聚合的分组维度白名单（存储域审查 O4）：白名单外不得拼进 SQL */
const COST_AGGREGATE_GROUP_COLUMNS: Record<string, string> = {
  model: "model",
  sessionId: "sessionId",
};

/**
 * SQLite 本地单文件/内存存储驱动 (SQLiteStorageDriver)
 * 基于 Node 原生 DatabaseSync，提供可靠的事务与 ACID 本地持久化
 */
export class SQLiteStorageDriver implements IStorageDriver {
  private db: DatabaseSync;

  constructor(dbPath: string = ":memory:") {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    }
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_store (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS idx_collection ON kv_store(collection);
    `);
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const stmt = this.db.prepare(
      "SELECT data FROM kv_store WHERE collection = ? AND id = ?"
    );
    const row = stmt.get(collection, id) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as T;
  }

  async set<T>(collection: string, id: string, value: T): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO kv_store (collection, id, data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
    `);
    stmt.run(collection, id, JSON.stringify(value), Date.now());
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const stmt = this.db.prepare(
      "DELETE FROM kv_store WHERE collection = ? AND id = ?"
    );
    const res = stmt.run(collection, id);
    return res.changes > 0;
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    const stmt = this.db.prepare(
      "SELECT data FROM kv_store WHERE collection = ?"
    );
    const rows = stmt.all(collection) as Array<{ data: string }>;
    const items = rows.map((r) => JSON.parse(r.data) as T);
    if (filter) {
      return items.filter(filter);
    }
    return items;
  }

  /**
   * 键前缀读取（PrefixListSupport，存储域审查 R2）：参数化 LIKE + ESCAPE 下推
   * 到库内——单会话行装配（session_turns 行键前缀 = `${sessionId}:`）不再全表
   * 物化。prefix 经 escapeSqlLikePattern 转义（%/_/\ 字面化），毒键不扩匹配。
   */
  async listByPrefix<T>(collection: string, prefix: string): Promise<T[]> {
    const stmt = this.db.prepare(
      "SELECT data FROM kv_store WHERE collection = ? AND id LIKE ? ESCAPE '\\'"
    );
    const rows = stmt.all(
      collection,
      `${escapeSqlLikePattern(prefix)}%`
    ) as Array<{ data: string }>;
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  async clear(collection?: string): Promise<void> {
    if (collection) {
      const stmt = this.db.prepare("DELETE FROM kv_store WHERE collection = ?");
      stmt.run(collection);
    } else {
      this.db.exec("DELETE FROM kv_store;");
    }
  }

  /**
   * TASK-093：成本台账聚合下推（json_extract 库内聚合）。
   * 替代 CostRecordRepository 的「全表 list + 内存过滤」——准入每请求都查
   * sumWindow，台账越大扫描越贵；库内聚合对单机规模是 O(N) 读但零 JSON 解码、
   * 零 JS 往返，且天然随 WAL 原子性。
   *
   * 存储域审查 O4：groupBy 只接受白名单列（COST_AGGREGATE_GROUP_COLUMNS），
   * 白名单外抛明确错误，而非把任意字符串拼进 SQL；白名单列是静态标识符，
   * 不存在注入面。
   * 存储域审查 O5：分组聚合路径排除 sessionId 为 SQL NULL 的记录，对齐
   * list 口径的 `!r.sessionId` 跳过（json_extract 缺键返回 NULL，否则会落成
   * key=null 的幻影分组）——bySession/byModel 两个调用点一并生效。
   */
  async aggregateCostRecords(query: import("./base.driver.js").CostAggregateQuery) {
    if (query.groupBy !== undefined && !(query.groupBy in COST_AGGREGATE_GROUP_COLUMNS)) {
      throw new Error(
        `aggregateCostRecords: unsupported groupBy "${query.groupBy}" (allowed: model, sessionId)`
      );
    }
    const groupExpr = query.groupBy
      ? `json_extract(data, '$.${COST_AGGREGATE_GROUP_COLUMNS[query.groupBy]}')`
      : `'__all__'`;
    // 分组聚合时排除缺 sessionId 的记录（O5）；无分组（全量窗口）不受影响
    const sessionNotNull = query.groupBy
      ? `AND json_extract(data, '$.sessionId') IS NOT NULL`
      : "";
    const stmt = this.db.prepare(`
      SELECT
        ${groupExpr} AS key,
        COALESCE(SUM(
          COALESCE(json_extract(data, '$.promptTokens'), 0)
          + COALESCE(json_extract(data, '$.completionTokens'), 0)
        ), 0) AS tokens,
        COALESCE(SUM(COALESCE(json_extract(data, '$.costUsd'), 0)), 0) AS costUsd,
        COUNT(*) AS recordCount
      FROM kv_store
      WHERE collection = 'cost_records'
        AND COALESCE(json_extract(data, '$.finishedAt'), 0) >= ?
        AND COALESCE(json_extract(data, '$.finishedAt'), 0) < ?
        ${sessionNotNull}
      GROUP BY key
    `);
    const rows = stmt.all(query.since, query.until) as Array<{
      key: string;
      tokens: number;
      costUsd: number;
      recordCount: number;
    }>;
    return rows;
  }

  /**
   * 底层连接句柄（可选能力）：SQLite 单机形态的 action 决策外置
   * （storage/sqlite-action-persist.ts）复用同一连接与建表模式建独立表，
   * 避免同文件双连接的写锁协调。只暴露句柄，不改驱动既有语义。
   */
  get database(): DatabaseSync {
    return this.db;
  }

  close() {
    this.db.close();
  }
}
