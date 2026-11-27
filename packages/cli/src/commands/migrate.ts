/**
 * vuagent migrate —— 两类迁移（M3/T11）：
 *
 * ① `--from <db>`：旧散落库（如 CWD 时代的 ./.vuagent/harness.db）→ 当前数据目录。
 *    逻辑行级拷贝（INSERT OR IGNORE，冲突跳过并汇总），不删除源库；--dry-run 只统计。
 *
 * ② `--checkpoints`：W2 拆行迁移——legacy turn 行内联的完整 checkpoint（含快照）
 *    → session_checkpoints 独立集合。执行前强制 VACUUM 备份（--no-backup 跳过）；
 *    --dry-run 只统计；迁移期对「content 为空且最后快照含 assistant 回复」的 turn
 *    物化 content（一次性消除旧 console 的快照反推兜底依赖）。
 *    拆行即刻 meta 化（不做「保留内联 + 标记」双存储）——双存储会使 checkpointCount
 *    与详情体积语义混乱；原始数据的观察窗口由强制备份承载（--no-backup 可跳过）。
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, openDbReadonly, readAllRows, writeRow, vacuumInto } from "../lib/db.js";
import { readLock, pidAlive } from "../lib/lock.js";

interface MigrateStats {
  scanned: number;
  copied: number;
  conflicts: number;
  perCollection: Array<{ collection: string; copied: number; conflicts: number }>;
}

/** ① 通用库搬迁：源库全量逻辑行 → 当前库（INSERT OR IGNORE / REPLACE） */
async function migrateFrom(sourceDbPath: string, targetDbPath: string, options: { dryRun?: boolean; overwrite?: boolean; vacuum?: boolean }): Promise<number> {
  if (!fs.existsSync(sourceDbPath)) {
    console.error(`✗ 源库不存在：${sourceDbPath}`);
    return 1;
  }
  const source = await openDbReadonly(sourceDbPath);
  let rows: ReturnType<typeof readAllRows>;
  try {
    rows = readAllRows(source);
  } finally {
    source.close();
  }
  const target = await openDb(targetDbPath);
  try {
    // 冲突统计：目标已存在同 (collection, id)
    const conflicts = new Map<string, number>();
    const perCollection = new Map<string, { copied: number; conflicts: number }>();
    for (const row of rows) {
      const exists = (target.prepare("SELECT COUNT(*) AS n FROM kv_store WHERE collection = ? AND id = ?").get(row.collection, row.id) as { n: number }).n;
      const stat = perCollection.get(row.collection) ?? { copied: 0, conflicts: 0 };
      if (exists > 0) {
        conflicts.set(row.collection, (conflicts.get(row.collection) ?? 0) + 1);
        stat.conflicts++;
        if (!options.overwrite) {
          perCollection.set(row.collection, stat);
          continue;
        }
      }
      if (!options.dryRun) writeRow(target, options.overwrite ? "INSERT OR REPLACE" : "INSERT OR IGNORE", row);
      if (exists === 0 || options.overwrite) stat.copied++;
      perCollection.set(row.collection, stat);
    }
    const stats: MigrateStats = {
      scanned: rows.length,
      copied: [...perCollection.values()].reduce((a, v) => a + v.copied, 0),
      conflicts: [...conflicts.values()].reduce((a, v) => a + v, 0),
      perCollection: [...perCollection.entries()].map(([collection, v]) => ({ collection, ...v })).sort((a, b) => a.collection.localeCompare(b.collection)),
    };
    if (options.dryRun) {
      console.log(`[dry-run] 源 ${rows.length} 行：将拷贝 ${options.overwrite ? rows.length : stats.copied}，冲突跳过 ${stats.conflicts}`);
      for (const c of stats.perCollection) console.log(`    ${c.collection}: 拷 ${c.copied} / 冲突 ${c.conflicts}`);
    } else {
      if (options.vacuum) target.exec("VACUUM");
      console.log(`✓ 迁移完成：源 ${stats.scanned} 行 → 拷贝 ${stats.copied} / 冲突跳过 ${stats.conflicts}${options.vacuum ? "（VACUUM 已执行）" : ""}`);
      for (const c of stats.perCollection) console.log(`    ${c.collection}: 拷 ${c.copied} / 冲突 ${c.conflicts}`);
      console.log(`  源库保留未动：${sourceDbPath}（确认无误后手动删除）`);
    }
    return 0;
  } finally {
    target.close();
  }
}

