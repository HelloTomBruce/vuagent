#!/usr/bin/env node
/**
 * 性能基线（W2/T12）：合成 30 步轮次库，量化 checkpoint 拆行的五项指标。
 *
 * 运行：pnpm --filter @vuagent/server exec tsx ../../scripts/perf-baseline.mjs [--json] [--strict]
 * （tsx 解析 workspace 内 TS 入口；缺 dist 会先提示 pnpm build）
 *   --json    输出机器可读结果
 *   --strict  超门槛按失败退出（默认 warn 不红；CI 用软门槛，发版前人工复测真实库）
 *
 * 门槛（docs/design/checkpoint-store-split.md §7）：
 *   单步落盘 < 5ms ｜ turn 行 < 300KB ｜ 8 并发写阻塞 < 50ms ｜ 详情装配 < 50ms ｜ 详情载荷 < 1MB
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const distUrl = (rel) => pathToFileURL(path.join(ROOT, "../packages/server/dist", rel)).href;
if (!fs.existsSync(path.join(ROOT, "../packages/server/dist/index.js"))) {
  console.error("✗ 缺 packages/server/dist —— 先 pnpm build");
  process.exit(2);
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const strict = args.includes("--strict");

const { SQLiteStorageDriver } = await import(distUrl("index.js"));
const { SessionRepository } = await import(distUrl("storage/repositories/session.repository.js"));
const { CheckpointRepository } = await import(distUrl("storage/repositories/checkpoint.repository.js"));

const STEPS = 30;
const SNAPSHOT_MSGS = 24; // ≈392KB/步的合成快照（对齐真实库单快照均值量级）
const GATES = {
  stepWriteMs: 5,
  turnRowKB: 300,
  concurrentBlockMs: 50,
  detailAssembleMs: 50,
  detailPayloadMB: 1,
};

const mb = (n) => +(n / 1048576).toFixed(2);
const kb = (n) => +(n / 1024).toFixed(1);
const ms = (n) => +n.toFixed(1);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-perf-"));
const driver = new SQLiteStorageDriver(path.join(dir, "bench.db"));
const sessions = new SessionRepository(driver);
const checkpoints = new CheckpointRepository(driver);

const session = await sessions.create({ workspaceId: "ws-perf", title: "perf" });
await sessions.appendTurn(session.id, {
  id: "turn-perf",
  sessionId: session.id,
  prompt: "perf prompt",
  status: "running",
  stepCount: 0,
  checkpoints: [],
  cards: [],
  createdAt: Date.now(),
});

/** 合成快照：24 条 assistant 消息（约 400KB 量级） */
function bigSnapshot(step) {
  return Array.from({ length: SNAPSHOT_MSGS }, (_, i) => ({
    role: "assistant",
    content: `${"x".repeat(16_000)} <step ${step} msg ${i}>`,
  }));
}

// ── ① 单步落盘：appendCheckpoint（小行）+ updateTurn（meta 行）────────
const stepTimes = [];
for (let step = 1; step <= STEPS; step++) {
  const cp = {
    id: `cp-turn-perf-${step}`,
    turnId: "turn-perf",
    stepIndex: step,
    messagesSnapshot: bigSnapshot(step),
    snapshotAt: Date.now() + step,
  };
  const t0 = performance.now();
  await checkpoints.appendCheckpoint(session.id, "turn-perf", cp);
  await sessions.updateTurn(session.id, "turn-perf", {
    status: "running",
    content: `acc ${step}`,
    stepCount: step,
    checkpoints: cp ? [{ id: cp.id, turnId: cp.turnId, stepIndex: cp.stepIndex, snapshotAt: cp.snapshotAt }] : [],
    checkpointCount: step,
    checkpointsSplit: true,
  });
  stepTimes.push(performance.now() - t0);
}
const stepWriteMs = stepTimes.sort((a, b) => a - b)[Math.floor(STEPS / 2)];

// ── ② turn 行体积 ────────────────────────────────────────────────────
const turnRow = driver.database.prepare("SELECT LENGTH(data) n FROM kv_store WHERE collection='session_turns' AND id=?").get(`${session.id}:turn-perf`);
const turnRowKB = kb(turnRow.n);
const checkpointsBytes = driver.database.prepare("SELECT SUM(LENGTH(data)) n FROM kv_store WHERE collection='session_checkpoints'").get()?.n ?? 0;

