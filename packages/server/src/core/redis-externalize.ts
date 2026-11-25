/**
 * Redis 外置存储（TASK-100）：HITL 挂起持久化 + 事件缓冲 ring。
 *
 * 动机（README 已知边界 1/2）：挂起与事件缓冲此前全在进程内——重启即失。
 * 本模块把两件东西外置到 Redis（仅 REDIS_URL 形态启用；SQLite 单机零改动）：
 * 1. 挂起 action：审批等待可达 180s，期间进程重启后决策仍可落账 + 审批卡回写
 *    （等待协程已死，唤醒不可能——诚实语义：delivered:false + 决策记录）；
 * 2. 事件缓冲 ring：轮次中断后客户端重连可补看中断前的增量事件
 *    （配合 subscribeFromSeq 的 seq 寻址；轮次本身仍由恢复机制诚实标记）。
 *
 * fail-open 纪律：Redis 故障不阻断主链路（写入失败静默；读取失败返回空）。
 * 键空间：vuagent:action:<actionId>（JSON）/ vuagent:events:<sessionId>（list ring）。
 */
import type { RedisLike } from "../storage/drivers/redis.driver.js";
import type { ActionResponse, SuspendedActionInfo } from "./action-hub.js";
import type { HarnessStreamEvent } from "./types.js";

const ACTION_KEY = (actionId: string) => `vuagent:action:${actionId}`;
/** 决策与挂起分键：孤儿路径先落账再清挂起，同键会被 deletePending 误删 */
const DECISION_KEY = (actionId: string) => `vuagent:action-decision:${actionId}`;
const ACTION_SCAN = "vuagent:action:*";
const EVENTS_KEY = (sessionId: string) => `vuagent:events:${sessionId}`;

/** duck-type：客户端具备 list 操作才启用事件缓冲外置（FakeRedis 等替身可缺省） */
function hasListOps(client: RedisLike): boolean {
  return typeof client.rpush === "function" && typeof client.lrange === "function";
}

/* ==========================================================================
   挂起 action 持久化
   ========================================================================== */

export interface ActionPersistStore {
  savePending(info: {
    actionId: string;
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
    /** 评审 #4：发起挂起的副本实例标识（多副本形态孤儿归属判定用；单副本可缺省） */
    instanceId?: string;
    createdAt: number;
    timeoutMs: number;
  }): Promise<void>;
  deletePending(actionId: string): Promise<void>;
  listPending(): Promise<SuspendedActionInfo[]>;
  /** 孤儿决策落账（进程重启后到达的审批）：审计 + 防重复处理 */
  saveDecision(actionId: string, payload: ActionResponse): Promise<void>;
  getDecision(actionId: string): Promise<ActionResponse | undefined>;
}

export function createRedisActionPersist(client: RedisLike): ActionPersistStore {
  return {
    async savePending(info) {
      await client.set(
        ACTION_KEY(info.actionId),
        JSON.stringify({ kind: "pending", ...info }),
        "PX",
        Math.max(info.timeoutMs, 1_000)
      );
    },
    async deletePending(actionId) {
      await client.del(ACTION_KEY(actionId));
    },
    async listPending() {
      const out: SuspendedActionInfo[] = [];
      const keys = await client.keys(ACTION_SCAN);
      for (const key of keys) {
        const raw = await client.get(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as {
            kind?: string;
            actionId: string;
            toolName: string;
            args: Record<string, unknown>;
            sessionId?: string;
            instanceId?: string;
            createdAt: number;
            timeoutMs: number;
          };
          if (parsed.kind !== "pending") continue;
          out.push({
            actionId: parsed.actionId,
            toolName: parsed.toolName,
            args: parsed.args,
            sessionId: parsed.sessionId,
            instanceId: parsed.instanceId,
            createdAt: parsed.createdAt,
            timeoutMs: parsed.timeoutMs,
            expiresAt: parsed.createdAt + parsed.timeoutMs,
          });
        } catch {
          // 损坏条目跳过（fail-open）
        }
      }
      return out;
    },
    async saveDecision(actionId, payload) {
      await client.set(DECISION_KEY(actionId), JSON.stringify({ kind: "decision", payload }), "PX", 24 * 60 * 60 * 1000);
    },
    async getDecision(actionId) {
      const raw = await client.get(DECISION_KEY(actionId));
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw) as { kind?: string; payload?: ActionResponse };
        return parsed.kind === "decision" ? parsed.payload : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/* ==========================================================================
   事件缓冲 ring 外置
   ========================================================================== */

export interface EventLogStore {
  /** 追加一条带 seq 的事件（fire-and-forget；list ops 缺失或故障时静默） */
  append(sessionId: string, event: HarnessStreamEvent & { seq?: number }): Promise<void>;
  /**
   * 读取 seq > fromSeq 的缓冲事件（评审 #5 诚实缺口语义；故障/无 list ops → 空结果）：
   * gap=true 表示无法确认连续（首条返回 seq > fromSeq+1 的 ring 头裁剪、ring 空但
   * fromSeq>0、或 ring 最大 seq 落后于客户端进度），调用方应从 ring 头全量重放并标 full。
   */
  readAfter(
    sessionId: string,
    fromSeq: number
  ): Promise<{ events: Array<HarnessStreamEvent & { seq?: number }>; gap: boolean }>;
}

export function createRedisEventLog(
  client: RedisLike,
  options: { cap?: number; ttlSeconds?: number } = {}
): EventLogStore | null {
  // 客户端无 list 操作（测试替身/受限代理）→ 外置能力不可用，返回 null 由调用方降级
  if (!hasListOps(client)) return null;
  const cap = options.cap ?? 2_000;
  const ttlSeconds = options.ttlSeconds ?? 30 * 60;

  return {
    async append(sessionId, event) {
      try {
        const key = EVENTS_KEY(sessionId);
        await client.rpush!(key, JSON.stringify(event));
        // ring：仅保留最近 cap 条；TTL 防冷会话缓冲常驻
        await client.ltrim!(key, -cap, -1);
        await client.expire(key, ttlSeconds);
      } catch {
        // fail-open：缓冲外置失败不影响实时流
      }
    },
    async readAfter(sessionId, fromSeq) {
      try {
        const raws = await client.lrange!(EVENTS_KEY(sessionId), 0, -1);
        const out: Array<HarnessStreamEvent & { seq?: number }> = [];
        const allSeqs: number[] = [];
        for (const raw of raws) {
          try {
            const parsed = JSON.parse(raw) as HarnessStreamEvent & { seq?: number };
            allSeqs.push(parsed.seq ?? 0);
            if ((parsed.seq ?? 0) > fromSeq) out.push(parsed);
          } catch {
            // 损坏条目跳过
          }
        }
        // 评审 #5：缺口诚实标注——
        // ① 有可补事件：首条返回 seq > fromSeq+1 → 中间事件已被 ring 头裁剪，不连续；
        // ② 无可补事件且 fromSeq>0：ring 空，或 ring 最大 seq 落后于客户端进度
        //    （客户端 seq 空间换代）→ 同样无法确认连续；
        // ③ 追平（fromSeq === ring 最大 seq）与全新会话（fromSeq=0）不算缺口。
        let gap = false;
        if (out.length > 0) {
          gap = (out[0].seq ?? 0) > fromSeq + 1;
        } else if (fromSeq > 0) {
          gap = allSeqs.length === 0 || Math.max(...allSeqs) < fromSeq;
        }
        return { events: out, gap };
      } catch {
        // fail-open：读取故障时同样诚实标注缺口（无法确认连续）
        return { events: [], gap: fromSeq > 0 };
      }
    },
  };
}
