/**
 * SQLite 单机形态的 HITL 决策落账外置（送达后幂等，遗留尾巴）。
 *
 * Redis 外置（core/redis-externalize.ts）覆盖多副本形态：挂起 + 决策都外置。
 * 本模块是 SQLite 单机形态的对应物，只外置「决策」一件事：
 *
 * - 决策落账（saveDecision/getDecision）：送达路径（TASK-091）与孤儿路径共用。
 *   同 actionId 重复 POST 在路由层 prior 命中（action-envelope decisionPayloadHash：
 *   同体 200 delivered:false / 异体 422 ACTION_PAYLOAD_MISMATCH），不再回落兜底
 *   扫描 404 谎报「无此挂起」；进程重启后新建实例打开同一 db 文件，重放依旧幂等。
 * - 挂起（savePending/deletePending/listPending）：诚实最小实现——空操作 + 空列表。
 *   取舍：SQLite 单机无多副本，挂起等待的协程只在发起进程内活着，外置挂起记录
 *   跨进程也唤醒不了任何协程；让挂起「重启后可见」只会制造一个必然 404 的僵尸条目。
 *   挂起可见性维持内存态（/api/action/suspended 只报活挂起），进程重启后未送达
 *   挂起 404 是诚实语义（遗留 running 轮次由恢复机制标记 process_restart）。
 *
 * 与 Redis 形态的差异：决策不设 24h TTL——本地盘行成本可忽略，幂等窗口取
 * 「行存在即有效」；created_at 列保留给未来清理策略。fail-open 纪律与 Redis 版
 * 一致由调用方承担（ActionHub persistPending 吞错 / 路由层 .catch(() => {})），
 * 本模块如实上抛 SQL 错误，不吞。
 */
import type { DatabaseSync } from "node:sqlite";
import type {
  ActionPersistStore,
  ActionResponse,
  SuspendedActionInfo,
} from "../core/action-hub.js";

/** decisions 表行形态（payload 为 ActionResponse 全量 JSON；toolName/args 冗余列便于直查） */
interface DecisionRow {
  actionId: string;
  payload: string;
  toolName: string | null;
  args: string | null;
  created_at: number;
}

const INIT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS decisions (
    actionId TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    toolName TEXT,
    args TEXT,
    created_at INTEGER NOT NULL
  );
`;

/**
 * 决策落账随附的组件上下文（TASK-092）：落账后的同体重放依赖 prior.toolName/args
 * 恢复交互组件身份（resultSchema 重派生 → 校验 → 确定性 secret 剥离对称），
 * 此处从响应体提取这两列；payload JSON 内同时保留全量（getDecision 原样解析回 ActionResponse）。
 */
function extractContext(payload: ActionResponse): { toolName: string | null; args: string | null } {
  const toolName = typeof payload.toolName === "string" ? payload.toolName : null;
  const args = payload.args !== undefined && payload.args !== null ? JSON.stringify(payload.args) : null;
  return { toolName, args };
}

/**
 * 构造 SQLite 版 ActionPersistStore。
 * @param db 共享的 node:sqlite 连接——由 server 注入点从 SQLiteStorageDriver 暴露的
 *           句柄传入（同连接复用，避免同文件双连接的写锁协调）。
 */
export function createSqliteActionPersist(db: DatabaseSync): ActionPersistStore {
  db.exec(INIT_SCHEMA);
  return {
    // 诚实最小实现：pendings 不外置（见文件头注释取舍），写入/删除即空操作，
    // 列表恒空——路由层孤儿判定在 SQLite 形态自然走不到（listPending() 恒 []）。
    async savePending(_info): Promise<void> {},
    async deletePending(_actionId): Promise<void> {},
    async listPending(): Promise<SuspendedActionInfo[]> {
      return [];
    },

    /** 决策落账（INSERT OR REPLACE：同 actionId 重复落账以最后一次为准，幂等键就是行主键） */
    async saveDecision(actionId, payload): Promise<void> {
      const { toolName, args } = extractContext(payload);
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO decisions (actionId, payload, toolName, args, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      stmt.run(actionId, JSON.stringify(payload), toolName, args, Date.now());
    },

    /** 决策读取：损坏 payload 返回 undefined（fail-open，路由层回落「无法判定」旧行为） */
    async getDecision(actionId): Promise<ActionResponse | undefined> {
      const stmt = db.prepare(`SELECT payload FROM decisions WHERE actionId = ?`);
      const row = stmt.get(actionId) as Pick<DecisionRow, "payload"> | undefined;
      if (!row) return undefined;
      try {
        return JSON.parse(row.payload) as ActionResponse;
      } catch {
        return undefined;
      }
    },
  };
}