// ── ③ 8 会话并发写的事件循环阻塞 ─────────────────────────────────────
async function seedOtherSession(id) {
  const s = await sessions.create({ workspaceId: "ws-perf", title: id });
  await sessions.appendTurn(s.id, {
    id: "turn-x", sessionId: s.id, prompt: "p", status: "running",
    stepCount: 0, checkpoints: [], cards: [], createdAt: Date.now(),
  });
  return s.id;
}
const otherIds = [];
for (let i = 0; i < 8; i++) otherIds.push(await seedOtherSession(`concurrent-${i}`));

let maxGap = 0;
let last = performance.now();
let probing = true;
const probe = () => {
  const now = performance.now();
  maxGap = Math.max(maxGap, now - last);
  last = now;
  if (probing) setImmediate(probe);
};
setImmediate(probe);

const t0 = performance.now();
await Promise.all(
  otherIds.map(async (sid) => {
    for (let step = 1; step <= 6; step++) {
      await checkpoints.appendCheckpoint(sid, "turn-x", {
        id: `cp-${sid}-${step}`,
        turnId: "turn-x",
        stepIndex: step,
        messagesSnapshot: bigSnapshot(step),
        snapshotAt: Date.now() + step,
      });
      await sessions.updateTurn(sid, "turn-x", { status: "running", stepCount: step, checkpointCount: step, checkpointsSplit: true });
    }
  })
);
const concurrentTotalMs = performance.now() - t0;
probing = false;
await new Promise((r) => setTimeout(r, 5));
const concurrentBlockMs = ms(maxGap);

// ── ④/⑤ 详情装配时间与载荷体积 ──────────────────────────────────────
const t1 = performance.now();
const detail = await sessions.get(session.id);
const detailAssembleMs = ms(performance.now() - t1);
const detailPayloadMB = mb(JSON.stringify(detail).length);

await driver.close?.();
fs.rmSync(dir, { recursive: true, force: true });

const result = {
  machine: { platform: os.platform(), cpus: os.cpus().length, node: process.version },
  fixture: { steps: STEPS, snapshotMsgs: SNAPSHOT_MSGS, checkpointsBytesMB: mb(checkpointsBytes) },
  metrics: {
    stepWriteMs: ms(stepWriteMs),
    turnRowKB,
    concurrentBlockMs,
    concurrentTotalMs: ms(concurrentTotalMs),
    detailAssembleMs,
    detailPayloadMB,
  },
  gates: GATES,
  pass:
    ms(stepWriteMs) < GATES.stepWriteMs &&
    turnRowKB < GATES.turnRowKB &&
    concurrentBlockMs < GATES.concurrentBlockMs &&
    detailAssembleMs < GATES.detailAssembleMs &&
    detailPayloadMB < GATES.detailPayloadMB,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("性能基线（合成 30 步轮次）");
  console.log(`  机器        ${result.machine.platform} / ${result.machine.cpus} cpus / node ${result.machine.node}`);
  console.log(`  ① 单步落盘  ${result.metrics.stepWriteMs} ms        （门槛 < ${GATES.stepWriteMs} ms）`);
  console.log(`  ② turn 行   ${turnRowKB} KB        （门槛 < ${GATES.turnRowKB} KB；快照集合共 ${result.fixture.checkpointsBytesMB} MB 在独立集合）`);
  console.log(`  ③ 并发阻塞  ${result.metrics.concurrentBlockMs} ms        （门槛 < ${GATES.concurrentBlockMs} ms；8 会话×6 步总耗时 ${result.metrics.concurrentTotalMs} ms）`);
  console.log(`  ④ 详情装配  ${result.metrics.detailAssembleMs} ms         （门槛 < ${GATES.detailAssembleMs} ms）`);
  console.log(`  ⑤ 详情载荷  ${result.metrics.detailPayloadMB} MB         （门槛 < ${GATES.detailPayloadMB} MB）`);
  console.log(result.pass ? "✓ 全部过门槛" : "✗ 存在超门槛项（--strict 时按失败退出）");
}
process.exit(result.pass || !strict ? 0 : 1);
