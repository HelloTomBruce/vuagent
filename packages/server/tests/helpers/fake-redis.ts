import type { RedisLike } from "../../src/storage/drivers/redis.driver.js";
import {
  TURN_LEASE_HEARTBEAT_LUA,
  TURN_LEASE_RELEASE_LUA,
} from "../../src/core/turn-lease.js";

interface FakeEntry {
  value: string;
  /** null = 不过期；否则为过期时刻 epoch ms（读路径惰性删除） */
  expiresAt: number | null;
}

/**
 * 内存 fake RedisLike（测试专用替身，禁止连真实 Redis）
 *
 * 语义取舍：
 * - 过期用「时间戳惰性删除」：所有读路径（get/keys/scan/del 计数/expire）先做过期判定，
 *   命中过期键当场删除并视为不存在；时钟经构造注入（now），测试可显式推进，无真实 sleep。
 * - SET 解析 NX / PX / EX 子命令（驱动与租约所需子集）；NX 命中已存在键返回 null（对齐 ioredis）。
 * - SCAN 用「数值游标分页」模拟：MATCH glob 过滤 → 按当前偏移切片 COUNT 条，
 *   nextCursor 为剩余偏移（耗尽返回 "0"）。保证不漏键、游标可循环，但不复刻 Redis 的
 *   反向二进制迭代细节——对驱动/租约的游标循环已足够。
 * - eval 只精确模拟租约两段 Lua（按脚本常量等值匹配，语义由原生 Map 逻辑复刻），
 *   其余脚本直接抛错——避免在 fake 里内嵌 Lua 解释器。
 */
export class FakeRedis implements RedisLike {
  private store = new Map<string, FakeEntry>();

  /** 故障注入：置 true 后所有命令抛错（模拟 Redis 不可达） */
  failAll = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** 测试直读原始条目（断言 TTL / 值形状用，不做过期清理） */
  peek(key: string): FakeEntry | null {
    return this.store.get(key) ?? null;
  }

  /** 测试注入原始键值（绕过驱动，验证 keyspace 形态 / 前缀隔离用） */
  async putRaw(key: string, value: string): Promise<void> {
    this.store.set(key, { value, expiresAt: null });
  }

  /** 惰性过期判定：命中过期键当场删除 */
  private alive(key: string): FakeEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  private assertAlive(): void {
    if (this.failAll) {
      throw new Error("FakeRedis: 注入故障（failAll）");
    }
  }

  async get(key: string): Promise<string | null> {
    this.assertAlive();
    const entry = this.alive(key);
    return entry ? entry.value : null;
  }

  async set(key: string, value: string, ...options: Array<string | number>): Promise<unknown> {
    this.assertAlive();
    let nx = false;
    let pxMs: number | null = null;
    let exSec: number | null = null;
    for (let i = 0; i < options.length; i++) {
      const token = String(options[i]).toUpperCase();
      if (token === "NX") nx = true;
      else if (token === "PX") pxMs = Number(options[++i]);
      else if (token === "EX") exSec = Number(options[++i]);
    }
    if (nx && this.alive(key) !== null) return null;
    let expiresAt: number | null = null;
    if (pxMs !== null) expiresAt = this.now() + pxMs;
    else if (exSec !== null) expiresAt = this.now() + exSec * 1000;
    this.store.set(key, { value, expiresAt });
    return "OK";
  }

  async setEx(key: string, seconds: number, value: string): Promise<unknown> {
    this.assertAlive();
    this.store.set(key, { value, expiresAt: this.now() + seconds * 1000 });
    return "OK";
  }

  async pSetEx(key: string, milliseconds: number, value: string): Promise<unknown> {
    this.assertAlive();
    this.store.set(key, { value, expiresAt: this.now() + milliseconds });
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    this.assertAlive();
    let removed = 0;
    for (const key of keys) {
      if (this.alive(key) !== null) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async keys(pattern: string): Promise<string[]> {
    this.assertAlive();
    const re = globToRegex(pattern);
    const out: string[] = [];
    for (const key of this.store.keys()) {
      if (this.alive(key) !== null && re.test(key)) out.push(key);
    }
    return out;
  }

  async scan(
    cursor: string | number,
    ...options: Array<string | number>
  ): Promise<[string, string[]]> {
    this.assertAlive();
    let match = "*";
    let count = 10;
    for (let i = 0; i < options.length; i++) {
      const token = String(options[i]).toUpperCase();
      if (token === "MATCH") match = String(options[++i]);
      else if (token === "COUNT") count = Number(options[++i]);
    }
    const re = globToRegex(match);
    const all: string[] = [];
    for (const key of this.store.keys()) {
      if (this.alive(key) !== null && re.test(key)) all.push(key);
    }
    const offset = Math.max(0, Math.floor(Number(cursor) || 0));
    const batch = all.slice(offset, offset + count);
    const next = offset + batch.length;
    return [next >= all.length ? "0" : String(next), batch];
  }

  async incrBy(key: string, increment: number): Promise<number> {
    this.assertAlive();
    const entry = this.alive(key);
    const current = entry ? Number(entry.value) || 0 : 0;
    const next = current + increment;
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.assertAlive();
    const entry = this.alive(key);
    if (!entry) return 0;
    entry.expiresAt = this.now() + seconds * 1000;
    return 1;
  }

  async eval(
    script: string,
    _numKeys: number,
    ...keysAndArgs: Array<string | number>
  ): Promise<unknown> {
    this.assertAlive();
    if (script === TURN_LEASE_HEARTBEAT_LUA) {
      // ARGV: [key, turnId, instanceId, ttlMs]
      const [key, turnId, instanceId, ttlMs] = keysAndArgs as [
        string,
        string,
        string,
        number,
      ];
      return this.luaMatchedWrite(key, String(turnId), String(instanceId), (entry) => {
        entry.expiresAt = this.now() + Number(ttlMs);
        return 1;
      });
    }
    if (script === TURN_LEASE_RELEASE_LUA) {
      // ARGV: [key, turnId, instanceId]
      const [key, turnId, instanceId] = keysAndArgs as [string, string, string];
      return this.luaMatchedWrite(key, String(turnId), String(instanceId), () => {
        this.store.delete(key);
        return 1;
      });
    }
    throw new Error(`FakeRedis.eval: 未模拟的 Lua 脚本（${script.slice(0, 40)}…）`);
  }

  /** 两段租约 Lua 的共同语义：值 JSON 解码后 turnId+instanceId 匹配才执行动作 */
  private luaMatchedWrite(
    key: string,
    turnId: string,
    instanceId: string,
    action: (entry: FakeEntry) => number
  ): number {
    const entry = this.alive(key);
    if (!entry) return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.value);
    } catch {
      return 0;
    }
    const val = parsed as { turnId?: unknown; instanceId?: unknown } | null;
    if (!val || val.turnId !== turnId || val.instanceId !== instanceId) return 0;
    return action(entry);
  }
}

/** 可推进的测试时钟（显式推进，无真实 sleep） */
export function createTestClock() {
  let nowMs = 0;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

/** Redis 风格 glob（仅 * 与 ?）→ 正则；其余元字符转义 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