interface CheckpointMigrateStats {
  legacyTurns: number;
  checkpoints: number;
  snapshotBytes: number;
  contentMaterialized: number;
}

/** legacy 判定：数组存在、含完整实体（有 messagesSnapshot）、无拆行标记 */
function isLegacyInlineTurn(turn: { checkpoints?: unknown[]; checkpointsSplit?: boolean }): boolean {
  if (turn.checkpointsSplit === true) return false;
  return Array.isArray(turn.checkpoints) && turn.checkpoints.some((c) => Array.isArray((c as { messagesSnapshot?: unknown }).messagesSnapshot));
}

/** ② W2 拆行迁移：逐 turn 搬快照 + meta 化 + content 物化 */
async function migrateCheckpoints(dbPath: string, exportsDir: string, options: { dryRun?: boolean; noBackup?: boolean; vacuum?: boolean; session?: string }): Promise<number> {
  if (!fs.existsSync(dbPath)) {
    console.error(`✗ 库不存在：${dbPath}`);
    return 1;
  }
  const db = await openDb(dbPath);
  try {
    const turnRows = db.prepare("SELECT id, data FROM kv_store WHERE collection = 'session_turns'").all() as Array<{ id: string; data: string }>;
    const stats: CheckpointMigrateStats = { legacyTurns: 0, checkpoints: 0, snapshotBytes: 0, contentMaterialized: 0 };
    const affected: Array<{ rowKey: string; turn: Record<string, unknown> }> = [];

    for (const row of turnRows) {
      if (options.session && !row.id.startsWith(`${options.session}:`)) continue;
      const wrapper = JSON.parse(row.data) as { index: number; turn: Record<string, unknown> };
      const turn = wrapper.turn;
      if (!isLegacyInlineTurn(turn)) continue;

      const cps = (turn.checkpoints ?? []) as Array<{
        id: string;
        turnId: string;
        stepIndex: number;
        messagesSnapshot?: unknown[];
        snapshotAt: number;
      }>;

      // content 物化：content 为空且最后快照含 assistant 回复（旧 console 反推兜底的替代）
      const lastFull = [...cps].reverse().find((c) => Array.isArray(c.messagesSnapshot) && c.messagesSnapshot.length > 0);
      const contentEmpty = typeof turn.content !== "string" || turn.content.length === 0;
      if (contentEmpty && lastFull) {
        const assistant = [...(lastFull.messagesSnapshot as Array<{ role: string; content?: string }>)]
          .reverse()
          .find((m) => m.role === "assistant" && m.content);
        if (assistant) stats.contentMaterialized++;
      }

      stats.legacyTurns++;
      stats.checkpoints += cps.length;
      stats.snapshotBytes += JSON.stringify(cps).length;
      affected.push({ rowKey: row.id, turn });
    }

    if (options.dryRun) {
      console.log(`[dry-run] legacy turn ${stats.legacyTurns} 个 / checkpoint ${stats.checkpoints} 条 / 快照 ${Math.round(stats.snapshotBytes / 1024)} KB 将移入 session_checkpoints`);
      console.log(`  content 物化轮次：${stats.contentMaterialized}`);
      console.log(`  执行（不带 --dry-run）将先 VACUUM 备份到 exports/，turn 行转为元数据（原始数据在备份中保留）`);
      return 0;
    }

    // 执行前强制备份（观察窗口；--no-backup 显式跳过）
    if (!options.noBackup) {
      fs.mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
      const backupPath = path.join(exportsDir, `pre-migrate-${Date.now()}.db`);
      vacuumInto(db, backupPath);
      console.log(`✓ 已备份：${backupPath}（${Math.round(fs.statSync(backupPath).size / 1024)} KB）`);
    }

    db.exec("BEGIN");
    try {
      const insert = db.prepare(
        "INSERT OR REPLACE INTO kv_store (collection, id, data, updated_at) VALUES (?, ?, ?, ?)"
      );
      for (const { rowKey, turn } of affected) {
        const sessionId = rowKey.slice(0, rowKey.lastIndexOf(":"));
        const turnId = rowKey.slice(rowKey.lastIndexOf(":") + 1);
        const cps = (turn.checkpoints ?? []) as Array<{ id: string; turnId: string; stepIndex: number; messagesSnapshot?: unknown[]; snapshotAt: number }>;
        const metas: Array<Record<string, unknown>> = [];
        for (const cp of cps) {
          insert.run("session_checkpoints", ckptRowKey(sessionId, turnId, cp.id), JSON.stringify({ sessionId, checkpoint: cp }), Date.now());
          metas.push({ id: cp.id, turnId, stepIndex: cp.stepIndex, snapshotAt: cp.snapshotAt });
        }

        // content 物化
        const contentEmpty = typeof turn.content !== "string" || turn.content.length === 0;
        if (contentEmpty) {
          const lastFull = [...cps].reverse().find((c) => Array.isArray(c.messagesSnapshot) && c.messagesSnapshot.length > 0);
          if (lastFull) {
            const assistant = [...(lastFull.messagesSnapshot as Array<{ role: string; content?: string }>)]
              .reverse()
              .find((m) => m.role === "assistant" && m.content);
            if (assistant) turn.content = assistant.content;
          }
        }

        turn.checkpoints = metas;
        turn.checkpointCount = metas.length;
        turn.checkpointsSplit = true;
        db.prepare("UPDATE kv_store SET data = ?, updated_at = ? WHERE collection = 'session_turns' AND id = ?").run(
          JSON.stringify({ index: (turn as { index?: number }).index ?? 0, turn }),
          Date.now(),
          rowKey,
        );
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

    console.log(`✓ 迁移完成：turn ${stats.legacyTurns} 个 / checkpoint ${stats.checkpoints} 条 / 物化 content ${stats.contentMaterialized} 轮`);
    console.log(`  快照已移入 session_checkpoints；turn 行只剩元数据（详情接口即刻瘦身）`);
    if (options.vacuum) {
      db.exec("VACUUM");
      console.log(`  ✓ VACUUM 完成（库文件紧凑化：${Math.round(fs.statSync(dbPath).size / 1024)} KB）`);
    } else {
      console.log(`  空间回收：重跑加 --vacuum 立即紧凑化（删除页先留给自然写入复用）`);
    }
    return 0;
  } finally {
    db.close();
  }
}

function ckptRowKey(sessionId: string, turnId: string, checkpointId: string): string {
  return `${sessionId}:${turnId}:${checkpointId}`;
}

/** 锁持有中提示（写迁移与在途实例竞争，提示但不阻断——VACUUM/拷贝均在线安全） */
export function warnIfInstanceRunning(lockFile: string): void {
  const holder = readLock(lockFile);
  if (holder && pidAlive(holder.pid)) {
    console.warn(`⚠ 检测到运行中的实例（pid ${holder.pid}）——写类迁移建议先停服再执行`);
  }
}

export interface MigrateOptions {
  from?: string;
  checkpoints?: boolean;
  dryRun?: boolean;
  overwrite?: boolean;
  noBackup?: boolean;
  /** 迁移完成后 VACUUM 原地紧凑化（删除的数据页归还 OS） */
  vacuum?: boolean;
  /** 只迁移指定会话（--session） */
  session?: string;
  json?: boolean;
}

export async function runMigrate(
  paths: { dbPath: string; lockFile: string; exportsDir: string },
  options: MigrateOptions,
): Promise<number> {
  if (options.from) {
    return migrateFrom(path.resolve(options.from), paths.dbPath, {
      dryRun: options.dryRun,
      overwrite: options.overwrite,
    });
  }
  if (options.checkpoints) {
    warnIfInstanceRunning(paths.lockFile);
    return migrateCheckpoints(paths.dbPath, paths.exportsDir, {
      dryRun: options.dryRun,
      noBackup: options.noBackup,
      session: options.session,
    });
  }
  console.error("✗ 缺迁移目标：--from <db>（散落库搬迁）或 --checkpoints（W2 拆行迁移）");
  return 1;
}
