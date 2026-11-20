import type { IStorageDriver } from "./base.driver.js";

/**
 * Redis 分布式存储驱动 (RedisStorageDriver)
 * 多副本部署下的共享持久化形态：所有 IStorageDriver collection 落在同一 Redis keyspace，
 * 键名规范 `vuagent:<collection>:<id>`；id 经 encodeURIComponent（并把 `*` 补编码为 %2A），
 * 防止 id 中的 glob 元字符污染 SCAN MATCH 模式、也避免 `:` 等字符造成歧义。
 *
 * 错误语义：驱动自身不吞错、如实上抛；「Redis 故障 fail-open」（缓存类读失败降级为
 * 默认值/跳过）由调用方（仓库层已有 best-effort）承担——与 memory/sqlite 驱动一致：
 * 驱动只负责忠实地执行与报错。
 */

/** keyspace 根前缀 */
export const REDIS_KEYSPACE = "vuagent";

/** SCAN 游标循环安全上限（异常客户端 / 集群迁移期间防死循环） */
const MAX_SCAN_CYCLES = 10_000;

/** SCAN COUNT 提示值（Redis 侧仅为提示，非硬上限） */
const SCAN_COUNT = 100;

/**
 * 最小 Redis 客户端接口（结构化类型）
 * 刻意不 import ioredis 的类型面：ioredis 是 optional peer（未安装也必须过 typecheck），
 * 同时留出 node-redis 等同构客户端的替换空间。
 * 方法用简写形式声明（获得双变参数检查），兼容 ioredis 的具体化重载签名。
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** 变参兼容 ioredis：set(key, value, "NX", "PX", ms) 等，子命令由实现自行解析 */
  set(key: string, value: string, ...options: Array<string | number>): Promise<unknown>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  pSetEx(key: string, milliseconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  /** SCAN：返回 [nextCursor, keys]，cursor 归 "0" 表示一轮结束 */
  scan(cursor: string | number, ...options: Array<string | number>): Promise<[string, string[]]>;
  incrBy(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  /** EVAL：numKeys 之后依次为 KEYS 与 ARGV */
  eval(script: string, numKeys: number, ...keysAndArgs: Array<string | number>): Promise<unknown>;
}

/** set 的可选扩展（不破坏 IStorageDriver 既有调用面） */
export interface RedisSetOptions {
  /** 毫秒级 TTL；缺省不过期（对齐 memory.driver 的永久 K-V 语义） */
  ttlMs?: number;
}

/**
 * 组装 collection 域键名：vuagent:<collection>:<encodeURIComponent(id)>
 * encodeURIComponent 不编码 `*`（且 `*` 恰是 SCAN MATCH 的 glob 元字符），故补一刀。
 */
export function redisKey(collection: string, id: string): string {
  return `${REDIS_KEYSPACE}:${collection}:${encodeURIComponent(id).replace(/\*/g, "%2A")}`;
}

/** 从键名还原 id（redisKey 的逆操作） */
export function redisIdFromKey(key: string, collection: string): string {
  const prefix = `${REDIS_KEYSPACE}:${collection}:`;
  return decodeURIComponent(key.slice(prefix.length).replace(/%2A/g, "*"));
}

export class RedisStorageDriver implements IStorageDriver {
  constructor(private readonly client: RedisLike) {}

  async get<T>(collection: string, id: string): Promise<T | null> {
    const raw = await this.client.get(redisKey(collection, id));
    if (raw === null || raw === undefined) return null;
    return JSON.parse(raw) as T;
  }

  async set<T>(
    collection: string,
    id: string,
    value: T,
    options?: RedisSetOptions
  ): Promise<void> {
    const key = redisKey(collection, id);
    const payload = JSON.stringify(value);
    if (options?.ttlMs !== undefined && options.ttlMs > 0) {
      await this.client.pSetEx(key, Math.ceil(options.ttlMs), payload);
    } else {
      await this.client.set(key, payload);
    }
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const removed = await this.client.del(redisKey(collection, id));
    return removed > 0;
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    const keys = await this.scanAll(`${REDIS_KEYSPACE}:${collection}:*`);
    const items: T[] = [];
    for (const key of keys) {
      // SCAN 与 GET 的间隙中键可能被 TTL 过期 / 并发删除：跳过空读，如实反映当下
      const raw = await this.client.get(key);
      if (raw === null || raw === undefined) continue;
      items.push(JSON.parse(raw) as T);
    }
    return filter ? items.filter(filter) : items;
  }

  async clear(collection?: string): Promise<void> {
    const pattern = collection
      ? `${REDIS_KEYSPACE}:${collection}:*`
      : `${REDIS_KEYSPACE}:*`;
    const keys = await this.scanAll(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  /**
   * SCAN 游标循环：MATCH 前缀过滤 + COUNT 提示，直至 cursor 归 0。
   * 不使用 KEYS（生产 Redis 上 KEYS 阻塞事件循环；SCAN 增量且可中断）。
   */
  private async scanAll(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    let cycles = 0;
    do {
      const [next, batch] = await this.client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        SCAN_COUNT
      );
      cursor = String(next);
      keys.push(...batch);
      cycles++;
    } while (cursor !== "0" && cycles < MAX_SCAN_CYCLES);
    return keys;
  }
}

/**
 * 工厂：REDIS_URL → 已连接的 RedisStorageDriver。
 * ioredis 为 optional peer（peerDependenciesMeta.optional=true），未安装时抛可读错误。
 *
 * 【typecheck 说明】动态 import 刻意使用「变量型 specifier」而非字符串字面量：
 * TS 不对变量 specifier 做静态模块解析（返回 Promise<any>），因此仓库未安装 ioredis
 * 时 `pnpm --filter @vuagent/server typecheck` 依然干净；模块是否存在推迟到运行时探测。
 */
export async function createRedisLikeFromUrl(url: string): Promise<RedisLike> {
  const moduleName = "ioredis"; // 变量 specifier：规避 TS 对未安装模块的静态解析
  let mod: unknown;
  try {
    mod = await import(moduleName);
  } catch (err) {
    throw new Error(
      "[vuagent] Redis 形态需要可选 peer 依赖 ioredis (^5)，当前环境未安装。" +
        "请执行 `pnpm --filter @vuagent/server add ioredis` 后以 REDIS_URL 启动。" +
        `原始错误：${err instanceof Error ? err.message : String(err)}`
    );
  }
  const modObj = mod as { Redis?: unknown; default?: unknown };
  const RedisCtor = (modObj.Redis ?? modObj.default) as
    | (new (url: string) => RedisLike)
    | undefined;
  if (typeof RedisCtor !== "function") {
    throw new Error(
      "[vuagent] ioredis 模块结构异常：未找到 Redis 构造器（期望 mod.Redis 或 mod.default）。"
    );
  }
  return new RedisCtor(url);
}

export async function createRedisDriverFromUrl(url: string): Promise<RedisStorageDriver> {
  return new RedisStorageDriver(await createRedisLikeFromUrl(url));
}
