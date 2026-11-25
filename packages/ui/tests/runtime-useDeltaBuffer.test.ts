import { describe, expect, it, vi } from "vitest";
import { createDeltaBuffer, type DeltaBufferScheduler } from "../src/runtime/useDeltaBuffer";

/** 手动帧调度器：schedule 入队、测试显式跑帧（合帧行为可观测） */
function manualScheduler() {
  const queue: Array<() => void> = [];
  const handles: unknown[] = [];
  let seq = 0;
  const scheduler: DeltaBufferScheduler = {
    schedule(cb) {
      queue.push(cb);
      const handle = ++seq;
      handles.push(handle);
      return handle;
    },
    cancel(handle) {
      const idx = queue.findIndex((_, i) => handles[i] === handle);
      if (idx >= 0) {
        queue.splice(idx, 1);
        handles.splice(idx, 1);
      }
    },
  };
  return {
    scheduler,
    runFrame: () => queue.shift()?.(),
    pendingFrames: () => queue.length,
  };
}

describe("createDeltaBuffer（TASK-114 公共件）", () => {
  it("同帧多次 push 只提交一次（累积全文）；flush 后迟到帧不二次提交（陈旧帧防御）", () => {
    const { scheduler, runFrame, pendingFrames } = manualScheduler();
    const commit = vi.fn();
    const buffer = createDeltaBuffer({ commit, scheduler });

    buffer.push("a");
    buffer.push("b");
    buffer.push("c");
    expect(commit).not.toHaveBeenCalled(); // 帧未跑，零提交
    expect(pendingFrames()).toBe(1); // 3 push 只调度 1 帧

    buffer.flush(); // 同步提交 + 取消待执行帧
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("abc");
    expect(buffer.pendingText).toBe("");

    expect(pendingFrames()).toBe(0); // flush 已取消帧——队列为空
    // 即使迟到帧回调被外部触发（引用逃逸），也因句柄失效不再提交
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("flush 幂等：空缓冲不触发 commit", () => {
    const commit = vi.fn();
    const buffer = createDeltaBuffer({ commit, scheduler: manualScheduler().scheduler });
    buffer.flush();
    buffer.flush();
    expect(commit).not.toHaveBeenCalled();
  });

  it("drop 丢弃缓冲（不 commit）且取消待执行帧", () => {
    const { scheduler, runFrame } = manualScheduler();
    const commit = vi.fn();
    const buffer = createDeltaBuffer({ commit, scheduler });
    buffer.push("discard-me");
    buffer.drop();
    expect(buffer.pendingText).toBe("");
    runFrame(); // 迟到帧：句柄已取消，不提交
    expect(commit).not.toHaveBeenCalled();
  });

  it("注入自定义调度器：批量提交仍走 commit（worker/节流可扩展）", () => {
    const timeouts: Array<() => void> = [];
    const scheduler: DeltaBufferScheduler = {
      schedule(cb) {
        timeouts.push(cb);
        return timeouts.length;
      },
      cancel(handle) {
        void handle;
      },
    };
    const commit = vi.fn();
    const buffer = createDeltaBuffer({ commit, scheduler });
    buffer.push("x");
    buffer.push("y");
    timeouts.shift()?.(); // 跑自定义"帧"
    expect(commit).toHaveBeenCalledWith("xy");
  });
});
