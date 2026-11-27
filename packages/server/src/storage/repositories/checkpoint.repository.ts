import type { IStorageDriver } from "../drivers/base.driver.js";
import { supportsPrefixList, supportsTransaction } from "../drivers/base.driver.js";
import type { CheckpointEntity, CheckpointMeta } from "../interfaces.js";
import { isFullCheckpoint, toCheckpointMeta } from "../interfaces.js";
import { checkpointKey, turnRowKey } from "../keys.js";

/**
 * checkpoint 独立仓储（0.7.0 W2 拆行存储，docs/design/checkpoint-store-split.md）。
 *
 * 背景：checkpoint（含 messagesSnapshot 全量上下文投影）此前内联在 turn 行里——
 * 32 步轮次的 turn 行达 ~12MB（快照占 99%），每 250ms 进度落盘整行重写，
 * 单次 112ms 同步阻塞事件循环。拆行后快照 append-only 落本集合（每步一次小行写），
 * turn 行只留 CheckpointMeta 元数据，写放大从 O(步数²) 降为 O(1)/步。
 *
 * 键与排序口径：
 * - 行键 = `${sessionId}:${turnId}:${checkpointId}`（checkpointId 全局唯一，O(1) 点查）；
 * - 排序以 **snapshotAt**（落库时间）为主键——历史数据里 compact 的 stepIndex 是
 *   「被压缩 cp.stepIndex + 1」，与下一 turn 的步号语义重叠，不能作排序主键；
 *   snapshotAt 单调递增，语义即「落库顺序 = 新旧顺序」。
 * - 行值包装 `{ sessionId, checkpoint }`：无前缀能力的驱动（全量 list 回落）也能
 *   按会话精确过滤（实体本身不含 sessionId）。
 *
 * 与 turn 行的一致性：appendCheckpoint 与「turn 元数据（checkpoints meta 数组 +
 * checkpointCount + checkpointsSplit 标记）更新」在同一事务内（驱动支持时），
 * 防止 count 与行数漂移。事务体内的 await 只链接微任务（驱动语句实现全同步），
 * BEGIN/COMMIT 之间不会插入其它请求的语句。
 */

/** 独立集合名（append-only：只 append 与 prune 删除，不 update 已有内容） */
export const CHECKPOINTS_COLLECTION = "session_checkpoints";

/** session.repository 的 turn 行形状（跨仓储复用；此处只关心 checkpoint 相关字段） */
export interface TurnRowLike {
  index: number;
  turn: {
    checkpoints?: Array<Partial<CheckpointEntity> & CheckpointMeta>;
    checkpointCount?: number;
    checkpointsSplit?: boolean;
    [key: string]: unknown;
  };
}

/** 行值包装：sessionId 冗余存一份，无前缀能力的驱动按它过滤 */
interface CheckpointRow {
  sessionId: string;
  checkpoint: CheckpointEntity;
}

