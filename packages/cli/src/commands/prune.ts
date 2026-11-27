/**
 * vuagent prune —— 显式清理（M3/T15；决策 3：不做默认 retention，清理只能显式）。
 *
 * 口径：
 * - `--older-than <duration>`（30d / 12h / 90d）：updatedAt 早于截止的会话级联删除
 *   （会话主文档 + turn 行 + checkpoint 行），cost_records 按同截止时间清理；
 * - `--keep <sessionId>` 可重复：豁免名单；
 * - `--vacuum`：删除后 VACUUM 回收空间（否则空间留待复用，文件不缩小）；
 * - `--dry-run`：只列出将删除的会话，不动数据。
 */
import fs from "node:fs";
import { openDb } from "../lib/db.js";
import { likePrefix } from "@vuagent/server";

/** "30d" / "12h" / "45m" → 毫秒 */
export function parseDuration(input: string): number | null {
  const m = /^(\d+)([dhm])$/.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[m[2] as "d" | "h" | "m"];
  return n * unit;
}

interface SessionRow {
  id: string;
  data: { title?: string; updatedAt?: number; createdAt?: number };
}

export async function runPrune(
  paths: { dbPath: string },
  options: {
    olderThan?: string;
    keep?: string[];
    vacuum?: boolean;
    dryRun?: boolean;
    json?: boolean;
  },
): Promise<number> {
  if (!fs.existsSync(paths.dbPath)) {
    console.error(`✗ 库不存在：${paths.dbPath}`);
    return 1;
  }
  if (!options.olderThan) {
    console.error("✗ 缺 --older-than <duration>（如 30d）——prune 必须显式给删除口径");
    return 1;
  }
  const durationMs = parseDuration(options.olderThan);
  if (durationMs === null) {
    console.error(`✗ --older-than 格式非法：${options.olderThan}（示例 30d / 12h / 45m）`);
    return 1;
  }
  const keep = new Set(options.keep ?? []);
  const cutoff = Date.now() - durationMs;

  const db = await openDb(paths.dbPath);
  try {
    const all = db.prepare("SELECT id, data FROM kv_store WHERE collection = 'sessions'").all() as Array<{
      id: string;
      data: string;
    }>;
    const sessions: SessionRow[] = all.map((r) => ({ id: r.id, data: JSON.parse(r.data) as SessionRow["data"] }));
    const doomed = sessions.filter(
      (s) => !keep.has(s.id) && (s.data.updatedAt ?? s.data.createdAt ?? 0) < cutoff,
    );

    if (options.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({ dryRun: true, cutoff: new Date(cutoff).toISOString(), wouldDelete: doomed.map((s) => ({ id: s.id, title: s.data.title ?? "" })) }, null, 2));
      } else {
        console.log(`[dry-run] 截止 ${new Date(cutoff).toISOString()} 之前更新的会话将删除（${doomed.length} 个）：`);
        for (const s of doomed) console.log(`    ${s.id}  ${s.data.title ?? "（无标题）"}`);
        if (doomed.length === 0) console.log("    （无）");
        console.log("  执行（去掉 --dry-run）级联删除 turn 行与 checkpoint 行；--vacuum 回收空间");
      }
      return 0;
    }

    if (doomed.length === 0) {
      console.log("✓ 无符合口径的会话，未删除任何数据");
      return 0;
    }

    let costDeleted = 0;
    db.exec("BEGIN");
    try {
      const delRow = db.prepare("DELETE FROM kv_store WHERE collection = ? AND id = ?");
      for (const s of doomed) {
        // turn 行与 checkpoint 行键可从 turn 行的 checkpoint ids 构造（meta/legacy 双形态都含 id）
        const turnRows = db
          .prepare("SELECT id, data FROM kv_store WHERE collection = 'session_turns' AND id LIKE ? ESCAPE '\\'")
          .all(likePrefix(`${s.id}:`)) as Array<{ id: string; data: string }>;
        for (const row of turnRows) {
          const turnId = row.id.slice(row.id.lastIndexOf(":") + 1);
          const turn = JSON.parse(row.data) as { turn?: { checkpoints?: Array<{ id: string }> } };
          for (const cp of turn.turn?.checkpoints ?? []) {
            delRow.run("session_checkpoints", `${s.id}:${turnId}:${cp.id}`);
          }
          delRow.run("session_turns", row.id);
        }
        delRow.run("sessions", s.id);
      }
      // 成本台账按同截止时间清理（与级联删除同一事务：避免「会话删了、成本还在」的半状态）
      costDeleted = pruneCostRecords(db, cutoff);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // 不掩盖原始错误
      }
      throw err;
    }

    // VACUUM 必须独占连接（原地整理；close 时 WAL 自动 checkpoint）——先关本连接再开紧凑连接
    db.close();
    if (options.vacuum) {
      const compactConn = await openDb(paths.dbPath);
      compactConn.exec("VACUUM");
      compactConn.close();
      console.log("✓ VACUUM 完成（库文件已紧凑化）");
    }

    return finishReport(doomed.length, costDeleted, doomed, options);
  } catch (err) {
    try {
      db.close();
    } catch {
      // 已关则忽略
    }
    throw err;
  }
}

function finishReport(deletedSessions: number, costDeleted: number, doomed: Array<{ id: string; data: { title?: string } }>, options: { json?: boolean; vacuum?: boolean }): number {
  if (options.json) {
    console.log(JSON.stringify({ ok: true, deletedSessions, deletedCostRecords: costDeleted, ids: doomed.map((s) => s.id) }, null, 2));
  } else {
    console.log(`✓ 已删除 ${deletedSessions} 个会话（级联 turn/checkpoint 行）+ ${costDeleted} 条成本记录`);
    for (const s of doomed) console.log(`    ${s.id}  ${s.data.title ?? "（无标题）"}`);
    if (!options.vacuum) console.log("  空间回收：加 --vacuum 立即紧凑化（或留给后续写入复用）");
  }
  return 0;
}


/** 成本台账清理（对齐 CostRecordRepository.pruneBefore 的 finishedAt 口径） */
function pruneCostRecords(db: import("../lib/db.js").SqliteDb, cutoff: number): number {
  const rows = db.prepare("SELECT id, data FROM kv_store WHERE collection = 'cost_records'").all() as Array<{ id: string; data: string }>;
  let deleted = 0;
  const del = db.prepare("DELETE FROM kv_store WHERE collection = 'cost_records' AND id = ?");
  for (const r of rows) {
    const rec = JSON.parse(r.data) as { finishedAt?: number };
    if ((rec.finishedAt ?? 0) < cutoff) {
      del.run(r.id);
      deleted++;
    }
  }
  return deleted;
}
