import type { UIActionEnvelope } from "@vuagent/protocol";

export interface ActionResponse {
  approved: boolean;
  reason?: "manual" | "timeout" | "aborted";
  note?: string;
  /**
   * @deprecated TASK-089：已由通用交互信封 envelope 取代（预留后始终无消费方，
   * 属安全退役——墓碑字段保留一个兼容周期，新代码请读写 envelope）。
   */
  formData?: Record<string, unknown>;
  /**
   * TASK-089（契约 TASK-B）：路由边界 parseUIActionPayload 产出的规范化交互信封——
   * 执行器据此生成「语义摘要 + JSON 附录」双层工具结果；旧客户端回传经兼容映射后同样挂载。
   */
  envelope?: UIActionEnvelope;
  [key: string]: unknown;
}

/**
 * 挂起持久化仓储（TASK-100，可选）：Redis 形态下挂起/决策外置，
 * 进程重启后挂起列表可见、决策可落账；SQLite 单机形态不注入（零改动）。
 */
export interface ActionPersistStore {
  savePending(info: {
    actionId: string;
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
    /** 评审 #4：发起挂起的副本实例标识（多副本孤儿归属判定；JSON 序列化自动携带） */
    instanceId?: string;
    createdAt: number;
    timeoutMs: number;
  }): Promise<void>;
  deletePending(actionId: string): Promise<void>;
  listPending(): Promise<SuspendedActionInfo[]>;
  saveDecision(actionId: string, payload: ActionResponse): Promise<void>;
  getDecision(actionId: string): Promise<ActionResponse | undefined>;
}

interface PendingResolver {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 发起挂起的会话（TASK-005：审批回写按此索引直达，免全库扫描） */
  sessionId?: string;
  /** 发起挂起的副本实例（评审 #4：多副本孤儿归属判定数据源） */
  instanceId?: string;
  createdAt: number;
  timeoutMs: number;
  timer: NodeJS.Timeout;
  resolve: (value: ActionResponse) => void;
  reject: (reason?: unknown) => void;
}

export interface SuspendedActionInfo {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 发起挂起的会话（跨会话审批收件箱跳转用） */
  sessionId?: string;
  /** 发起挂起的副本实例（评审 #4：外置挂起列表据此区分归属副本） */
  instanceId?: string;
  createdAt: number;
  timeoutMs: number;
  expiresAt: number;
}

/**
 * HITL 人机协同挂起与唤醒管理器 (ActionHub)
 * 管理需要外部审批、确认或表单输入的异步挂起协程
 */
export class ActionHub {
  private pendingMap = new Map<string, PendingResolver>();

  constructor(private persist?: ActionPersistStore) {}

  /**
   * 挂起终结钩子（L3 patch 暂存清理挂载点，Phase 3）：任一终结路径
   * （送达 resolveAction / abortAction / 超时裁决 / reject）按 actionId 回调。
   * 超时裁决发生在 timer 回调内、无 HTTP 请求上下文——路由层无法在该路径
   * 显式清理 PatchStash，必须经此钩子；未挂载时（单机缺省/测试）由
   * PatchStash 容量逐出惰性兜底（见 core/patch-stash.ts 头注释）。
   */
  onPendingSettled?: (actionId: string) => void;

  /** 挂起终结统一出口：钩子回调（fail-open，回调异常不影响终结本身） */
  private settle(actionId: string): void {
    try {
      this.onPendingSettled?.(actionId);
    } catch {
      // 清理钩子失败不阻断挂起终结
    }
  }

  /** 挂起持久化写入（fire-and-forget fail-open；写入失败不影响挂起本身） */
  private persistPending(info: {
    actionId: string;
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
    instanceId?: string;
    createdAt: number;
    timeoutMs: number;
  }): void {
    this.persist?.savePending(info).catch(() => {});
  }

  /** 挂起持久化清理（resolve/abort/timeout 三路径统一走这里） */
  private persistDelete(actionId: string): void {
    this.persist?.deletePending(actionId).catch(() => {});
  }

  /**
   * 进程重启后的孤儿挂起：决策不可唤醒协程（协程已随进程消失），
   * 但决策本身可以落账——路由层据 saveDecision/getDecision 实现诚实语义
   * （delivered:false + 审批卡回写）。对外只暴露存储查询。
   */
  getPendingStore(): ActionPersistStore | undefined {
    return this.persist;
  }

