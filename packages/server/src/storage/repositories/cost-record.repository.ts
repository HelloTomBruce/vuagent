import type { IStorageDriver } from "../drivers/base.driver.js";

/**
 * 成本台账仓储（TASK-052）：token 计量从「遥测事件里的数字」升级为
 * 「可持久化、可查询、可准入拦截的账」。
 *
 * 存储形态：IStorageDriver 泛型 kv_store 的 cost_records collection——
 * sqlite 与 memory 驱动天然支持，无需扩展驱动接口（本地单机 O(list) 可接受）。
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

  /** 任意区间按模型聚合 [since, until) */
  async sumWindowByModelBetween(since: number, until: number): Promise<Record<string, WindowUsage>> {
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
}
