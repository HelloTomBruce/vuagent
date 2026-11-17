/**
 * 存储驱动抽象接口 (IStorageDriver)
 * 支持基于内存 (Memory)、本地数据库 (SQLite) 或未来云端数据库 (PostgreSQL) 的统一驱动规范
 */

export interface IStorageDriver {
  get<T>(collection: string, id: string): Promise<T | null>;
  set<T>(collection: string, id: string, value: T): Promise<void>;
  delete(collection: string, id: string): Promise<boolean>;
  list<T>(collection: string, filter?: (item: T) => boolean): Promise<T[]>;
  clear(collection?: string): Promise<void>;
}
