import type { RedisLike } from "../storage/drivers/redis.driver.js";

/**
 * 跨副本轮次租约 (TurnLeaseManager)
 * 单副本形态下 SessionExecutionHub.claimTurn 的「running 冲突 409 / preempt 顶替」
 * 完全在进程内裁决；多副本部署时需要把「同一会话同一时刻只有一个轮次在跑」提升为
 * 全局约束——本管理器用 Redis 分布式锁语义实现，供 server.ts 接线层在 claimTurn
 * 准入时调用（接线由后续任务完成）。
 *
 * 语义约定：
 * - 租约键：`vuagent:lease:<sessionId>`（sessionId 经 encodeURIComponent + `*`→%2A）；
 * - 租约值：JSON {instanceId, turnId, acquiredAt}；
 * - acquire = SET NX PX（原子互斥）；心跳 = 值语义匹配才 PEXPIRE（原子 Lua）；
 *   release = 值语义匹配才 DEL（原子 Lua，不会误删他副本租约）；
 * - Redis 故障一律 fail-closed：acquire/heartbeat/release 返回 false
 *   （拿不到/保不住租约就不该跑），sweepOrphans 按语义返回空数组，全部不抛出。
 */

/** 租约值形状（JSON 序列化后作为 Redis value） */
export interface TurnLeaseValue {
  /** 持有副本的实例标识（部署侧稳定标识，如 pod 名；重启恢复按此清扫遗留租约） */
  instanceId: string;
  /** 被许可执行的轮次 id（与 SessionExecutionHub 生成的 turnId 同源） */
  turnId: string;
  /** 获取时刻 epoch ms */
  acquiredAt: number;
}

/** 租约键空间前缀：vuagent:lease:<sessionId> */
export const TURN_LEASE_KEYSPACE = "vuagent:lease:";

/** SCAN 游标循环安全上限 */
const MAX_SCAN_CYCLES = 10_000;

/** SCAN COUNT 提示值 */
const SCAN_COUNT = 100;

/**
 * 心跳续期（原子 Lua）：租约值语义匹配（instanceId + turnId）才 PEXPIRE。
 * 用 cjson 解码做语义匹配而非整串比较——调用方无法预知 acquiredAt，
 * 语义匹配使「读值→续期」无需两次往返，也不引入 GET 与续写之间的窗口竞态。
 * ARGV: [turnId, instanceId, ttlMs]
 */
export const TURN_LEASE_HEARTBEAT_LUA = `
local v = redis.call("GET", KEYS[1])
if not v then return 0 end
local ok, obj = pcall(cjson.decode, v)
if ok and obj.turnId == ARGV[1] and obj.instanceId == ARGV[2] then
  redis.call("PEXPIRE", KEYS[1], ARGV[3])
  return 1
end
return 0
`;

/**
 * 释放（原子 Lua）：值语义匹配才 DEL。
 * ARGV: [turnId, instanceId]
 */
export const TURN_LEASE_RELEASE_LUA = `
local v = redis.call("GET", KEYS[1])
if not v then return 0 end
local ok, obj = pcall(cjson.decode, v)
if ok and obj.turnId == ARGV[1] and obj.instanceId == ARGV[2] then
  redis.call("DEL", KEYS[1])
  return 1
end
return 0
`;

function leaseKey(sessionId: string): string {
  return TURN_LEASE_KEYSPACE + encodeURIComponent(sessionId).replace(/\*/g, "%2A");
}

function sessionIdFromLeaseKey(key: string): string {
  return decodeURIComponent(key.slice(TURN_LEASE_KEYSPACE.length).replace(/%2A/g, "*"));
}

export class TurnLeaseManager {
  constructor(
    private readonly client: RedisLike,
    /** 本副本实例标识（部署侧稳定标识；sweepOrphans 的默认清扫目标） */
    private readonly instanceId: string
  ) {}

  /**
   * 获取租约：SET NX PX 原子互斥。
   * 返回 false 的情形：租约已被任何实例持有（含本实例的其他轮次）、TTL 非法、Redis 故障。
   */
  async acquire(sessionId: string, turnId: string, ttlMs: number): Promise<boolean> {
    try {
      const value: TurnLeaseValue = {
        instanceId: this.instanceId,
        turnId,
        acquiredAt: Date.now(),
      };
      const res = await this.client.set(
        leaseKey(sessionId),
        JSON.stringify(value),
        "NX",
        "PX",
        Math.ceil(ttlMs)
      );
      // ioredis NX 成功返回 "OK"/失败返回 null；对同构客户端的其他成功形态保持宽松
      return res !== null && res !== undefined && res !== false && res !== 0;
    } catch {
      return false; // fail-closed：Redis 不可达时宁可拒绝开轮
    }
  }

  /** 心跳续期：仅当租约仍归属「本实例的该轮次」时才续期，避免为他人续命 */
  async heartbeat(sessionId: string, turnId: string, ttlMs: number): Promise<boolean> {
    try {
      const res = await this.client.eval(
        TURN_LEASE_HEARTBEAT_LUA,
        1,
        leaseKey(sessionId),
        turnId,
        this.instanceId,
        Math.ceil(ttlMs)
      );
      return Number(res) === 1;
    } catch {
      return false; // fail-closed：续期失败视为租约不可保
    }
  }

  /** 释放租约：值匹配才删；返回是否确实由本调用删除（幂等：已不存在返回 false） */
  async release(sessionId: string, turnId: string): Promise<boolean> {
    try {
      const res = await this.client.eval(
        TURN_LEASE_RELEASE_LUA,
        1,
        leaseKey(sessionId),
        turnId,
        this.instanceId
      );
      return Number(res) === 1;
    } catch {
      return false; // fail-closed：删除失败时依赖 TTL 自然过期兜底
    }
  }

  /**
   * 启动恢复：清理指定 instanceId 名下的全部遗留租约（进程崩溃/重启后租约仍占键）。
   * 扫 `vuagent:lease:*`，逐键 GET 校验值中 instanceId 匹配才 DEL；
   * 返回被清理的 sessionId 列表（供启动日志归因）。
   * Redis 故障按语义返回空数组（恢复扫描失败不阻塞启动，遗留租约由 TTL 自然过期兜底）。
   */
  async sweepOrphans(instanceId: string): Promise<string[]> {
    const swept: string[] = [];
    try {
      let cursor = "0";
      let cycles = 0;
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          "MATCH",
          `${TURN_LEASE_KEYSPACE}*`,
          "COUNT",
          SCAN_COUNT
        );
        cursor = String(next);
        for (const key of keys) {
          try {
            const raw = await this.client.get(key);
            if (!raw) continue; // 已 TTL 过期 / 间隙被删
            const parsed: unknown = JSON.parse(raw);
            const val = parsed as Partial<TurnLeaseValue> | null;
            if (!val || val.instanceId !== instanceId) continue;
            const removed = await this.client.del(key);
            if (removed > 0) swept.push(sessionIdFromLeaseKey(key));
          } catch {
            // 单键损坏/瞬时失败：跳过，不放大为整体失败
          }
        }
        cycles++;
      } while (cursor !== "0" && cycles < MAX_SCAN_CYCLES);
      return swept;
    } catch {
      return [];
    }
  }
}
