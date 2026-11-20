import { describe, it, expect } from "vitest";
import {
  RedisStorageDriver,
  createRedisDriverFromUrl,
  REDIS_KEYSPACE,
} from "../src/storage/drivers/redis.driver.js";
import { FakeRedis, createTestClock } from "./helpers/fake-redis.js";

interface SampleEntity {
  id: string;
  name: string;
  count: number;
}

describe("RedisStorageDriver（fake 客户端，禁止连真实 Redis）", () => {
  it("set/get 往返：JSON 语义对齐 memory.driver（读写双侧深拷贝隔离）", async () => {
    const driver = new RedisStorageDriver(new FakeRedis());
    const value: SampleEntity = { id: "ws-1", name: "App", count: 1 };

    await driver.set("workspaces", "ws-1", value);
    const got = await driver.get<SampleEntity>("workspaces", "ws-1");
    expect(got).toEqual(value);

    // 读侧隔离：改返回值不影响存储
    got!.name = "Mutated";
    expect(await driver.get<SampleEntity>("workspaces", "ws-1")).toEqual(value);
    // 写侧隔离：改已写入的原对象不影响存储快照
    value.count = 999;
    const again = await driver.get<SampleEntity>("workspaces", "ws-1");
    expect(again?.count).toBe(1);
  });

  it("get 未命中返回 null；delete 返回布尔（存在 true / 缺失 false）", async () => {
    const driver = new RedisStorageDriver(new FakeRedis());

    expect(await driver.get("sessions", "missing")).toBeNull();

    await driver.set("sessions", "s1", { id: "s1" });
    expect(await driver.delete("sessions", "s1")).toBe(true);
    expect(await driver.get("sessions", "s1")).toBeNull();
    expect(await driver.delete("sessions", "s1")).toBe(false);
  });

  it("list 返回 collection 全量并支持 filter", async () => {
    const driver = new RedisStorageDriver(new FakeRedis());
    await driver.set("sessions", "s1", { id: "s1", pinned: true });
    await driver.set("sessions", "s2", { id: "s2", pinned: false });
    await driver.set("sessions", "s3", { id: "s3", pinned: true });

    const all = await driver.list<{ id: string; pinned: boolean }>("sessions");
    expect(all.map((s) => s.id).sort()).toEqual(["s1", "s2", "s3"]);

    const pinned = await driver.list<{ id: string; pinned: boolean }>(
      "sessions",
      (s) => s.pinned
    );
    expect(pinned.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
  });

  it("TTL：ttlMs 过期后惰性失效（get 返回 null、list 排除）", async () => {
    const clock = createTestClock();
    const driver = new RedisStorageDriver(new FakeRedis(clock.now));

    await driver.set("sessions", "s1", { id: "s1" }, { ttlMs: 1000 });
    expect(await driver.get("sessions", "s1")).toEqual({ id: "s1" });

    clock.advance(999);
    expect(await driver.get("sessions", "s1")).not.toBeNull();

    clock.advance(1); // 到达 expiresAt：视为过期
    expect(await driver.get("sessions", "s1")).toBeNull();
    expect(await driver.list("sessions")).toEqual([]);
  });

  it("无 TTL 的 set 永不过期（对齐 memory.driver 永久 K-V 语义）", async () => {
    const clock = createTestClock();
    const driver = new RedisStorageDriver(new FakeRedis(clock.now));

    await driver.set("sessions", "forever", { id: "forever" });
    clock.advance(100_000_000);
    expect(await driver.get("sessions", "forever")).toEqual({ id: "forever" });
  });

  it("前缀隔离：同名 id 分属不同 collection；键名形态 vuagent:<collection>:<id>", async () => {
    const fake = new FakeRedis();
    const driver = new RedisStorageDriver(fake);

    await driver.set("sessions", "shared", { kind: "session" });
    await driver.set("workspaces", "shared", { kind: "workspace" });

    expect(await driver.get("sessions", "shared")).toEqual({ kind: "session" });
    expect(await driver.get("workspaces", "shared")).toEqual({ kind: "workspace" });
    expect(await driver.list("sessions")).toHaveLength(1);
    expect(await driver.list("workspaces")).toHaveLength(1);

    // 穿透 fake 直读原始键，断言 keyspace 形态
    const keys = await fake.keys(`${REDIS_KEYSPACE}:*`);
    expect(keys.sort()).toEqual(["vuagent:sessions:shared", "vuagent:workspaces:shared"]);
  });

  it("id 含 glob 元字符：编码后往返无损且不污染 SCAN 匹配", async () => {
    const driver = new RedisStorageDriver(new FakeRedis());
    const trickyId = "a*b?c[d]";

    await driver.set("sessions", trickyId, { id: trickyId });
    expect(await driver.get("sessions", trickyId)).toEqual({ id: trickyId });

    // 通配 id 不会被其他 id 的查询误命中
    const all = await driver.list<{ id: string }>("sessions");
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(trickyId);
    expect(await driver.get("sessions", "aXbYcXd")).toBeNull();
  });

  it("clear(collection) 只清目标 collection；相近前缀与外部键不受波及", async () => {
    const fake = new FakeRedis();
    const driver = new RedisStorageDriver(fake);

    await driver.set("sessions", "s1", { id: "s1" });
    await driver.set("sessions_extra", "x", { id: "x" }); // 前缀相近但 glob 不匹配
    await fake.putRaw("other:system:key", "keep-me");

    await driver.clear("sessions");

    expect(await driver.get("sessions", "s1")).toBeNull();
    expect(await driver.get("sessions_extra", "x")).toEqual({ id: "x" });
    expect(await fake.get("other:system:key")).toBe("keep-me");
  });

  it("clear() 无参清空整个 vuagent keyspace，保留非 vuagent 键", async () => {
    const fake = new FakeRedis();
    const driver = new RedisStorageDriver(fake);

    await driver.set("sessions", "s1", { id: "s1" });
    await driver.set("workspaces", "ws1", { id: "ws1" });
    await fake.putRaw("other:system:key", "keep-me");

    await driver.clear();

    expect(await driver.get("sessions", "s1")).toBeNull();
    expect(await driver.get("workspaces", "ws1")).toBeNull();
    expect(await fake.get("other:system:key")).toBe("keep-me");
  });

  it("SCAN 分页：大量键跨游标聚合完整（COUNT=100，250 键跨 3 页）", async () => {
    const fake = new FakeRedis();
    const driver = new RedisStorageDriver(fake);

    for (let i = 0; i < 250; i++) {
      await fake.putRaw(`vuagent:bulk:k${i}`, JSON.stringify({ i }));
    }
    const all = await driver.list<{ i: number }>("bulk");
    expect(all).toHaveLength(250);
    expect(new Set(all.map((e) => e.i)).size).toBe(250);
  });

  it("Redis 故障如实上抛（驱动不吞错，fail-open 决策留给调用方）", async () => {
    const fake = new FakeRedis();
    fake.failAll = true;
    const driver = new RedisStorageDriver(fake);

    await expect(driver.get("c", "k")).rejects.toThrow();
    await expect(driver.set("c", "k", { v: 1 })).rejects.toThrow();
    await expect(driver.delete("c", "k")).rejects.toThrow();
    await expect(driver.list("c")).rejects.toThrow();
    await expect(driver.clear()).rejects.toThrow();
  });

  it("createRedisDriverFromUrl：ioredis 缺失时抛可读错误（已安装环境自动跳过）", async () => {
    // 变量型 specifier 探测依赖是否存在；import 模块本身不会建立连接
    const moduleName = "ioredis";
    let installed = true;
    try {
      await import(moduleName);
    } catch {
      installed = false;
    }
    if (installed) {
      // 环境已装 ioredis（如接线后安装）：跳过——构造真实客户端会发起连接，违反「禁止连真实 Redis」
      return;
    }
    await expect(createRedisDriverFromUrl("redis://127.0.0.1:6379/0")).rejects.toThrow(
      /ioredis/
    );
  });
});
