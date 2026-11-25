/**
 * 流式文本 rAF 合帧缓冲（TASK-104 引入于 useAgentChat，TASK-114 抽离为共享件）：
 * delta 只进缓冲，每帧一次 commit——markdown 重解析随 commit 同帧节流
 * （同帧多次 delta 只触发一次重渲染）。
 *
 * 职责边界：本件只负责「累积 + 帧调度 + flush/drop 纪律」；
 * 提交目标（写哪块文本）由调用方的 commit 回调决定——
 * 块寻址、响应式代理、跨块防御都是调用方状态机的职责。
 *
 * @example 基本用法
 * ```ts
 * const buffer = createDeltaBuffer({
 *   commit: (text) => { targetBlock.content += text; },
 * });
 * buffer.push(delta);          // 累积并调度一帧
 * buffer.flush();              // 流结束/错误/块边界切换：同步提交（幂等）
 * buffer.drop();               // 消息整体换血：丢弃不提交
 * ```
 *
 * @example 自定义帧调度器（worker / 节流 / 测试手动跑帧）
 * ```ts
 * const buffer = createDeltaBuffer({
 *   commit,
 *   scheduler: {
 *     schedule: (cb) => setTimeout(cb, 16),   // 返回句柄
 *     cancel: (handle) => clearTimeout(handle as number),
 *   },
 * });
 * ```
 *
 * 降级：注入缺省调度器且环境无 rAF 时（Node SSR / 未注入 rAF 的测试环境）
 * push 直接同步 commit——每 delta 即时可见，与合帧前的对外行为契约一致。
 * 陈旧帧防御：flush 后迟到的帧回调不再二次提交。
 */

/**
 * 帧调度器抽象（扩展点）：缺省 rAF；测试手动跑帧 / worker / 自定义节流可注入。
 * **契约：schedule 应异步调度 callback（不得同步调用）**——缓冲的陈旧帧防御
 * 依赖「schedule 返回句柄 → 句柄赋值 → 帧回调」的时序；同步调用回调会破坏
 * 防御语义。同步提交诉求走「无 rAF 缺省调度器」的自动降级路径。
 */
export interface DeltaBufferScheduler {
  /** 调度一帧，返回句柄（供 cancel 使用） */
  schedule(callback: () => void): unknown;
  /** 取消一帧（handle 为 schedule 的返回值） */
  cancel(handle: unknown): void;
}

export interface DeltaBufferOptions {
  /** 提交回调：缓冲 flush 时以累积文本调用（幂等：空缓冲不调用） */
  commit: (accumulated: string) => void;
  /** 帧调度器；缺省 rAF（无 rAF 环境同步降级） */
  scheduler?: DeltaBufferScheduler;
}

export interface DeltaBuffer {
  /** 累积一条 delta 并调度帧提交 */
  push(delta: string): void;
  /** 即时提交缓冲（幂等：空缓冲时 commit 不被调用） */
  flush(): void;
  /** 丢弃缓冲（不 commit） */
  drop(): void;
  /** 是否有未提交的累积文本（测试/防御断言用） */
  readonly pendingText: string;
}

/** 缺省调度器：rAF；无 rAF 环境同步降级（schedule 即执行，句柄 null） */
const defaultScheduler: DeltaBufferScheduler = {
  schedule(callback) {
    if (typeof requestAnimationFrame === "function") {
      return requestAnimationFrame(callback);
    }
    callback();
    return null;
  },
  cancel(handle) {
    if (typeof handle === "number" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
    }
  },
};

export function createDeltaBuffer(options: DeltaBufferOptions): DeltaBuffer {
  const scheduler = options.scheduler ?? defaultScheduler;
  let accumulated = "";
  let frameId: unknown = null;

  const commitNow = () => {
    frameId = null;
    const text = accumulated;
    accumulated = "";
    if (text) options.commit(text);
  };

  return {
    push(delta: string) {
      accumulated += delta;
      if (frameId !== null) return;
      // 同步降级（缺省调度器 + 无 rAF 环境）：无异步窗口，直接提交
      if (scheduler === defaultScheduler && typeof requestAnimationFrame !== "function") {
        commitNow();
        return;
      }
      // 异步调度路径：陈旧帧防御（flush/drop 取消后迟到的帧回调不再二次提交）
      const id = scheduler.schedule(() => {
        if (frameId !== id) return;
        commitNow();
      });
      frameId = id;
    },

    flush() {
      if (frameId !== null) {
        scheduler.cancel(frameId);
        frameId = null;
      }
      commitNow();
    },

    drop() {
      if (frameId !== null) {
        scheduler.cancel(frameId);
        frameId = null;
      }
      accumulated = "";
    },

    get pendingText() {
      return accumulated;
    },
  };
}
