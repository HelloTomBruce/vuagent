/**
 * Phase 3（L3 patch 运行时）：PatchStash 单元测试。
 *
 * 覆盖：shallow 按键合并（后到覆盖同键）、get/delete、容量上限逐出
 * （超限按 updatedAt 最旧者逐出）、ActionHub 终态钩子（onPendingSettled）
 * 在 resolve / 超时裁决路径的清理触发。
 */
import { describe, it, expect } from "vitest";
import { PatchStash, PATCH_STASH_CAPACITY } from "../src/core/patch-stash.js";
import { ActionHub } from "../src/core/action-hub.js";

describe("PatchStash 合并与查询", () => {
  it("merge：shallow 按键合并，后到覆盖同键、不动其他键，返回 patchKeys", () => {
    const stash = new PatchStash();
    const keys1 = stash.merge("a1", { steps: [{ id: "s1" }], note: "x" });
    expect(keys1).toEqual(["steps", "note"]);

    const keys2 = stash.merge("a1", { note: "y", retryStepId: "s2" });
    expect(keys2).toEqual(["note", "retryStepId"]);

    const entry = stash.get("a1");
    expect(entry).toBeDefined();
    // steps 保持第一次的值（未出现在第二次 patch 中）
    expect(entry!.values.steps).toEqual([{ id: "s1" }]);
    // note 被第二次覆盖
    expect(entry!.values.note).toBe("y");
    expect(entry!.values.retryStepId).toBe("s2");
  });

  it("merge：不同 actionId 相互隔离", () => {
    const stash = new PatchStash();
    stash.merge("a", { k: "a" });
    stash.merge("b", { k: "b" });
    expect(stash.get("a")!.values.k).toBe("a");
    expect(stash.get("b")!.values.k).toBe("b");
  });

  it("get：无暂存返回 undefined；delete：终态清理且不存在时无害", () => {
    const stash = new PatchStash();
    expect(stash.get("nope")).toBeUndefined();
    expect(stash.delete("nope")).toBe(false);
    stash.merge("a", { k: 1 });
    expect(stash.delete("a")).toBe(true);
    expect(stash.get("a")).toBeUndefined();
    expect(stash.size).toBe(0);
  });
});

describe("PatchStash 容量逐出", () => {
  it("缺省容量常量为 500；超限按 updatedAt 最旧者逐出，永不超容量", () => {
    expect(PATCH_STASH_CAPACITY).toBe(500);
    const stash = new PatchStash();
    // 逐个写入 501 个 actionId：第 1 个（最旧）被逐出
    for (let i = 0; i <= PATCH_STASH_CAPACITY; i++) {
      stash.merge(`action-${i}`, { seq: i });
    }
    expect(stash.size).toBe(PATCH_STASH_CAPACITY);
    expect(stash.get("action-0")).toBeUndefined(); // 最旧者被逐出
    expect(stash.get(`action-${PATCH_STASH_CAPACITY}`)).toBeDefined();

    // 对最早存入、但刚 merge 过的条目不逐出（updatedAt 刷新）：
    const stash2 = new PatchStash(3);
    stash2.merge("a", {});
    stash2.merge("b", {});
    stash2.merge("c", {});
    stash2.merge("a", { refreshed: true }); // a 刷新为最新
    stash2.merge("d", {}); // 超限：逐出 updatedAt 最旧的 b
    expect(stash2.size).toBe(3);
    expect(stash2.get("b")).toBeUndefined();
    expect(stash2.get("a")!.values.refreshed).toBe(true);
    expect(stash2.get("d")).toBeDefined();
  });
});

describe("ActionHub 终态钩子（onPendingSettled → PatchStash 清理）", () => {
  it("resolveAction（送达路径）触发清理", async () => {
    const hub = new ActionHub();
    const deleted: string[] = [];
    hub.onPendingSettled = (id) => deleted.push(id);
    const promise = hub.waitForAction("act-x", {
      toolName: "ui_agent_plan",
      args: {},
      timeoutMs: 5_000,
    });
    expect(hub.resolveAction("act-x", { approved: true })).toBe(true);
    await promise;
    expect(deleted).toEqual(["act-x"]);
  });

  it("超时裁决路径触发清理（timer 回调内，无 HTTP 上下文）", async () => {
    const hub = new ActionHub();
    const deleted: string[] = [];
    hub.onPendingSettled = (id) => deleted.push(id);
    const promise = hub.waitForAction("act-t", {
      toolName: "ui_agent_plan",
      args: {},
      timeoutMs: 20,
    });
    const result = await promise;
    expect(result.reason).toBe("timeout");
    expect(deleted).toEqual(["act-t"]);
  });

  it("abortAction 路径同样触发；钩子抛错不影响终结（fail-open）", async () => {
    const hub = new ActionHub();
    const deleted: string[] = [];
    hub.onPendingSettled = (id) => {
      deleted.push(id);
      throw new Error("清理钩子故意失败");
    };
    const promise = hub.waitForAction("act-a", {
      toolName: "ui_form",
      args: {},
      timeoutMs: 5_000,
    });
    expect(hub.abortAction("act-a", "会话中断")).toBe(true);
    const result = await promise;
    expect(result.reason).toBe("aborted");
    expect(deleted).toEqual(["act-a"]);
  });
});
