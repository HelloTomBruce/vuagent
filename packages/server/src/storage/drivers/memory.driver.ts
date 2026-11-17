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

  async clear(collection?: string): Promise<void> {
    if (collection) {
      this.store.delete(collection);
    } else {
      this.store.clear();
    }
  }
}
