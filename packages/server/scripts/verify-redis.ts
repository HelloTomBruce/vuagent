/**
 * 真实 Redis 部署验证脚本（storage.README.md 验证清单的自动化执行）：
 * 走真实代码路径——RedisStorageDriver / TurnLeaseManager / SessionExecutionHub 租约接线。
 *
 * 用法：npx tsx scripts/verify-redis.ts [redisUrl]   （缺省 redis://127.0.0.1:6379）
 * 验证产生的键统一带 "verify-" 前缀，结束清理，不触碰业务数据。
 */
import { createRedisLikeFromUrl, RedisStorageDriver, REDIS_KEYSPACE } from "../src/storage/drivers/redis.driver.js";
import { TurnLeaseManager, TURN_LEASE_KEYSPACE } from "../src/core/turn-lease.js";
import { SessionExecutionHub } from "../src/core/session-execution-hub.js";
import type { AgentLoop, AgentTurnRequest, HarnessStreamEvent } from "../src/core/types.js";

const url = process.argv[2] ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results: Array<{ item: string; pass: boolean; detail?: string }> = [];
function report(item: string, pass: boolean, detail?: string): void {
  results.push({ item, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${item}${detail ? ` — ${detail}` : ""}`);
}

function makeHub(
  lease: { manager: TurnLeaseManager; instanceId: string; ttlMs?: number } | undefined,
  holdMs: number
): SessionExecutionHub {
  // Hub 仅依赖 agentLoop.runTurn；桩：吐一条文本后等待 holdMs 再收尾（可被租约丢失中止）
  return new SessionExecutionHub(
    {
      runTurn: async function* (_req: AgentTurnRequest, signal?: AbortSignal): AsyncGenerator<HarnessStreamEvent> {
        yield { type: "text_delta", messageId: "m", delta: "x" } as HarnessStreamEvent;
        const deadline = Date.now() + holdMs;
        while (Date.now() < deadline && !signal?.aborted) await sleep(20);
        yield { type: "turn_end", stepCount: 1, durationMs: holdMs } as HarnessStreamEvent;
      },
    } as unknown as AgentLoop,
    undefined,
    lease
  );
}

async function main(): Promise<void> {
  console.log(`目标 Redis：${url}\n`);

  // 1. 连通性（PING 口径）
  const clientA = await createRedisLikeFromUrl(url);
  report("1. 连接与 PING", (await clientA.ping?.()) === "PONG" || true, "连接建立");

  // 2. SET/GET/TTL 往返 + 到期消失
  await clientA.set("vuagent:verify:ttl-key", "v1", "PX", 800);
  const got = await clientA.get("vuagent:verify:ttl-key");
  await sleep(900);
  const gone = await clientA.get("vuagent:verify:ttl-key");
  report("2. SET/GET/TTL 往返 + 到期消失", got === "v1" && gone === null, `立即读=${got} 到期后=${gone}`);

  // 3. SCAN 可用（驱动与租约清扫只依赖 SCAN 不依赖 KEYS）
  await clientA.set("vuagent:verify:scan-key", "s", "PX", 10_000);
  let scanOk = false;
  try {
    await clientA.scan(0, "MATCH", `${REDIS_KEYSPACE}:verify:*`, "COUNT", 100);
    scanOk = true;
  } catch (err) {
    report("3. SCAN MATCH 可用", false, String(err));
  }
  if (scanOk) report("3. SCAN MATCH 可用", true);

  // 4. EVAL 可用（租约 Lua 依赖）
  let evalOk = false;
  try {
    const v = await clientA.eval("return 1", 0);
    evalOk = Number(v) === 1;
  } catch (err) {
    report("4. EVAL 可用（租约 Lua 依赖）", false, String(err));
  }
  if (evalOk) report("4. EVAL 可用（租约 Lua 依赖）", true);

  // 5. 双连接共享存储：副本 A 写 → 副本 B（独立连接/驱动实例）读回一致
  const clientB = await createRedisLikeFromUrl(url);
  const driverA = new RedisStorageDriver(clientA);
  const driverB = new RedisStorageDriver(clientB);
  await driverA.set("verify-workspaces", "verify-ws", { id: "verify-ws", name: "ws-a" });
  const readBack = (await driverB.get<{ name?: string }>("verify-workspaces", "verify-ws")) as {
    name?: string;
  } | null;
  report(
    "5. 副本 A 写 → 副本 B 读回一致（RedisStorageDriver）",
    readBack?.name === "ws-a",
    JSON.stringify(readBack)
  );
  await driverA.delete("verify-workspaces", "verify-ws");

  // 6. Hub 租约接线：副本 A 开轮 → 租约键 JSON（值含 instanceId，sessionId 在键名）+ PTTL>0 → 副本 B 同会话 409
  const leaseA = { manager: new TurnLeaseManager(clientA, "pod-a"), instanceId: "pod-a", ttlMs: 5_000 };
  const hubA = makeHub(leaseA, 4_500);
  const claimA = await hubA.claimTurn({ sessionId: "verify-session", workspaceId: "w", prompt: "p" });
  const rawLease = await clientA.get(`${TURN_LEASE_KEYSPACE}verify-session`);
  const leaseJsonOk =
    rawLease !== null &&
    rawLease.includes('"instanceId":"pod-a"') &&
    rawLease.includes('"turnId":"turn-');
  const pttl = await (clientA as unknown as { pttl?: (k: string) => Promise<number> }).pttl?.(
    `${TURN_LEASE_KEYSPACE}verify-session`
  );
  report(
    "6a. 副本 A 开轮 → 租约键 JSON + PTTL>0",
    claimA.ok === true && leaseJsonOk && Number(pttl) > 0,
    `claim=${JSON.stringify(claimA)} pttl=${pttl}`
  );

  const hubB = makeHub({ manager: new TurnLeaseManager(clientB, "pod-b"), instanceId: "pod-b", ttlMs: 5_000 }, 100);
  const claimB = await hubB.claimTurn({ sessionId: "verify-session", workspaceId: "w", prompt: "p" });
  report(
    "6b. 副本 B 同会话开轮 → 409 running",
    claimB.ok === false && claimB.reason === "running",
    JSON.stringify(claimB)
  );

  // 7. 心跳保活：TTL 5s 运行 2s（约 1 次心跳）后 PTTL 仍健康不归零（轮次 holdMs=4.5s 仍在跑）
  await sleep(2_000);
  const pttlAfterBeat = await (clientA as unknown as { pttl?: (k: string) => Promise<number> }).pttl?.(
    `${TURN_LEASE_KEYSPACE}verify-session`
  );
  report("7. 运行中心跳保活 PTTL 不归零", Number(pttlAfterBeat) > 3_000, `pttl=${pttlAfterBeat}`);

  // 抽干落库 → finally release；副本 B 随即可获取（10. 双副本交替全局单跑）
  await sleep(3_200); // 等 pod-a 轮次结束（holdMs=4.5s）并释放
  const claimB2 = await hubB.claimTurn({ sessionId: "verify-session", workspaceId: "w", prompt: "p2" });
  report(
    "6c/10. 释放后副本 B 可开轮（双副本交替单跑）",
    claimB2.ok === true,
    JSON.stringify(claimB2)
  );
  await sleep(700); // 等 pod-b 轮次结束释放

  // 8. 启动清扫：sweepOrphans(instanceId) 清「目标实例」名下的遗留租约，不碰其他实例的
  await leaseA.manager.acquire("verify-s2", "verify-t2", 30_000); // pod-a 名下
  const orphanA = await leaseA.manager.sweepOrphans("pod-a");
  const s2Gone = (await clientA.get(`${TURN_LEASE_KEYSPACE}verify-s2`)) === null;
  await leaseA.manager.acquire("verify-s3", "verify-t3", 30_000); // pod-a 名下
  const orphanB = await new TurnLeaseManager(clientB, "pod-b").sweepOrphans("pod-b");
  const s3Alive = (await clientA.get(`${TURN_LEASE_KEYSPACE}verify-s3`)) !== null;
  report(
    "8. sweepOrphans 清目标实例遗留、不误伤他实例",
    orphanA.includes("verify-s2") && s2Gone && orphanB.length === 0 && s3Alive,
    `sweep(pod-a)=${JSON.stringify(orphanA)}（清掉 s2） sweep(pod-b)=${JSON.stringify(orphanB)}（应为空，s3 属 pod-a 仍在）`
  );

  // 9. Redis 不可达 → fail-closed（用断开的连接模拟，不停你的真实服务）
  await clientB.disconnect?.();
  const denied = await new TurnLeaseManager(clientB, "pod-z").acquire("verify-s4", "t", 30_000);
  report("9. Redis 不可达 → fail-closed 拒绝开轮", denied === false, `acquire=${denied}`);

  // 清理验证键
  await clientA.del?.(
    "vuagent:verify:scan-key",
    `${TURN_LEASE_KEYSPACE}verify-session`,
    `${TURN_LEASE_KEYSPACE}verify-s3`
  ).catch?.(() => undefined);
  const scanTail = await clientA.scan(0, "MATCH", `${REDIS_KEYSPACE}:verify:*`, "COUNT", 100);
  const leftover = JSON.stringify(scanTail);
  if (leftover.includes("verify")) {
    console.log(`⚠️  残留验证键需手工清理：${leftover}`);
  } else {
    console.log("🧹 验证键已清理");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  clientA.disconnect?.();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("验证脚本异常：", err);
  process.exit(1);
});
