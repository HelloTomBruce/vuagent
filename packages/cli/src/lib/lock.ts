/**
 * 单实例锁（0.7.0 数据目录规范 §5，docs/design/cli-data-dir-architecture.md）。
 *
 * 语义：同一数据目录同时只允许一个 vuagent 服务进程。SQLite WAL 能扛双写，
 * 但两个实例共享一份数据是「双主」——成本/审批/会话列表出现竞态，
 * 用户体验上就是「我明明发了消息却没反应」。默认拒绝，不做成日常开关。
 *
 * 实现：run/harness.lock，open(..., 'wx', 0o600) 独占创建；EEXIST 时读锁探活：
 *  - 持有者存活 → 拒绝（调用方按约定退出码 3 并打印三条出路）；
 *  - 持有者已死 / 文件损坏 / 空文件 → 视为残留：rename 为 .stale.<ts> 后重试一次
 *    （并发竞态下重试仍 EEXIST 则放弃，失败方退出比双写安全）。
 *
 * 逃逸口子：allowShared（对应 VUAGENT_ALLOW_SHARED=1，仅测试 / Redis 分布式形态）。
 */
import fs from "node:fs";
import path from "node:path";

export interface LockInfo {
  pid: number;
  startedAt: number;
  port: number;
  host: string;
  version: string;
  cwd: string;
}

export type AcquireResult =
  | { ok: true; release: () => void; shared: boolean; staleCleared?: string }
  | { ok: false; reason: "held"; holder: LockInfo }
  | { ok: false; reason: "io"; error: string };

export interface AcquireOptions {
  /** VUAGENT_ALLOW_SHARED=1：跳过锁（测试 / 分布式形态，自担双写风险） */
  allowShared?: boolean;
  /** 可注入探活函数（测试）；缺省 process.kill(pid, 0) */
  pidAliveFn?: (pid: number) => boolean;
}

/** 探活：ESRCH = 不存在；EPERM = 存在但无权限（算存活）；其余异常按不存在处理 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 读锁内容；文件不存在/损坏/字段不全返回 null（视为残留） */
export function readLock(lockFile: string): LockInfo | null {
  let raw: string;
  try {
    raw = fs.readFileSync(lockFile, "utf8");
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return null;
    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      port: parsed.port,
      host: typeof parsed.host === "string" ? parsed.host : "127.0.0.1",
      version: typeof parsed.version === "string" ? parsed.version : "",
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : "",
    };
  } catch {
    return null;
  }
}

function writeExclusive(lockFile: string, info: LockInfo): void {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lockFile, JSON.stringify(info, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

/** 删除锁：仅在持有者与期望 pid 一致时删除（绝不误删新主人的锁） */
export function releaseLock(lockFile: string, expectedPid: number): void {
  const holder = readLock(lockFile);
  if (holder && holder.pid !== expectedPid) return;
  try {
    fs.unlinkSync(lockFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** doctor --fix-lock：无条件清锁（用户确认进程已死后的手动兜底）。返回是否真的删到了文件 */
export function forceClearLock(lockFile: string): boolean {
  try {
    fs.unlinkSync(lockFile);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** 抢锁。成功返回 release()（正常退出路径调用，先关库后调） */
export function acquireLock(lockFile: string, info: LockInfo, options: AcquireOptions = {}): AcquireResult {
  if (options.allowShared) {
    return { ok: true, release: () => {}, shared: true };
  }
  const alive = options.pidAliveFn ?? pidAlive;

  let staleCleared: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeExclusive(lockFile, info);
      return {
        ok: true,
        shared: false,
        staleCleared,
        release: () => releaseLock(lockFile, info.pid),
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        return { ok: false, reason: "io", error: `${code ?? "ERR"}: ${(err as Error).message}` };
      }
      // 锁已存在：持有者存活 → 拒绝
      const holder = readLock(lockFile);
      if (holder && alive(holder.pid)) {
        return { ok: false, reason: "held", holder };
      }
      // 残留锁（进程已死 / 文件损坏 / 空文件）：改名挪开后重试一次
      if (attempt === 0) {
        staleCleared = `${lockFile}.stale.${Date.now()}`;
        try {
          fs.renameSync(lockFile, staleCleared);
        } catch (renameErr) {
          const renameCode = (renameErr as NodeJS.ErrnoException).code;
          // ENOENT：另一个实例刚好删掉/挪走了它，直接重试抢锁
          if (renameCode !== "ENOENT") {
            return { ok: false, reason: "io", error: `清理残留锁失败: ${(renameErr as Error).message}` };
          }
        }
      }
      // attempt === 1 时仍是 EEXIST：并发竞态下对方已抢到，下一循环读到的 holder 多半是存活的新主人
    }
  }
  // 两次都 EEXIST：读出当前持有者如实上报
  const holder = readLock(lockFile);
  if (holder) return { ok: false, reason: "held", holder };
  return { ok: false, reason: "io", error: "锁文件被并发创建，抢锁失败" };
}
