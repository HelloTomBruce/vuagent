import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IStorageDriver } from "./base.driver.js";

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

  async clear(collection?: string): Promise<void> {
    if (collection) {
      const stmt = this.db.prepare("DELETE FROM kv_store WHERE collection = ?");
      stmt.run(collection);
    } else {
      this.db.exec("DELETE FROM kv_store;");
    }
  }

  close() {
    this.db.close();
  }
}
