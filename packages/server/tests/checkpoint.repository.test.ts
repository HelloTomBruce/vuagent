/**
 * CheckpointRepository 单测（T07）：append/list/get/latest 语义、
 * 事务原子性（count 与行数一致）、legacy 内联搬库幂等、多会话隔离。
 */
import { describe, it, expect } from "vitest";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { SQLiteStorageDriver } from "../src/storage/drivers/sqlite.driver.js";
import { CheckpointRepository, CHECKPOINTS_COLLECTION } from "../src/storage/repositories/checkpoint.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import type { CheckpointEntity } from "../src/storage/interfaces.js";
import type { IStorageDriver } from "../src/storage/drivers/base.driver.js";

function mkCp(id: string, stepIndex: number, snapshotAt: number, snapshotSize = 2): CheckpointEntity {
  return {
    id,
    turnId: "turn-1",
    stepIndex,
    messagesSnapshot: Array.from({ length: snapshotSize }, (_, i) => ({ role: "assistant", content: `${id}-${i}` })),
    snapshotAt,
  };
}

/** 建带 running turn 行的仓储环境（appendCheckpoint 的 turn 元数据维护依赖行存在） */
async function seedWithTurn(driver: IStorageDriver) {
  const sessions = new SessionRepository(driver);
  const repo = new CheckpointRepository(driver);
  const session = await sessions.create({ workspaceId: "ws-1", title: "t" });
  await sessions.appendTurn(session.id, {
    id: "turn-1",
    sessionId: session.id,
    prompt: "q",
    status: "running",
    stepCount: 0,
    checkpoints: [],
    cards: [],
    createdAt: Date.now(),
  });
  return { sessions, repo, sessionId: session.id };
}

