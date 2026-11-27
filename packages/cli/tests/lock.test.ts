/**
 * 单实例锁单测（T02）：
 * wx 独占创建 / 存活持有者拒绝 / 残留锁（死 pid、损坏、空文件）改名抢占 /
 * release 只删自己的锁 / allowShared 跳过 / forceClearLock 兜底。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, releaseLock, readLock, forceClearLock, pidAlive, type LockInfo } from "../src/lib/lock.js";

let dir: string;
let lockFile: string;

function info(overrides: Partial<LockInfo> = {}): LockInfo {
  return {
    pid: process.pid,
    startedAt: Date.now(),
    port: 6880,
    host: "127.0.0.1",
    version: "0.7.0-test",
    cwd: dir,
    ...overrides,
  };
}

/** 找一个确定不存在的 pid（递增探测） */
function deadPid(): number {
  for (let p = 4_000_000; p < 40_000_000; p += 1337) {
    try {
      process.kill(p, 0);
    } catch {
      return p;
    }
  }
  throw new Error("找不到可用的死 pid");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-lock-"));
  lockFile = path.join(dir, "run", "harness.lock");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("pidAlive", () => {
  it("当前进程存活；死 pid 不存活；非法 pid 不存活", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(deadPid())).toBe(false);
    expect(pidAlive(0)).toBe(false);
    expect(pidAlive(-1)).toBe(false);
    expect(pidAlive(1.5)).toBe(false);
  });
});

describe("acquireLock", () => {
  it("首次抢锁：递归建目录，写入 JSON（0600），release 可删除", () => {
    const r = acquireLock(lockFile, info({ pid: process.pid, port: 7000 }));
    expect(r.ok).toBe(true);

    const holder = readLock(lockFile);
    expect(holder?.pid).toBe(process.pid);
    expect(holder?.port).toBe(7000);
    expect(holder?.host).toBe("127.0.0.1");
    if (r.ok) expect(r.shared).toBe(false);
    if (process.platform !== "win32") {
      expect(fs.statSync(lockFile).mode & 0o777).toBe(0o600);
    }

    if (r.ok) r.release();
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it("持有者存活：第二个实例被拒绝（reason=held，含持有者信息）", () => {
    const first = acquireLock(lockFile, info({ pid: process.pid, port: 6880 }));
    expect(first.ok).toBe(true);

    const second = acquireLock(lockFile, info({ pid: deadPid(), port: 6881 }));
    expect(second.ok).toBe(false);
    if (!second.ok && second.reason === "held") {
      expect(second.holder.pid).toBe(process.pid);
      expect(second.holder.port).toBe(6880);
    } else {
      expect.unreachable("应当因持有者存活被拒绝");
    }

    if (first.ok) first.release();
  });

  it("残留锁（pid 已死）：改名 .stale.* 后抢占成功，并报告 staleCleared", () => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify(info({ pid: deadPid(), port: 6880 })));

    const r = acquireLock(lockFile, info({ pid: process.pid, port: 6881 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.staleCleared).toMatch(/harness\.lock\.stale\.\d+$/);
      expect(fs.existsSync(r.staleCleared!)).toBe(true);
      expect(readLock(lockFile)?.port).toBe(6881);
      r.release();
    }
  });

  it("残留锁（内容损坏 / 空文件）同样可抢占", () => {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, "not-json{{{");
    const r1 = acquireLock(lockFile, info({ pid: process.pid }));
    expect(r1.ok).toBe(true);
    if (r1.ok) r1.release();

    fs.writeFileSync(lockFile, "");
    const r2 = acquireLock(lockFile, info({ pid: process.pid }));
    expect(r2.ok).toBe(true);
    if (r2.ok) r2.release();
  });

  it("allowShared：跳过锁、不写文件、release 是空操作", () => {
    const r = acquireLock(lockFile, info({ pid: process.pid }), { allowShared: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shared).toBe(true);
      expect(fs.existsSync(lockFile)).toBe(false);
      r.release();
    }
  });

  it("残留锁挪不动（目录只读）：按 io 失败如实上报，不双写", () => {
    if (process.platform === "win32") return; // chmod 语义不同，Windows 走 M4 专项
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, JSON.stringify(info({ pid: deadPid() })));
    fs.chmodSync(path.dirname(lockFile), 0o500);
    try {
      const r = acquireLock(lockFile, info({ pid: process.pid }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("io");
    } finally {
      fs.chmodSync(path.dirname(lockFile), 0o700); // 恢复以便 afterEach 清理
    }
  });
});

describe("releaseLock", () => {
  it("pid 不匹配时绝不误删新主人的锁", () => {
    const r = acquireLock(lockFile, info({ pid: process.pid }));
    expect(r.ok).toBe(true);
    releaseLock(lockFile, deadPid()); // 假装别人来释放
    expect(fs.existsSync(lockFile)).toBe(true);
    releaseLock(lockFile, process.pid);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it("锁不存在时 release 静默通过", () => {
    expect(() => releaseLock(lockFile, process.pid)).not.toThrow();
  });
});

describe("forceClearLock（doctor --fix-lock）", () => {
  it("有锁则删（返回 true），无锁返回 false", () => {
    const r = acquireLock(lockFile, info({ pid: process.pid }));
    expect(r.ok).toBe(true);
    expect(forceClearLock(lockFile)).toBe(true);
    expect(fs.existsSync(lockFile)).toBe(false);
    expect(forceClearLock(lockFile)).toBe(false);
  });
});
