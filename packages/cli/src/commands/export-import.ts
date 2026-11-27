/**
 * vuagent export / import —— 逻辑导出与回灌（M3/T14，跨机/跨版本迁移）。
 *
 * 形态：单 JSON 文件 { schemaVersion, exportedAt, counts, rows: [{collection,id,data}] }。
 * 行集合 = kv_store 全量逻辑行（含 ids），import 按 schemaVersion 校验后以
 * INSERT OR IGNORE（skip，默认）/ REPLACE（overwrite）回灌，逐集合汇总计数。
 * 与 backup（二进制快照）互补：export 供人工检视/部分恢复，backup 供整机恢复。
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, readAllRows, writeRow, type KvRow } from "../lib/db.js";

const SCHEMA_VERSION = 1;

export interface ExportFile {
  schemaVersion: number;
  exportedAt: string;
  source: "vuagent-cli";
  counts: Array<{ collection: string; rows: number }>;
  rows: KvRow[];
}

export async function runExport(paths: { dbPath: string; exportsDir: string }, options: { out?: string; json?: boolean }): Promise<number> {
  if (!fs.existsSync(paths.dbPath)) {
    console.error(`✗ 库不存在：${paths.dbPath}（先 vuagent start 创建）`);
    return 1;
  }
  fs.mkdirSync(paths.exportsDir, { recursive: true, mode: 0o700 });
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const out = path.resolve(
    options.out ?? path.join(paths.exportsDir, `export-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`),
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const db = await openDb(paths.dbPath);
  const rows = readAllRows(db);
  db.close();

  const byCollection = new Map<string, number>();
  for (const row of rows) byCollection.set(row.collection, (byCollection.get(row.collection) ?? 0) + 1);
  const file: ExportFile = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source: "vuagent-cli",
    counts: [...byCollection.entries()].map(([collection, count]) => ({ collection, rows: count })).sort((a, b) => a.collection.localeCompare(b.collection)),
    rows,
  };
  fs.writeFileSync(out, JSON.stringify(file, null, 1), { mode: 0o600 });

  if (options.json) {
    console.log(JSON.stringify({ ok: true, out, rows: rows.length, counts: file.counts }, null, 2));
  } else {
    console.log(`✓ 导出完成：${out}`);
    console.log(`  ${rows.length} 行 / ${byCollection.size} 个集合`);
    for (const c of file.counts) console.log(`    ${c.collection}: ${c.rows}`);
  }
  return 0;
}

export async function runImport(
  paths: { dbPath: string },
  inputPath: string,
  options: { strategy?: "skip" | "overwrite"; json?: boolean },
): Promise<number> {
  if (!fs.existsSync(paths.dbPath)) {
    console.error(`✗ 库不存在：${paths.dbPath}（先 vuagent start 创建，或直接空目录起一次服务）`);
    return 1;
  }
  let file: ExportFile;
  try {
    file = JSON.parse(fs.readFileSync(inputPath, "utf8")) as ExportFile;
  } catch (err) {
    console.error(`✗ 读取/解析失败：${(err as Error).message}`);
    return 1;
  }
  if (file.schemaVersion !== SCHEMA_VERSION) {
    console.error(`✗ schemaVersion 不兼容：文件 ${file.schemaVersion}，本 CLI 支持 ${SCHEMA_VERSION}（跨大版本请先升级 CLI）`);
    return 1;
  }
  if (!Array.isArray(file.rows)) {
    console.error("✗ 文件缺少 rows 数组");
    return 1;
  }

  const verb = options.strategy === "overwrite" ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
  const db = await openDb(paths.dbPath);
  try {
    let written = 0;
    let skipped = 0;
    const perCollection = new Map<string, { written: number; skipped: number }>();
    // 单事务回灌（驱动语句同步，微任务不穿插外部写）
    db.exec("BEGIN");
    try {
      for (const row of file.rows) {
        const before = (db.prepare("SELECT COUNT(*) AS n FROM kv_store WHERE collection = ? AND id = ?").get(row.collection, row.id) as { n: number }).n;
        const stat = perCollection.get(row.collection) ?? { written: 0, skipped: 0 };
        if (before > 0 && verb === "INSERT OR IGNORE") {
          skipped++;
          stat.skipped++;
        } else {
          writeRow(db, verb, row);
          written++;
          stat.written++;
        }
        perCollection.set(row.collection, stat);
      }
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // 不掩盖原始错误
      }
      throw err;
    }

    if (options.json) {
      console.log(JSON.stringify({ ok: true, strategy: verb.includes("REPLACE") ? "overwrite" : "skip", written, skipped, perCollection: [...perCollection.entries()].map(([collection, v]) => ({ collection, ...v })) }, null, 2));
    } else {
      console.log(`✓ 导入完成（策略 ${verb.includes("REPLACE") ? "overwrite" : "skip"}）：写入 ${written}，跳过 ${skipped}`);
      for (const [collection, v] of [...perCollection.entries()].sort()) {
        console.log(`    ${collection}: 写 ${v.written} / 跳 ${v.skipped}`);
      }
    }
    return 0;
  } finally {
    db.close();
  }
}
