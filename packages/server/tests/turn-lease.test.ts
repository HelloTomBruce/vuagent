import { describe, it, expect } from "vitest";
import {
  TurnLeaseManager,
  TURN_LEASE_KEYSPACE,
} from "../src/core/turn-lease.js";
import { FakeRedis, createTestClock } from "./helpers/fake-redis.js";

describe("TurnLeaseManager（fake 客户端，禁止连真实 Redis）", () => {
  it("互斥获取：第二个实例/第二个轮次 acquire 返回 false", async () => {
    const clock = createTestClock();
    const fake = new FakeRedis(clock.now);
    const mgrA = new TurnLeaseManager(fake, "instance-a");
    const mgrB = new TurnLeaseManager(fake, "instance-b");

    expect(await mgrA.acquire("sess-1", "t1", 1000)).toBe(true);
    // 他副本的其他轮次：拒绝
    expect(await mgrB.acquire("sess-1", "t2", 1000)).toBe(false);
    // 本副本的其他轮次：同样拒绝（同会话全局只允许一个轮次）
    expect(await mgrA.acquire("sess-1", "t3", 1000)).toBe(false);
    // 其他会话互不影响
    expect(await mgrB.acquire("sess-2", "t9", 1000)).toBe(true);
  });

  it("租约值形状：JSON {instanceId, turnId, acquiredAt}，键落在 vuagent:lease:<sessionId>，带 PX TTL", async () => {
    const clock = createTestClock();
    const fake = new FakeRedis(clock.now);
    const mgr = new TurnLeaseManager(fake, "instance-a");

    const before = clock.now();
    expect(await mgr.acquire("sess-1", "t1", 1234)).toBe(true);

    const entry = fake.peek(`${TURN_LEASE_KEYSPACE}sess-1`);
    expect(entry).not.toBeNull();
    const value = JSON.parse(entry!.value) as {
      instanceId: string;
      turnId: string;
      acquiredAt: number;
    };
    expect(value.instanceId).toBe("instance-a");
    expect(value.turnId).toBe("t1");
    expect(value.acquiredAt).toBeGreaterThanOrEqual(before);
    // PX TTL 已设置：expiresAt = now + ttl
    expect(entry!.expiresAt).toBe(before + 1234);
  });

  it("心跳续期：TTL 耗尽前续命可长期保住租约；无心跳则到期被他副本抢占", async () => {
    const clock = createTestClock();
    const fake = new FakeRedis(clock.now);
    const mgrA = new TurnLeaseManager(fake, "instance-a");
    const mgrB = new TurnLeaseManager(fake, "instance-b");

    expect(await mgrA.acquire("sess-1", "t1", 1000)).toBe(true);

    // 每 900ms 心跳一次，租约永不落入他人之手
    clock.advance(900);
    expect(await mgrA.heartbeat("sess-1", "t1", 1000)).toBe(true);
    clock.advance(900);
    expect(await mgrA.heartbeat("sess-1", "t1", 1000)).toBe(true);
    clock.advance(900);
    expect(await mgrB.acquire("sess-1", "t2", 1000)).toBe(false);

    // 心跳停止：最迟在末次 TTL 后过期，B 抢占成功
    clock.advance(1001);
    expect(await mgrB.acquire("sess-1", "t2", 1000)).toBe(true);
  });

  it("心跳身份校验：为他副本租约心跳返回 false 且不为其续命", async () => {
    const clock = createTestClock();
    const fake = new FakeRedis(clock.now);
    const mgrA = new TurnLeaseManager(fake, "instance-a");
    const mgrB = new TurnLeaseManager(fake, "instance-b");

    expect(await mgrA.acquire("sess-1", "t1", 1000)).toBe(true);

    // B 试图用自己的 instanceId/turnId 为 A 的租约续期：拒绝且不改变 TTL
    clock.advance(500);
    expect(await mgrB.heartbeat("sess-1", "t1", 1000)).toBe(false);
    expect(await mgrB.heartbeat("sess-1", "t2", 1000)).toBe(false);

    // TTL 未被非法延长：原到期时刻仍然生效
    clock.advance(501); // 累计 1001ms > ttl
    expect(await mgrB.acquire("sess-1", "t2", 1000)).toBe(true);
  });

  it("释放后可再获取；重复释放幂等返回 false；错身份不误删他人租约", async () => {
    const clock = createTestClock();
    const fake = new FakeRedis(clock.now);
    const mgrA = new TurnLeaseManager(fake, "instance-a");
    const mgrB = new TurnLeaseManager(fake, "instance-b");

    expect(await mgrA.acquire("sess-1", "t1", 10_000)).toBe(true);

    // 错 turnId 释放：失败且租约完好
    expect(await mgrA.release("sess-1", "wrong-turn")).toBe(false);
    expect(await mgrB.acquire("sess-1", "t2", 1000)).toBe(false);

    // 正确释放：成功后他副本立即可获取
    expect(await mgrA.release("sess-1", "t1")).toBe(true);
    expect(await mgrB.acquire("sess-1", "t2", 1000)).toBe(true);

    // 幂等：重复释放返回 false
    expect(await mgrA.release("sess-1", "t1")).toBe(false);
  });

  it("sweepOrphans 只清本实例遗留租约，他副本租约原样保留；再次扫描返回空", async () => {
    const clock = createTestClock();
    const fake = new FakeRedis(clock.now);
    const mgrA = new TurnLeaseManager(fake, "instance-a");
    const mgrB = new TurnLeaseManager(fake, "instance-b");

    // 崩溃前：A 持有 sess-1，B 持有 sess-2
    expect(await mgrA.acquire("sess-1", "t1", 60_000)).toBe(true);
    expect(await mgrB.acquire("sess-2", "t2", 60_000)).toBe(true);

    // A 重启后清扫自己的遗留
    expect(await mgrA.sweepOrphans("instance-a")).toEqual(["sess-1"]);

    // B 的租约完好：仍无法抢占、心跳仍成功
    expect(await mgrB.acquire("sess-2", "t9", 1000)).toBe(false);
    expect(await mgrB.heartbeat("sess-2", "t2", 60_000)).toBe(true);

    // 幂等：再扫一次没有新东西；按 instanceId 定向清扫 B 也有效
    expect(await mgrA.sweepOrphans("instance-a")).toEqual([]);
    expect(await mgrA.sweepOrphans("instance-b")).toEqual(["sess-2"]);
    expect(await mgrB.acquire("sess-2", "t9", 1000)).toBe(true);
  });

  it("sweepOrphans 跳过已 TTL 过期的租约键", async () => {
    const clock = createTestClock();
    const fake = new FakeRedis(clock.now);
    const mgr = new TurnLeaseManager(fake, "instance-a");

    expect(await mgr.acquire("sess-1", "t1", 100)).toBe(true);
    clock.advance(200); // 已过期（惰性删除）
    expect(await mgr.sweepOrphans("instance-a")).toEqual([]);
    expect(fake.peek(`${TURN_LEASE_KEYSPACE}sess-1`)).toBeNull();
  });

  it("Redis 故障 fail-closed：acquire/heartbeat/release 返回 false、sweepOrphans 返回空数组、不抛出", async () => {
    const fake = new FakeRedis();
    fake.failAll = true;
    const mgr = new TurnLeaseManager(fake, "instance-a");

    await expect(mgr.acquire("sess-1", "t1", 1000)).resolves.toBe(false);
    await expect(mgr.heartbeat("sess-1", "t1", 1000)).resolves.toBe(false);
    await expect(mgr.release("sess-1", "t1")).resolves.toBe(false);
    await expect(mgr.sweepOrphans("instance-a")).resolves.toEqual([]);
  });
});
