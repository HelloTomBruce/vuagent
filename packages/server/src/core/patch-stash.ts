/**
 * L3 patch 暂存（Phase 3，设计文档 §3「patch 语义」/ §8「patch 风暴防护」）：
 *
 * 协作组件（interaction.level === "L3"）的增量编辑信封（kind:"patch"）**不唤醒
 * 挂起协程、不进模型上下文、不落账决策**——只在此处按 actionId 服务端暂存，
 * 直到显式 submit/cancel（或超时）终结交互时才以合并值进入摘要与落账信封。
 * 这是 patch 风暴防线的核心：任意多次 patch 只改变这里的一份内存值，
 * 模型只在终态被唤醒一次。
 *
 * 生命周期（与 handleResolveAction / ActionHub 的协作约定）：
 * - merge：路由 patch 分支（L3 + 仍挂起）写入，后到覆盖同键（shallow 合并）；
 * - delete：终态清理，三处主动挂载：
 *   ① ActionHub 终态钩子（onPendingSettled：送达 resolveAction / 超时裁决 /
 *      abort 任一路径触发——超时裁决在 timer 回调内，无 HTTP 请求上下文，
 *      只有此钩子可达）；
 *   ② 路由孤儿落账路径（saveDecision 后显式清理）；
 *   ③ 幂等重放（prior 命中）路径无需清理——终态时已清；
 *   若上述挂载点之外仍遗留（如 !ok 且非孤儿的 404 路径），容量上限惰性逐出兜底：
 *   超过 capacity 时按 updatedAt 最旧者逐出，暂存永不无界增长。
 *
 * 单机内存形态（与 ActionHub 内存挂起同语义，重启即失效）：patch 增量本就
 * 只在挂起窗口内有意义，挂起随重启消失后暂存值不再是任何协程的合并输入。
 */

export interface PatchStashEntry {
  /** 已合并的增量值集合（shallow：后到覆盖同键，不动其他键） */
  values: Record<string, unknown>;
  /** 最近一次 merge 时间戳（观察用；逐出次序由内部单调序号保证确定性） */
  updatedAt: number;
}

/** 缺省容量上限（条目数，按 actionId 计）：防 patch 面无界增长 */
export const PATCH_STASH_CAPACITY = 500;

export class PatchStash {
  private readonly map = new Map<string, PatchStashEntry>();
  private readonly capacity: number;
  /** 单调递增序号：同毫秒 merge 的逐出次序也确定（merge 即刷新 = 最新） */
  private seq = 0;
  private readonly order = new Map<string, number>();

  constructor(capacity: number = PATCH_STASH_CAPACITY) {
    this.capacity = capacity;
  }

  /**
   * shallow 按键合并（后到覆盖同键，未出现的键保持原值）。
   * 返回本次 patch 携带的键集合（patchKeys，路由 200 响应回显给前端）。
   */
  merge(actionId: string, values: Record<string, unknown>): string[] {
    const patchKeys = Object.keys(values);
    const existing = this.map.get(actionId);
    this.map.set(actionId, {
      values: { ...(existing?.values ?? {}), ...values },
      updatedAt: Date.now(),
    });
    this.order.set(actionId, ++this.seq);
    this.evictOverflow();
    return patchKeys;
  }

  /** 读取暂存（submit 合并时消费；无暂存返回 undefined） */
  get(actionId: string): PatchStashEntry | undefined {
    return this.map.get(actionId);
  }

  /** 终态清理（submit/cancel/超时/孤儿落账后调用；不存在时为无害 no-op） */
  delete(actionId: string): boolean {
    this.order.delete(actionId);
    return this.map.delete(actionId);
  }

  /** 当前暂存条目数（测试与运维观察用） */
  get size(): number {
    return this.map.size;
  }

  /**
   * 容量逐出：超限时按 merge 次序最旧者逐出（单调序号，同毫秒 merge 次序
   * 同样确定），直到回到上限内。惰性兜底——正常路径终态即清，仅异常遗留
   * （无钩子可达的 404 路径等）依赖此处保证内存有界（§8「patch 风暴」容量防线）。
   */
  private evictOverflow(): void {
    while (this.map.size > this.capacity) {
      let oldestId: string | undefined;
      let oldestSeq = Number.POSITIVE_INFINITY;
      for (const [id, ord] of this.order) {
        if (ord < oldestSeq) {
          oldestSeq = ord;
          oldestId = id;
        }
      }
      if (oldestId === undefined) break;
      this.delete(oldestId);
    }
  }
}
