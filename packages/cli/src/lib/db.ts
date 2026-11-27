/**
 * CLI 原始 SQLite 访问辅助（M3 运维面）：backup / export / import / migrate / prune
 * 直接走 node:sqlite 连接（kv_store 形态的逻辑读写），不经服务运行时。
 *
 * **延迟加载**（评审 R4）：`node:sqlite` 只在真正用库时才 import。此前顶层静态
 * import 会让整个 CLI 在 Node < 22.13 上加载即崩（ERR_UNKNOWN_BUILTIN_MODULE），
 * 连 `vuagent doctor` / `--help` 都跑不起来——诊断工具自己先死，用户看不到
 * 「升级 Node」的指引。现在所有库操作都经 loadSqlite()，失败时抛可执行的错误。
 */
type SqliteModule = typeof import("node:sqlite");
export type SqliteDb = import("node:sqlite").DatabaseSync;

/** node:sqlite 不可用（版本过低 / 运行时禁用了该内置模块） */
export class SqliteUnavailableError extends Error {}

let cached: SqliteModule | null = null;

/** 加载 node:sqlite；失败时给出可执行的升级指引而不是裸 ERR_UNKNOWN_BUILTIN_MODULE */
export async function loadSqlite(): Promise<SqliteModule> {
  if (cached) return cached;
  try {
    cached = (await import("node:sqlite")) as SqliteModule;
    return cached;
  } catch {
    throw new SqliteUnavailableError(
      `当前 Node ${process.version} 不提供可用的 node:sqlite。` +
        `请升级到 Node ≥ 22.13（或 23.4+）后重试；也可用 \`vuagent doctor\` 复查环境。`,
    );
  }
}

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/** 打开库连接（读写由调用方的语句集合决定）；WAL 模式对齐服务端口径 */
export async function openDb(dbPath: string): Promise<SqliteDb> {
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  } catch {
    // 只读文件系统等场景：读语句不受影响
  }
  return db;
}

/** 以只读方式打开（校验产物 / 读源库） */
export async function openDbReadonly(dbPath: string): Promise<SqliteDb> {
  const { DatabaseSync } = await loadSqlite();
  return new DatabaseSync(dbPath, { readOnly: true });
}

/** VACUUM INTO 安全快照（写中可执行——取一致性读快照） */
export function vacuumInto(sourceDb: SqliteDb, outFile: string): void {
  sourceDb.exec(`VACUUM INTO '${escapeSqlString(outFile)}'`);
}

export interface KvRow {
  collection: string;
  id: string;
  data: unknown;
}

/** 全量逻辑行读取（kv_store 三列），按 collection+id 稳定排序 */
export function readAllRows(db: SqliteDb): KvRow[] {
  const rows = db
    .prepare("SELECT collection, id, data FROM kv_store ORDER BY collection, id")
    .all() as Array<{ collection: string; id: string; data: string }>;
  return rows.map((r) => ({ collection: r.collection, id: r.id, data: JSON.parse(r.data) as unknown }));
}

/** 写入一行（INSERT OR IGNORE / REPLACE 由调用方给 SQL 动词） */
export function writeRow(db: SqliteDb, verb: "INSERT OR IGNORE" | "INSERT OR REPLACE", row: KvRow): void {
  const stmt = db.prepare(
    `${verb} INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)`,
  );
  stmt.run(row.collection, row.id, JSON.stringify(row.data), Date.now());
}

export interface KvStats {
  collections: Array<{ collection: string; rows: number; bytes: number }>;
  totalRows: number;
  totalBytes: number;
}

/** 集合统计（doctor 的体积视图 / migrate dry-run 的对账基线） */
export function kvStats(db: SqliteDb): KvStats {
  const rows = db
    .prepare(
      `SELECT collection, COUNT(*) AS rows, COALESCE(SUM(LENGTH(data)), 0) AS bytes
       FROM kv_store GROUP BY collection ORDER BY bytes DESC`,
    )
    .all() as Array<{ collection: string; rows: number; bytes: number }>;
  return {
    collections: rows,
    totalRows: rows.reduce((a, r) => a + r.rows, 0),
    totalBytes: rows.reduce((a, r) => a + r.bytes, 0),
  };
}

/** 轮次行按会话聚合的字节排行（doctor：top sessions / 最大 turn 行） */
export function turnSizeLeaderboard(
  db: SqliteDb,
  top = 3,
): Array<{ sessionId: string; bytes: number; turns: number; maxTurnBytes: number }> {
  const rows = db
    .prepare("SELECT id, LENGTH(data) AS n FROM kv_store WHERE collection = 'session_turns'")
    .all() as Array<{ id: string; n: number }>;
  const bySession = new Map<string, { bytes: number; turns: number; maxTurnBytes: number }>();
  for (const r of rows) {
    const sessionId = r.id.slice(0, r.id.lastIndexOf(":"));
    const entry = bySession.get(sessionId) ?? { bytes: 0, turns: 0, maxTurnBytes: 0 };
    entry.bytes += r.n;
    entry.turns += 1;
    entry.maxTurnBytes = Math.max(entry.maxTurnBytes, r.n);
    bySession.set(sessionId, entry);
  }
  return [...bySession.entries()]
    .map(([sessionId, v]) => ({ sessionId, ...v }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top);
}

