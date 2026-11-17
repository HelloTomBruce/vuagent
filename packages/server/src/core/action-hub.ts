export interface ActionResponse {
  approved: boolean;
  reason?: "manual" | "timeout" | "aborted";
  note?: string;
  formData?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PendingResolver {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** 发起挂起的会话（TASK-005：审批回写按此索引直达，免全库扫描） */
  sessionId?: string;
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
    }
  ): Promise<ActionResponse> {
    const timeoutMs = metadata.timeoutMs ?? 180_000; // 默认 3 分钟超时

    return new Promise<ActionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMap.delete(actionId);
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
        createdAt: Date.now(),
        timeoutMs,
        timer,
        resolve: (val) => {
          clearTimeout(timer);
          this.pendingMap.delete(actionId);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingMap.delete(actionId);
          reject(err);
        },
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
   * 外部提交交互决策，唤醒挂起的 Agent 链路
   */
  resolveAction(actionId: string, payload: ActionResponse): boolean {
    const entry = this.pendingMap.get(actionId);
    if (!entry) return false;
    entry.resolve(payload);
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
