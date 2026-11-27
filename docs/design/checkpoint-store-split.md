# Checkpoint 拆行存储（性能治理 W2）设计

> 状态：**设计待评审**，纳入 0.7.0 同轮（与 CLI W1 并行）。整体排期见 [v0.7-plan.md](./v0.7-plan.md)。
> 动机（实测）：单个 turn 行 ≈ **12 MB**，其中 `checkpoints[].messagesSnapshot` 占 **12.25 MB（32 个快照，均值 392 KB）**，而真正变化的业务数据（content/thought/cards）只有 ~90 KB；每 250 ms 的进度落盘要整行重写 → 单次 **112 ms** 同步阻塞事件循环，8 会话并发时最长阻塞 **484 ms**；`GET /api/sessions/:id` 因此 **36.7 MB / 296 ms**。基线数字见 [cli-data-dir-architecture.md §16](./cli-data-dir-architecture.md#16-性能基线实测与容量判断)。

## 1. 目标与非目标

**目标**

- 进度落盘的写放大从 **O(步数²)** 降到 **O(1)/步**：单次 step 落盘 < 5 ms（现状 112 ms）；
- turn 行体积回到「业务数据量级」：32 步轮次 < 300 KB（现状 ~12 MB）；
- 详情接口回到亚 MB（现状 36.7 MB），切会话 < 100 ms；
- **不降低恢复能力**：mid-turn resume（TASK-101）、手动压缩（compact）、历史图片占位（TASK-083）语义逐条保持。

**非目标**

- 不改 SSE 协议（`packages/protocol` 不动，避免触发 protocol-sync 门禁）；
- 不做 SQLite worker 线程化（W2 先把数据模型修对；worker 化见 §8「后续可选」）；
- 不改 turn 的对外字段语义（`turn.checkpoints` 仍在，只是**降级为元数据**）。

## 2. 数据模型

### 2.1 新集合 `session_checkpoints`（append-only）

```
key   = `${sessionId}:${turnId}:${String(stepIndex).padStart(6,"0")}:${checkpointId}`
value = { index: number, checkpoint: CheckpointEntity }   // 含 messagesSnapshot
```

- 两种前缀扫描都成立：`${sessionId}:`（会话级，compact 找最新带快照）、`${sessionId}:${turnId}:`（轮次级，resume / 历史回放）。
- `stepIndex` 零填充使字符串序 = 步序；同 step 多 checkpoint（如 compact 追加）用 `checkpointId` 兜底。
- 只 append，不 update、不 delete（除 prune）：一条 checkpoint 落库后不可变，这正是「不可变快照」的语义。

### 2.2 Turn 行只留元数据

```ts
/** 元数据子集：CheckpointEntity 去掉 messagesSnapshot / variableSnapshot */
export interface CheckpointMeta {
  id: string;
  stepIndex: number;
  snapshotAt: number;
}

export interface TurnEntity {
  // …现有字段不变
  /** ⚠️ 语义变更：只含元数据，不再是完整快照数组 */
  checkpoints?: CheckpointMeta[];
  /** 冗余计数：recovery 等只数条数的路径免读数组 */
  checkpointCount?: number;
  /** 收尾时算好的「该轮曾有图」标记，替代 history-builder 读快照判定（TASK-083） */
  hasImages?: boolean;
  /** turn 级迁移标记：checkpoints 已全部落独立集合 */
  checkpointsSplit?: boolean;
}
```

**兼容性**：`CheckpointMeta ⊂ CheckpointEntity`，因此旧 console 的 `turn.checkpoints.length`、`lastCp.id` 继续可用；只有 `lastCp.messagesSnapshot` 会缺失（见 §5.3 的降级安排）。

## 3. 写路径

| 位置 | 现状 | 改后 |
|---|---|---|
| [turn-persistence.ts](../../packages/server/src/core/turn-persistence.ts#L133-L157) `persistProgress` | `updateTurn({ …, checkpoints: state.checkpoints })` 整行带快照 | 不再传 checkpoints；只传 `content/thought/cards/stepCount/telemetry` + `checkpointCount` |
| [turn-persistence.ts](../../packages/server/src/core/turn-persistence.ts#L186-L200) `finalizeDone` / 终态场景 | 终态实体带全量 checkpoints | 终态同样只带元数据（快照每步已 append） |
| [session.repository.ts](../../packages/server/src/storage/repositories/session.repository.ts#L275-L300) `recordCheckpoint` | `row.turn.checkpoints.push(cp)` → 整行重写 | 新增 `appendCheckpoint(sessionId, turnId, cp)`：**一次小行 insert** + 更新 turn 的 `checkpointCount`/`checkpoints` 元数据（两步同事务） |
| 新 checkpoint 落库（compact 追加） | 塞进 turn 行 | 同 `appendCheckpoint` |

关键约束：

- `appendCheckpoint` 与「turn 元数据更新」必须在**同一事务**（`BEGIN … COMMIT`），否则 count 与行数会漂；`node:sqlite` 的 `DatabaseSync` 支持同步事务，driver 补一个 `transaction(fn)` 辅助（失败 ROLLBACK）。
- 事务内工作量恒定（两条小写），不随步数增长。

## 4. 读路径

| 消费方 | 现状 | 改后 |
|---|---|---|
| [history-builder.ts](../../packages/server/src/core/history-builder.ts) 历史重建 | **（实现期修订）**逐轮重放 `turn.checkpoints[last].messagesSnapshot`（快照是累积全量上下文，轮次切片只取本 turn 提问之后的消息）——设计初版误记为「仅图片占位判定」 | 新增 `latestSnapshot` 入参走**会话级单快照重放**：最新快照天然含此前所有轮次内容，一次遍历（system 跳过 / user 锚定轮次 prompt+图片注记 / assistant+tool 原样）即完成重建，O(N²)→O(1) 次读取；`hasImages` 标记优先，缺省（inline 形态）逐字走旧算法 |
| [recovery.ts](../../packages/server/src/core/recovery.ts#L38) | `turn.checkpoints.length` | `turn.checkpointCount ?? turn.checkpoints?.length ?? 0` |
| [agent-loop.ts](../../packages/server/src/core/agent-loop.ts#L300-L310) resume | `turn.checkpoints.find(id)` 取快照 | `checkpointsRepo.get(sessionId, checkpointId)`（按需读一条） |
| [server.ts](../../packages/server/src/server.ts#L1745-L1800) `POST /api/sessions/:id/compact` | 倒序扫所有 turn 的 checkpoints 找最新快照 | `checkpointsRepo.latestWithSnapshot(sessionId)`（前缀扫描 + 取最新），新 checkpoint 走 `appendCheckpoint` |
| `GET /api/sessions/:id` | turn 内联全量快照 | turn 只有元数据 → **自动瘦身**，无需改路由代码 |

新增仓储方法（`CheckpointRepository`，或并入 `SessionRepository`，视改动面定；建议独立类，便于测试与后续 prune）：

```ts
appendCheckpoint(sessionId, turnId, cp): Promise<void>
listMeta(sessionId, turnId?): Promise<CheckpointMeta[]>
get(sessionId, checkpointId): Promise<CheckpointEntity | null>
latestWithSnapshot(sessionId): Promise<CheckpointEntity | null>
deleteTurnCheckpoints(sessionId, turnId): Promise<number>   // prune/回滚用
```

## 5. 迁移

### 5.1 惰性迁移（默认路径，沿用 TASK-092 口径）

- 读：`turn.checkpointsSplit` 缺省时，`assemble` 把内联快照视为**遗留**，原样返回元数据（不搬、不读快照）。
- 写：任何写路径（`updateTurn` / `appendCheckpoint` / `finalizeTurn`）首次触达某 turn 时：
  1. 若该 turn 有内联 `messagesSnapshot` → 逐条写入 `session_checkpoints`；
  2. turn 行改为只留元数据 + `checkpointsSplit: true`；
  3. 一步事务完成，失败则整体回滚（保持遗留形态，下次重试）。
- 幂等：以 `checkpointsSplit` 标记判定，重复触达不重复搬。

### 5.2 批量迁移（CLI）

`vuagent migrate --checkpoints [--dry-run] [--no-backup] [--vacuum] [--session <id>]`：

- 逐 turn 迁移 + 汇报「turn 数 / checkpoint 数 / 物化 content 轮次」；
- `--dry-run` 只统计；执行前**强制** `VACUUM INTO exports/…` 备份（`--no-backup` 才跳过）；
- **迁移即刻 meta 化**（不做「保留内联 + 标记」双存储：双存储会让 `checkpointCount`
  与详情体积语义混乱）；原始数据的观察窗口由那份强制备份承载，确认无误后自行删除备份；
- `--vacuum` 迁移后原地紧凑化；`--session <id>` 只迁指定会话（灰度/排障用）。

> 早期草稿里的 `--prune-legacy` 已移除：它假设存在双存储清扫期，而实现选择即刻
> meta 化（评审 O4）。

### 5.3 兼容与回退

- 读路径同时支持「拆行」与「内联」两种形态（按 `checkpointsSplit` 判定）。
- 回退开关：`VUAGENT_CHECKPOINT_STORE=inline` 强制新写入也落回内联（仅一个发布周期保留，用于线上问题回滚）；默认 `split`。
- 旧 console 的 legacy 兜底（[useSessions.ts](../../apps/playground/src/console/composables/useSessions.ts#L175-L182) 用最后快照反推 assistant 内容）在拆行后失效——迁移时对「content 为空且能从最后快照反推」的 turn **物化写回 `content`**，一次性消除这条兜底依赖（`--dry-run` 会列出受影响轮次数）。

## 6. API 变化

| 端点 | 变化 | 兼容 |
|---|---|---|
| `GET /api/sessions/:id` | `turn.checkpoints` = 元数据数组 + `checkpointCount`（体积从 36.7 MB → < 1 MB） | 旧客户端读 `length`/`id` 仍成立 |
| `GET /api/sessions/:id/turns/:turnId/checkpoints` | **新增**：该轮 checkpoint 元数据列表（分页） | 旧客户端不用 |
| `GET /api/sessions/:id/checkpoints/:cpId` | **新增**：单条详情；默认只元数据，`?snapshot=1` 才带 `messagesSnapshot`（大对象显式取） | 旧客户端 404 → 无详情，不影响主流程 |

不新增 SSE 事件、不改 `packages/protocol`（避免 protocol-sync 门禁）；类型放宽只发生在 server 内部与 console 的本地类型。

## 7. 验收与测试

**性能验收（在真实库副本上跑，脚本入库 `scripts/perf-baseline.mjs`）**

| 指标 | 现状 | 目标（硬门槛） |
|---|---|---|
| 单步落盘（32 步轮次） | 112 ms | **< 5 ms** |
| turn 行（32 步） | ~12 MB | **< 300 KB** |
| 8 会话并发写，事件循环最长阻塞 | 484 ms | **< 50 ms** |
| `GET /api/sessions/:id`（最大会话） | 36.7 MB / 296 ms | **< 1 MB / < 50 ms** |
| 切会话（本机） | 200–300 ms | **< 100 ms** |

脚本产出固定 JSON（含机器信息），CI 只在**合成 30 步库**上跑软门槛（超阈值 warn 不红），发版前在真实库复测并贴数字。

**单测**

- 迁移：惰性触发一次 / 幂等 / 中断回滚 / 强制备份与 `--no-backup` / 回滚开关；
- 读写兼容：内联遗留 → 拆行新数据双向可读；`checkpointCount` 与集合行数一致；
- history-builder：`hasImages` 优先级 + 旧数据快照回退；
- compact：新 checkpoint 落独立集合、`latestWithSnapshot` 在 0 / 1 / N 条时的边界；
- resume：按 id 取快照后能重建上下文（复用现有 TASK-101 测试）;
- API：详情响应体积快照（fixture 30 步轮次，断言 < 1 MB）、新端点 404/200/`?snapshot=1`。

## 8. 后续可选（不做进本轮）

- **worker_thread 化**：把 SQLite 读写挪到专用 worker，主线程只投递任务（彻底消除阻塞，代价是事务/测试复杂度上升）；
- **增量 patch 写**：用 SQLite `json_set` 只改变化字段，进一步降低 content 增长时的写量（当前 content < 100 KB，收益有限）；
- **checkpoint 保留策略**：`prune --checkpoints-keep N`（只留最近 N 个快照），给超长轮次兜底；
- **压缩快照**：`messagesSnapshot` 以 zstd 存 BLOB（体积收益大，但可读性/调试成本上升）。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 迁移改坏历史 → 恢复能力下降 | 惰性 + `--dry-run` + 执行前备份 + 保留原内联一个版本 + `inline` 回退开关 |
| 详情瘦身后 console 某处隐性依赖快照 | 全仓 grep `messagesSnapshot` 收敛到 3 个消费点，均在本设计覆盖内；`useSessions` 兜底改为迁移期物化 |
| 事务粒度不当导致 count 与行数漂移 | `appendCheckpoint` + 元数据更新同事务；补一致性测试（随机写后校验） |
| 迁移在 112 MB 真实库上耗时 | 批量迁移走 `--dry-run` 预估；CLI 打印进度与体积变化；支持中断续跑（幂等） |
| `VUAGENT_CHECKPOINT_STORE=inline` 遗留过久 | 在 0.8.0 移除，写入 changeset 的 deprecated 段 |