  /**
   * 挂起当前执行协程，等待外部 HTTP 回调唤醒或超时
   */
  waitForAction(
    actionId: string,
    metadata: {
      toolName: string;
      args: Record<string, unknown>;
      timeoutMs?: number;
      sessionId?: string;
      /** 评审 #4：发起挂起的副本实例标识（路由侧由 server 构造时传入，直达 savePending） */
      instanceId?: string;
    }
  ): Promise<ActionResponse> {
    const timeoutMs = metadata.timeoutMs ?? 180_000; // 默认 3 分钟超时

    return new Promise<ActionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMap.delete(actionId);
        this.persistDelete(actionId);
        this.settle(actionId);
        resolve({
          approved: false,
          reason: "timeout",
          note: `Action timed out after ${timeoutMs}ms without human decision`,
        });
      }, timeoutMs);

      this.pendingMap.set(actionId, {
        actionId,
        toolName: metadata.toolName,
        args: metadata.args,
        sessionId: metadata.sessionId,
        instanceId: metadata.instanceId,
        createdAt: Date.now(),
        timeoutMs,
        timer,
        resolve: (val) => {
          clearTimeout(timer);
          this.pendingMap.delete(actionId);
          this.persistDelete(actionId);
          this.settle(actionId);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingMap.delete(actionId);
          this.persistDelete(actionId);
          this.settle(actionId);
          reject(err);
        },
      });

      // TASK-100：外置挂起（Redis 形态）——重启后列表可见 + 决策可落账
      this.persistPending({
        actionId,
        toolName: metadata.toolName,
        args: metadata.args,
        sessionId: metadata.sessionId,
        instanceId: metadata.instanceId,
        createdAt: Date.now(),
        timeoutMs,
      });
    });
  }

  /**
   * 查询挂起项所属会话（actionId → sessionId 索引，用于审批回写直达）
   */
  getSessionIdForAction(actionId: string): string | undefined {
    return this.pendingMap.get(actionId)?.sessionId;
  }

  /**
   * 评审 #4：内存挂起存在性查询（同步、零副作用）。
   * 路由侧孤儿判定先查本方法再查外置 store 的 instanceId——消除「resolve 后
   * pending 删除尚未落盘、内存 map 已清」窗口内的误判（#7 竞态）。
   */
  hasPending(actionId: string): boolean {
    return this.pendingMap.has(actionId);
  }

  /**
   * 评审 #8：外置决策查询（只读幂等）——重复消费同一 actionId 返回同一已落账决策，
   * 不删除、不变更；路由侧据此把重复 POST 映射为幂等成功（delivered:false）而非 404。
   */
  getDecision(actionId: string): Promise<ActionResponse | undefined> {
    return this.persist?.getDecision(actionId) ?? Promise.resolve(undefined);
  }

  /**
   * 外部提交交互决策，唤醒挂起的 Agent 链路
   */
  resolveAction(actionId: string, payload: ActionResponse): boolean {
    const entry = this.pendingMap.get(actionId);
    if (!entry) return false;
    entry.resolve(payload);
    this.persistDelete(actionId);
    return true;
  }

  /**
   * 中断指定的挂起项
   */
  abortAction(actionId: string, reason: string): boolean {
    const entry = this.pendingMap.get(actionId);
    if (!entry) return false;
    entry.resolve({
      approved: false,
      reason: "aborted",
      note: reason,
    });
    this.persistDelete(actionId);
    return true;
  }

  /**
   * 获取指定挂起项的元数据
   */
  getSuspended(actionId: string): SuspendedActionInfo | undefined {
    const entry = this.pendingMap.get(actionId);
    if (!entry) return undefined;
    return {
      actionId: entry.actionId,
      toolName: entry.toolName,
      args: entry.args,
      sessionId: entry.sessionId,
      instanceId: entry.instanceId,
      createdAt: entry.createdAt,
      timeoutMs: entry.timeoutMs,
      expiresAt: entry.createdAt + entry.timeoutMs,
    };
  }

  /**
   * 列举当前所有挂起等待的动作
   */
  listSuspended(): SuspendedActionInfo[] {
    return Array.from(this.pendingMap.values()).map((entry) => ({
      actionId: entry.actionId,
      toolName: entry.toolName,
      args: entry.args,
      sessionId: entry.sessionId,
      instanceId: entry.instanceId,
      createdAt: entry.createdAt,
      timeoutMs: entry.timeoutMs,
      expiresAt: entry.createdAt + entry.timeoutMs,
    }));
  }

  /**
   * 清理所有挂起项
   */
  clear() {
    for (const entry of this.pendingMap.values()) {
      clearTimeout(entry.timer);
    }
    this.pendingMap.clear();
  }
}
