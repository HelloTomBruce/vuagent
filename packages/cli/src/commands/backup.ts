/**
 * vuagent backup —— VACUUM INTO 安全快照（M3/T14）。
 *
 * 为什么不能 cp：WAL 里有未 checkpoint 的页，直接拷主库会拿到不一致快照。
 * VACUUM INTO 取一致性读快照（写中可执行），顺带整理空间——实测 121MB（主库 112MB
 * + WAL 9MB）压缩到 51.6MB。产物落 exports/（--out 可指定），完成后对产物跑
 * integrity_check 验证。
 */
import fs from "node:fs";
import path from "node:path";
import { openDb, openDbReadonly, vacuumInto } from "../lib/db.js";

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function runBackup(paths: { dbPath: string; exportsDir: string }, options: { out?: string; json?: boolean }): Promise<number> {
  if (!fs.existsSync(paths.dbPath)) {
    console.error(`✗ 库不存在：${paths.dbPath}（先 vuagent start 创建）`);
    return 1;
  }
  fs.mkdirSync(paths.exportsDir, { recursive: true, mode: 0o700 });
  const out = path.resolve(options.out ?? path.join(paths.exportsDir, `harness-${timestamp()}.db`));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const before = {
    db: fs.statSync(paths.dbPath).size,
    wal: fs.existsSync(`${paths.dbPath}-wal`) ? fs.statSync(`${paths.dbPath}-wal`).size : 0,
  };

  const source = await openDb(paths.dbPath);
  try {
    vacuumInto(source, out);
  } finally {
    source.close();
  }

  const outSize = fs.statSync(out).size;
  // 产物自证：integrity_check
  const verify = await openDbReadonly(out);
  const integrity = (verify.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
  const rowCount = (verify.prepare("SELECT COUNT(*) AS n FROM kv_store").get() as { n: number }).n;
  verify.close();

  if (integrity !== "ok") {
    console.error(`✗ 备份完整性异常：${integrity}（产物 ${out}）`);
    return 1;
  }
  if (options.json) {
    console.log(JSON.stringify({ ok: true, out, outSize, integrity, rowCount, before: before }, null, 2));
  } else {
    console.log(`✓ 备份完成：${out}`);
    console.log(`  源 ${formatBytes(before.db)} + WAL ${formatBytes(before.wal)} → 产物 ${formatBytes(outSize)}（${rowCount} 行，integrity ok）`);
    console.log(`  恢复：停服后把产物拷回 ${paths.dbPath}（覆盖前先备份当前文件）`);
  }
  return 0;
}

function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