describe.each([
  ["memory", () => new MemoryStorageDriver()],
  ["sqlite", () => new SQLiteStorageDriver(":memory:")],
])("CheckpointRepository（%s）", (_name, makeDriver) => {
  it("append 后 getById/listMeta/latestWithSnapshot 语义正确（落库顺序）", async () => {
    const { repo, sessionId } = await seedWithTurn(makeDriver());

    // 乱序时间戳落库，验证 snapshotAt 排序口径
    await repo.appendCheckpoint(sessionId, "turn-1", mkCp("cp-t1-2", 2, 300));
    await repo.appendCheckpoint(sessionId, "turn-1", mkCp("cp-t1-1", 1, 200));
    await repo.appendCheckpoint(sessionId, "turn-1", mkCp("cp-t1-3", 3, 400));

    const metas = await repo.listMeta(sessionId, "turn-1");
    expect(metas.map((m) => m.id)).toEqual(["cp-t1-1", "cp-t1-2", "cp-t1-3"]);
    // meta 不含快照
    expect(metas[0]).toEqual({ id: "cp-t1-1", turnId: "turn-1", stepIndex: 1, snapshotAt: 200 });

    const full = await repo.getById(sessionId, "turn-1", "cp-t1-2");
    expect(full?.messagesSnapshot).toHaveLength(2);
    expect(await repo.getById(sessionId, "turn-1", "nope")).toBeNull();

    const latest = await repo.latestWithSnapshot(sessionId);
    expect(latest?.id).toBe("cp-t1-3");
  });

  it("appendCheckpoint 同事务维护 turn 元数据：meta 数组 + checkpointCount + split 标记", async () => {
    const { sessions, repo, sessionId } = await seedWithTurn(makeDriver());
    await repo.appendCheckpoint(sessionId, "turn-1", mkCp("cp-1", 1, 100));
    await repo.appendCheckpoint(sessionId, "turn-1", mkCp("cp-2", 2, 200));

    const session = await sessions.get(sessionId);
    const turn = session?.turns.find((t) => t.id === "turn-1");
    expect(turn?.checkpointsSplit).toBe(true);
    expect(turn?.checkpointCount).toBe(2);
    expect(turn?.checkpoints).toHaveLength(2);
    // meta 无快照
    expect(turn?.checkpoints[0]).not.toHaveProperty("messagesSnapshot");

    // 一致性：count 与集合行数一致
    const rows = await repo.listMeta(sessionId);
    expect(rows).toHaveLength(turn?.checkpointCount ?? -1);
  });

  it("legacy 内联完整实体的 turn：首次触达搬库（幂等）+ 追加", async () => {
    const driver = makeDriver();
    const sessions = new SessionRepository(driver);
    const repo = new CheckpointRepository(driver);
    const session = await sessions.create({ workspaceId: "ws-1", title: "t" });
    // 模拟 legacy：turn 行内联两个完整实体（含快照）
    await sessions.appendTurn(session.id, {
      id: "turn-1",
      sessionId: session.id,
      prompt: "q",
      status: "running",
      stepCount: 2,
      checkpoints: [mkCp("cp-old-1", 1, 100), mkCp("cp-old-2", 2, 200)],
      cards: [],
      createdAt: Date.now(),
    });

    await repo.appendCheckpoint(session.id, "turn-1", mkCp("cp-new", 3, 300));

    // 搬库 + 追加：三条都在独立集合，turn 行只剩 meta
    const metas = await repo.listMeta(session.id, "turn-1");
    expect(metas.map((m) => m.id)).toEqual(["cp-old-1", "cp-old-2", "cp-new"]);
    const session2 = await sessions.get(session.id);
    const turn2 = session2?.turns.find((t) => t.id === "turn-1");
    expect(turn2?.checkpointsSplit).toBe(true);
    expect(turn2?.checkpoints.every((c) => !("messagesSnapshot" in c)) || turn2?.checkpoints.every((c) => !Array.isArray((c as CheckpointEntity).messagesSnapshot))).toBe(true);

    // 幂等：再次触达（重复落同 id）不重复搬/不重复计
    await repo.appendCheckpoint(session.id, "turn-1", mkCp("cp-new", 3, 300));
    const again = await repo.listMeta(session.id, "turn-1");
    expect(again).toHaveLength(3);
    expect((await sessions.get(session.id))?.turns.find((t) => t.id === "turn-1")?.checkpointCount).toBe(3);
  });

  it("多会话/多 turn 隔离：listMeta/latestWithSnapshot 不串会话", async () => {
    const driver = makeDriver();
    const sessions = new SessionRepository(driver);
    const repo = new CheckpointRepository(driver);
    const s1 = await sessions.create({ workspaceId: "ws-1", title: "1" });
    const s2 = await sessions.create({ workspaceId: "ws-1", title: "2" });
    for (const [sid, tid] of [
      [s1.id, "turn-a"],
      [s1.id, "turn-b"],
      [s2.id, "turn-a"],
    ] as const) {
      await sessions.appendTurn(sid, {
        id: tid,
        sessionId: sid,
        prompt: "q",
        status: "running",
        stepCount: 0,
        checkpoints: [],
        cards: [],
        createdAt: Date.now(),
      });
      await repo.appendCheckpoint(sid, tid, mkCp(`cp-${sid}-${tid}`, 1, Date.now()));
    }

    expect((await repo.listMeta(s1.id)).map((m) => m.id)).toEqual([`cp-${s1.id}-turn-a`, `cp-${s1.id}-turn-b`]);
    expect((await repo.listMeta(s2.id)).map((m) => m.id)).toEqual([`cp-${s2.id}-turn-a`]);
    expect((await repo.listMeta(s1.id, "turn-b")).map((m) => m.id)).toEqual([`cp-${s1.id}-turn-b`]);
    expect((await repo.latestWithSnapshot(s2.id))?.id).toBe(`cp-${s2.id}-turn-a`);
  });

  it("latestWithSnapshot 跳过空快照；deleteTurnCheckpoints 删净", async () => {
    const { repo, sessionId } = await seedWithTurn(makeDriver());
    const empty = mkCp("cp-empty", 1, 100);
    (empty as CheckpointEntity).messagesSnapshot = [];
    await repo.appendCheckpoint(sessionId, "turn-1", empty);
    await repo.appendCheckpoint(sessionId, "turn-1", mkCp("cp-real", 2, 200));

    expect((await repo.latestWithSnapshot(sessionId))?.id).toBe("cp-real");

    const deleted = await repo.deleteTurnCheckpoints(sessionId, "turn-1");
    expect(deleted).toBe(2);
    expect(await repo.listMeta(sessionId, "turn-1")).toHaveLength(0);
    expect(await repo.getById(sessionId, "turn-1", "cp-real")).toBeNull();
  });

  it("并发 appendCheckpoint（多会话 Promise.all）：事务互斥不串写，count 与行数一致", async () => {
    const driver = makeDriver();
    const sessions = new SessionRepository(driver);
    const repo = new CheckpointRepository(driver);
    const ids: Array<{ sid: string }> = [];
    for (let i = 0; i < 6; i++) {
      const s = await sessions.create({ workspaceId: "ws-1", title: `c${i}` });
      await sessions.appendTurn(s.id, {
        id: "turn-c", sessionId: s.id, prompt: "q", status: "running",
        stepCount: 0, checkpoints: [], cards: [], createdAt: Date.now(),
      });
      ids.push({ sid: s.id });
    }
    // 6 会话 × 4 步并发落库（触发 sqlite 事务互斥队列；memory 顺序执行）
    await Promise.all(
      ids.map(({ sid }, si) =>
        Promise.all(
          Array.from({ length: 4 }, (_, step) =>
            repo.appendCheckpoint(sid, "turn-c", mkCp(`cp-${si}-${step}`, step + 1, 1000 + step))
          )
        )
      )
    );
    for (const { sid } of ids) {
      const metas = await repo.listMeta(sid, "turn-c");
      expect(metas).toHaveLength(4);
      const session = await sessions.get(sid);
      const turn = session?.turns.find((t) => t.id === "turn-c");
      expect(turn?.checkpointCount).toBe(4);
      expect(turn?.checkpoints).toHaveLength(4);
    }
  });

  it("listMeta 只读 turn 行的 meta：checkpoint 行内容损坏也不影响（评审 R2 回归）", async () => {
    const driver = makeDriver();
    const { repo, sessionId } = await seedWithTurn(driver);
    await repo.appendCheckpoint(sessionId, "turn-1", mkCp("cp-1", 1, 100));

    // 把 checkpoint 行替换成非法 JSON：若 listMeta 仍读该集合会抛错/耗时
    await driver.set("session_checkpoints", `${sessionId}:turn-1:cp-1`, { corrupted: Symbol("x").toString() } as never);
    const raw = await driver.get<Record<string, unknown>>("session_checkpoints", `${sessionId}:turn-1:cp-1`);
    void raw;

    const metas = await repo.listMeta(sessionId, "turn-1");
    expect(metas.map((m) => m.id)).toEqual(["cp-1"]);
  });

  it("并发 appendCheckpoint + 进度写（同 turn）：三者计数保持一致（不变式）", async () => {
    const driver = makeDriver();
    const { sessions, repo, sessionId } = await seedWithTurn(driver);

    // 模拟真实并发：checkpoint 落库（读改写 meta）与进度写（整行读改写）交错
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        await Promise.all([
          repo.appendCheckpoint(sessionId, "turn-1", mkCp(`cp-${i}`, i + 1, 100 + i)),
          sessions.updateTurn(sessionId, "turn-1", { status: "running", stepCount: i + 1 }),
        ]);
      })
    );

    const metas = await repo.listMeta(sessionId, "turn-1");
    const turn = (await sessions.get(sessionId))?.turns.find((t) => t.id === "turn-1");
    // 不变式：集合行数 == turn 的 meta 数 == checkpointCount。
    // 注：O2 的丢更新窗口由「所有写路径进同一事务队列」在构造上关闭；本条是
    // 不变式守卫（变异验证表明单靠它无法区分有无 writeTx——两个写都走同一
    // 连接/微任务队列），不谎称是 O2 的变异回归测试。
    expect(metas).toHaveLength(8);
    expect(turn?.checkpoints).toHaveLength(8);
    expect(turn?.checkpointCount).toBe(8);
  });

  it("turn 行不存在时 appendCheckpoint 静默 no-op（best-effort 口径）", async () => {
    const driver = makeDriver();
    const sessions = new SessionRepository(driver);
    const repo = new CheckpointRepository(driver);
    const session = await sessions.create({ workspaceId: "ws-1", title: "t" });
    await expect(repo.appendCheckpoint(session.id, "ghost-turn", mkCp("cp-1", 1, 1))).resolves.toBeUndefined();
    expect(await repo.listMeta(session.id)).toHaveLength(0);
  });
});

describe("CHECKPOINTS_COLLECTION 常量", () => {
  it("集合名稳定（存储契约）", () => {
    expect(CHECKPOINTS_COLLECTION).toBe("session_checkpoints");
  });
});
