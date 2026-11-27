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

/**
 * 可选能力：成本台账聚合下推（TASK-093）。
 * SQLite 驱动以 json_extract 在库内聚合，避免 CostRecordRepository 每次准入都
 * 全表 list + 内存过滤；memory/redis 驱动不实现——仓储侧自动回落 list 口径。
 * 检测方式：duck-type（typeof (driver as ...).aggregateCostRecords === "function"）。
 */
export interface CostAggregateRow {
  /** 分组键（groupBy 缺省时为常量 "__all__"） */
  key: string;
  tokens: number;
  costUsd: number;
  recordCount: number;
}

export interface CostAggregateQuery {
  /** 区间 [since, until)（finishedAt 毫秒） */
  since: number;
  until: number;
  /** 分组维度；缺省 = 全量单行 */
  groupBy?: "model" | "sessionId";
}

export interface SqlCostAggregateSupport {
  aggregateCostRecords(query: CostAggregateQuery): Promise<CostAggregateRow[]>;
}

/** duck-type 检测驱动是否具备聚合下推能力 */
export function supportsCostAggregate(driver: IStorageDriver): driver is IStorageDriver & SqlCostAggregateSupport {
  return (
    typeof (driver as Partial<SqlCostAggregateSupport>).aggregateCostRecords === "function"
  );
}

/**
 * 可选能力：键前缀行读取（存储域审查 R2 读放大修复）。
 * SQLite 驱动以参数化 LIKE + ESCAPE 在库内下推前缀过滤；memory/redis 驱动以
 * 键前缀过滤——单会话行装配（session_turns 行键前缀 = `${sessionId}:`）不再
 * 全表 list。第三方驱动未实现时仓储侧自动回落全量 list 口径，行为不变。
 * 检测方式与 aggregateCostRecords 相同：duck-type（不破坏既有 IStorageDriver 实现面）。
 */
export interface PrefixListSupport {
  /** 返回键名以 prefix 开头的全部行（语义与 list 相同，仅键空间收窄） */
  listByPrefix<T>(collection: string, prefix: string): Promise<T[]>;
}

/** duck-type 检测驱动是否具备键前缀读取能力 */
export function supportsPrefixList(driver: IStorageDriver): driver is IStorageDriver & PrefixListSupport {
  return typeof (driver as Partial<PrefixListSupport>).listByPrefix === "function";
}

/**
 * 可选能力：事务（0.7.0 W2 checkpoint 拆行）。
 * appendCheckpoint 需要「checkpoint 行 + turn 元数据行」原子落库，拆事务会出现
 * count 与行数漂移。事务体允许返回 Promise：驱动的语句实现全部同步执行，
 * 事务体内的 await 只链接微任务——微任务队列在当前宏任务内排空后才轮到其它
 * 请求的处理回调，因此 BEGIN 与 COMMIT 之间不会插入其它请求的语句。
 * memory 驱动直接顺序执行；不实现此能力的驱动由仓储回落顺序写（仅失去原子性）。
 */
export interface TransactionSupport {
  /** 执行事务体；抛错（含异步链）时 ROLLBACK 并向上抛出 */
  transaction<T>(fn: () => T | Promise<T>): Promise<T>;
}

/** duck-type 检测驱动是否具备事务能力 */
export function supportsTransaction(driver: IStorageDriver): driver is IStorageDriver & TransactionSupport {
  return typeof (driver as Partial<TransactionSupport>).transaction === "function";
}