/** 落库顺序比较器：snapshotAt 升序，tie 用 stepIndex 再 id（确定性）；meta/实体两态通用 */
function byRecency(a: CheckpointMeta, b: CheckpointMeta): number {
  if (a.snapshotAt !== b.snapshotAt) return a.snapshotAt - b.snapshotAt;
  if (a.stepIndex !== b.stepIndex) return a.stepIndex - b.stepIndex;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class CheckpointRepository {
  constructor(private driver: IStorageDriver) {}

  /**
   * 落一条 checkpoint（append-only）并同事务维护 turn 元数据：
   * - 首次触达 legacy turn（内联完整实体且无 checkpointsSplit 标记）时先搬库：
   *   内联快照逐条入本集合，turn 行改写为 meta + 标记（键覆盖，天然幂等）；
   * - 追加本条行 + turn 元数据（meta 数组 / checkpointCount）。
   * turn 行不存在（running 行尚未落）时静默 no-op——与既有 best-effort 口径一致，
   * 终态 appendTurn upsert 兜底。
   */
  async appendCheckpoint(sessionId: string, turnId: string, checkpoint: CheckpointEntity): Promise<void> {
    const mutate = async (): Promise<void> => {
      const rowKey = turnRowKey(sessionId, turnId);
      const row = await this.driver.get<TurnRowLike>("session_turns", rowKey);
      if (!row?.turn) return;

      const metas: CheckpointMeta[] = [];
      let split = row.turn.checkpointsSplit === true;
      if (!split && Array.isArray(row.turn.checkpoints)) {
        for (const cp of row.turn.checkpoints) {
          if (isFullCheckpoint(cp)) {
            // legacy 内联完整实体：搬入独立集合（键含 cp.id，重复触发键覆盖，幂等）
            await this.driver.set(
              CHECKPOINTS_COLLECTION,
              checkpointKey(sessionId, turnId, cp.id),
              { sessionId, checkpoint: cp as CheckpointEntity } satisfies CheckpointRow,
            );
          }
          metas.push(toCheckpointMeta(cp as CheckpointEntity));
        }
        split = true;
      } else if (Array.isArray(row.turn.checkpoints)) {
        metas.push(...row.turn.checkpoints);
      }

      await this.driver.set(
        CHECKPOINTS_COLLECTION,
        checkpointKey(sessionId, turnId, checkpoint.id),
        { sessionId, checkpoint } satisfies CheckpointRow,
      );

      // 同 id 重复落库（理论不发生）：meta 去重保持 count 与行数一致
      const next = metas.filter((m) => m.id !== checkpoint.id);
      next.push(toCheckpointMeta(checkpoint));
      next.sort(byRecency);

      await this.driver.set("session_turns", rowKey, {
        index: row.index,
        turn: {
          ...row.turn,
          checkpoints: next,
          checkpointCount: next.length,
          checkpointsSplit: true,
        },
      });
    };

    if (supportsTransaction(this.driver)) {
      await this.driver.transaction(mutate);
      return;
    }
    await mutate();
  }

  /**
   * 某 turn 的 checkpoint 元数据（落库顺序）；turnId 缺省 = 全会话。
   *
   * ⚠️ 评审 R2：**不读** session_checkpoints 集合。该集合每行都含完整
   * messagesSnapshot（单会话可达 120MB），只取元数据时把全部快照 JSON.parse
   * 一遍代价极高（实测 300 条 / 120MB → 81ms + 446MB RSS）。元数据的权威副本
   * 就是 turn 行里的 meta 数组（appendCheckpoint 同事务维护），从这里读近乎零成本。
   */
  async listMeta(sessionId: string, turnId?: string): Promise<CheckpointMeta[]> {
    const rows = await this.listTurnRows(sessionId, turnId);
    const metas: CheckpointMeta[] = [];
    for (const row of rows) {
      for (const cp of row?.turn?.checkpoints ?? []) {
        // 两种形态都含元数据四字段，直接抽取（无需 cast/守卫收窄，评审 O3）
        metas.push(toCheckpointMeta(cp));
      }
    }
    return metas.sort(byRecency);
  }

  /** turn 行读取（meta 的权威来源；驱动具备前缀能力时下推） */
  private async listTurnRows(sessionId: string, turnId?: string): Promise<TurnRowLike[]> {
    const prefix = turnId ? turnRowKey(sessionId, turnId) : `${sessionId}:`;
    if (supportsPrefixList(this.driver)) {
      return this.driver.listByPrefix<TurnRowLike>("session_turns", prefix);
    }
    const all = await this.driver.list<TurnRowLike>("session_turns");
    return all.filter((row) => {
      const turn = row?.turn as { sessionId?: string; id?: string } | undefined;
      if (turn?.sessionId !== sessionId) return false;
      return turnId ? turn.id === turnId : true;
    });
  }

  /** 按 id 取完整 checkpoint（含快照大对象）；不存在返回 null */
  async getById(sessionId: string, turnId: string, checkpointId: string): Promise<CheckpointEntity | null> {
    const row = await this.driver.get<CheckpointRow>(
      CHECKPOINTS_COLLECTION,
      checkpointKey(sessionId, turnId, checkpointId),
    );
    return row?.checkpoint ?? null;
  }

  /**
   * 会话内最新带快照的 checkpoint（compact 的历史起点 / 新轮次历史重建源）；无则 null。
   * 评审 O7：按「轮次由新到旧 → 每条 meta 由新到旧」逐条点查，命中即返回——
   * 不再把全会话快照一次性读进内存（只有极少数点查会真正反序列化大对象）。
   */
  async latestWithSnapshot(sessionId: string): Promise<CheckpointEntity | null> {
    const rows = await this.listTurnRows(sessionId);
    const ordered = rows
      .slice()
      .sort((a, b) => (b?.index ?? 0) - (a?.index ?? 0));
    for (const row of ordered) {
      const turnId = (row?.turn as { id?: string } | undefined)?.id;
      if (!turnId) continue;
      const metas = (row.turn.checkpoints ?? []).slice().sort((a, b) => byRecency(b, a));
      for (const meta of metas) {
        const cp = await this.getById(sessionId, turnId, meta.id);
        if (cp && Array.isArray(cp.messagesSnapshot) && cp.messagesSnapshot.length > 0) return cp;
      }
    }
    return null;
  }

  /** 某 turn 的全部完整 checkpoint（含快照；恢复/诊断用）：按 meta 逐条点查，不扫全表 */
  async listByTurn(sessionId: string, turnId: string): Promise<CheckpointEntity[]> {
    const metas = await this.listMeta(sessionId, turnId);
    const out: CheckpointEntity[] = [];
    for (const meta of metas) {
      const cp = await this.getById(sessionId, meta.turnId, meta.id);
      if (cp) out.push(cp);
    }
    return out;
  }

  /**
   * 删某 turn 的全部 checkpoint 行（prune / 回滚用）；返回删除数。
   * 与 appendCheckpoint 对称：删行的同时把 turn 行的 meta 数组清零（同事务），
   * 否则 meta 与集合行会漂移（详情端点列出已不存在的 checkpoint）。
   */
  async deleteTurnCheckpoints(sessionId: string, turnId: string): Promise<number> {
    const mutate = async (): Promise<number> => {
      const metas = await this.listMeta(sessionId, turnId);
      let deleted = 0;
      for (const meta of metas) {
        const ok = await this.driver.delete(CHECKPOINTS_COLLECTION, checkpointKey(sessionId, meta.turnId, meta.id));
        if (ok) deleted++;
      }
      const row = await this.driver.get<TurnRowLike>("session_turns", turnRowKey(sessionId, turnId));
      if (row?.turn) {
        await this.driver.set("session_turns", turnRowKey(sessionId, turnId), {
          index: row.index,
          turn: { ...row.turn, checkpoints: [], checkpointCount: 0, checkpointsSplit: true },
        });
      }
      return deleted;
    };
    if (supportsTransaction(this.driver)) return this.driver.transaction(mutate);
    return mutate();
  }
}
