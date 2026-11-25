import type { IStorageDriver } from "../drivers/base.driver.js";
import { supportsCostAggregate } from "../drivers/base.driver.js";

/**
 * 成本台账仓储（TASK-052）：token 计量从「遥测事件里的数字」升级为
 * 「可持久化、可查询、可准入拦截的账」。
 *
 * 存储形态：IStorageDriver 泛型 kv_store 的 cost_records collection。
 * TASK-093：SQLite 驱动具备 aggregateCostRecords（json_extract 库内聚合）时
 * 聚合走 SQL 下推——准入每请求的 sumWindow 不再全表 list + 内存过滤；
 * memory/redis 驱动自动回落 list 口径（行为不变）。
 * 多副本部署的分布式台账（Redis zset）留待真有多副本需求时引入。
 */

export interface CostRecord {
  /** 记录 id：`cost-${turnId}`（一轮一条，重复记账 upsert 幂等） */
  id: string;
  turnId: string;
  sessionId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** 计价表命中时计算；缺单价则 undefined（只记量不记钱） */
  costUsd?: number;
  finishedAt: number;
}

export interface WindowUsage {
  tokens: number;
  costUsd: number;
  recordCount: number;
}

const COLLECTION = "cost_records";

/** SQL 分组行 → Record<key, WindowUsage>（costUsd 精度收口与 list 口径一致） */
function groupRows(
  rows: Array<{ key: string; tokens: number; costUsd: number; recordCount: number }>,
  keep: (row: { key: string }) => boolean = () => true
): Record<string, WindowUsage> {
  const out: Record<string, WindowUsage> = {};
  for (const row of rows) {
    if (!keep(row)) continue;
    out[row.key] = {
      tokens: row.tokens,
      costUsd: Number(row.costUsd.toFixed(6)),
      recordCount: row.recordCount,
    };
  }
  return out;
}

export class CostRecordRepository {
  constructor(private driver: IStorageDriver) {}

  /** 记账（一轮一条，按 id upsert 幂等） */
  async record(entry: Omit<CostRecord, "id"> & { id?: string }): Promise<void> {
    const id = entry.id ?? `cost-${entry.turnId}`;
    await this.driver.set<CostRecord>(COLLECTION, id, { ...entry, id });
  }

  /** 原始记录列表（窗口求和的实现基础，也可供调试导出） */
  async list(): Promise<CostRecord[]> {
    return this.driver.list<CostRecord>(COLLECTION);
  }

  /** 滚动窗口累计（自 now-windowMs 起、无上界）：tokens = prompt + completion 总和 */
  async sumWindow(windowMs: number): Promise<WindowUsage> {
    return this.sumWindowBetween(Date.now() - windowMs, Number.POSITIVE_INFINITY);
  }

  /** 任意区间累计 [since, until)（TASK-075：自定义日期范围出口） */
  async sumWindowBetween(since: number, until: number): Promise<WindowUsage> {
    // TASK-093：SQLite 下推聚合（零 JSON 解码往返）；其余驱动回落 list 口径
    if (supportsCostAggregate(this.driver)) {
      const rows = await this.driver.aggregateCostRecords({ since, until });
      const row = rows[0];
      return row
        ? { tokens: row.tokens, costUsd: Number(row.costUsd.toFixed(6)), recordCount: row.recordCount }
        : { tokens: 0, costUsd: 0, recordCount: 0 };
    }
    let tokens = 0;
    let costUsd = 0;
    let recordCount = 0;
    for (const r of await this.list()) {
      if (r.finishedAt < since || r.finishedAt >= until) continue;
      tokens += r.promptTokens + r.completionTokens;
      costUsd += r.costUsd ?? 0;
      recordCount++;
    }
    return { tokens, costUsd: Number(costUsd.toFixed(6)), recordCount };
  }

  /** 滚动窗口按模型聚合（finops summary 出口，无上界） */
  async sumWindowByModel(windowMs: number): Promise<Record<string, WindowUsage>> {
    return this.sumWindowByModelBetween(Date.now() - windowMs, Number.POSITIVE_INFINITY);
  }

  /** 近窗口按会话聚合（TASK-054 成本徽标数据源，一次批量避免逐会话 N+1） */
  async sumWindowBySession(windowMs: number): Promise<Record<string, WindowUsage>> {
    return this.sumWindowBySessionBetween(Date.now() - windowMs, Number.POSITIVE_INFINITY);
  }

  /** 任意区间按会话聚合 [since, until) */
  async sumWindowBySessionBetween(
    since: number,
    until: number
  ): Promise<Record<string, WindowUsage>> {
    if (supportsCostAggregate(this.driver)) {
      const rows = await this.driver.aggregateCostRecords({ since, until, groupBy: "sessionId" });
      return groupRows(rows, (row) => row.key !== "" && row.key !== "__all__");
    }
    const bySession: Record<string, WindowUsage> = {};
    for (const r of await this.list()) {
      if (r.finishedAt < since || r.finishedAt >= until) continue;
      if (!r.sessionId) continue;
      const bucket = (bySession[r.sessionId] ??= { tokens: 0, costUsd: 0, recordCount: 0 });
      bucket.tokens += r.promptTokens + r.completionTokens;
      bucket.costUsd += r.costUsd ?? 0;
      bucket.recordCount++;
    }
    for (const bucket of Object.values(bySession)) {
      bucket.costUsd = Number(bucket.costUsd.toFixed(6));
    }
    return bySession;
  }

  /** 任意区间按模型聚合 [since, until) */
  async sumWindowByModelBetween(since: number, until: number): Promise<Record<string, WindowUsage>> {
    if (supportsCostAggregate(this.driver)) {
      const rows = await this.driver.aggregateCostRecords({ since, until, groupBy: "model" });
      return groupRows(rows);
    }
    const byModel: Record<string, WindowUsage> = {};
    for (const r of await this.list()) {
      if (r.finishedAt < since || r.finishedAt >= until) continue;
      const bucket = (byModel[r.model] ??= { tokens: 0, costUsd: 0, recordCount: 0 });
      bucket.tokens += r.promptTokens + r.completionTokens;
      bucket.costUsd += r.costUsd ?? 0;
      bucket.recordCount++;
    }
    for (const bucket of Object.values(byModel)) {
      bucket.costUsd = Number(bucket.costUsd.toFixed(6));
    }
    return byModel;
  }

  /**
   * 台账保留策略（TASK-093）：删除 finishedAt < beforeTs 的历史记录。
   * kv 通用实现（list + delete，删除低频可接受）；
   * server 启动时按 VUAGENT_COST_RETENTION_DAYS（缺省 30，0=不清理）周期修剪一次。
   */
  async pruneBefore(beforeTs: number): Promise<number> {
    let pruned = 0;
    let sinceYield = 0;
    for (const r of await this.list()) {
      if (r.finishedAt < beforeTs) {
        await this.driver.delete(COLLECTION, r.id);
        pruned++;
        // 每 200 条让出事件循环一拍（审查 Nit 修复）：大量过期台账时逐行同步
        // await delete 虽是异步调用但中间无让出点，长删除会阻塞停机/启动路径
        if (++sinceYield >= 200) {
          sinceYield = 0;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    return pruned;
  }
}
