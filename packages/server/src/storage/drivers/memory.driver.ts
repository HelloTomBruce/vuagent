import type { IStorageDriver } from "./base.driver.js";

/**
 * 内存存储驱动 (MemoryStorageDriver)
 * 用于单元测试、无状态沙箱与临时开发环境
 */
export class MemoryStorageDriver implements IStorageDriver {
  private store = new Map<string, Map<string, unknown>>();

  private getCollection(name: string): Map<string, unknown> {
    let col = this.store.get(name);
    if (!col) {
      col = new Map();
      this.store.set(name, col);
    }
    return col;
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const col = this.getCollection(collection);
    const item = col.get(id);
    if (!item) return null;
    return JSON.parse(JSON.stringify(item)) as T;
  }

  async set<T>(collection: string, id: string, value: T): Promise<void> {
    const col = this.getCollection(collection);
    col.set(id, JSON.parse(JSON.stringify(value)));
  }

  async delete(collection: string, id: string): Promise<boolean> {
    const col = this.getCollection(collection);
    return col.delete(id);
  }

  async list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]> {
    const col = this.getCollection(collection);
    const items = Array.from(col.values()).map((v) => JSON.parse(JSON.stringify(v)) as T);
    if (filter) {
      return items.filter(filter);
    }
    return items;
  }

  /**
   * 键前缀读取（PrefixListSupport，存储域审查 R2）：单会话行装配等前缀场景
   * 只扫命中键，不再全集合物化。语义与 list 一致，仅键空间收窄。
   */
  async listByPrefix<T>(collection: string, prefix: string): Promise<T[]> {
    const col = this.getCollection(collection);
    const items: T[] = [];
    for (const [id, value] of col) {
      if (!id.startsWith(prefix)) continue;
      items.push(JSON.parse(JSON.stringify(value)) as T);
    }
    return items;
  }

  /**
   * 事务（TransactionSupport，0.7.0 W2）：共享内存存储上事务必须独占——
   * appendCheckpoint 是读-改-写（turn 元数据合并），并发事务交错会丢失更新。
   * 与 sqlite 驱动同款 promise 链互斥队列串行化所有事务。
   */
  private txQueue: Promise<unknown> = Promise.resolve();

  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.txQueue.then(() => Promise.resolve(fn()));
    this.txQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  }

  async clear(collection?: string): Promise<void> {
    if (collection) {
      this.store.delete(collection);
    } else {
      this.store.clear();
    }
  }
}
