/**
 * useTextPrompt（askText 命令式文本输入）单元测试
 * 覆盖：无宿主 fail-closed、正常确认/取消、空输入视作取消、重入结算前一个 Promise、
 * initialValue/placeholder 回填、宿主注销后 fail-closed。
 * 注意：store 是模块级单例，用例间通过 hostCount 与 pendingResolve 隔离
 * （afterEach 里不 unstub，靠 register/unregister 配对清零）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askText,
  cancelTextPrompt,
  registerTextPromptHost,
  submitTextPrompt,
  useTextPromptState,
} from "../composables/useTextPrompt";

afterEach(() => {
  // 兜底：关闭残留弹窗并注销宿主，保证用例间 hostCount 归零
  cancelTextPrompt();
});

describe("useTextPrompt", () => {
  it("无宿主时 fail-closed：resolve(null) + 开发期警告（只报一次）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await askText({ title: "t" });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("确认：submitTextPrompt 以当前输入 resolve", async () => {
    const unregister = registerTextPromptHost();
    const promise = askText({ title: "输入路径", initialValue: "/tmp" });
    const state = useTextPromptState();
    expect(state.open).toBe(true);
    expect(state.value).toBe("/tmp");
    expect(state.placeholder).toBe("");

    state.value = " /Users/me/project ";
    submitTextPrompt();
    await expect(promise).resolves.toBe("/Users/me/project"); // trim
    expect(state.open).toBe(false);
    unregister();
  });

  it("取消（cancelTextPrompt）resolve null；空输入确认同样 resolve null", async () => {
    const unregister = registerTextPromptHost();

    const p1 = askText({ title: "a" });
    cancelTextPrompt();
    await expect(p1).resolves.toBeNull();

    const p2 = askText({ title: "b", placeholder: "占位" });
    expect(useTextPromptState().placeholder).toBe("占位");
    useTextPromptState().value = "   ";
    submitTextPrompt();
    await expect(p2).resolves.toBeNull();

    unregister();
  });

  it("重入 askText：前一个 Promise 以 null 结算，不悬空", async () => {
    const unregister = registerTextPromptHost();
    const first = askText({ title: "first" });
    const second = askText({ title: "second" });
    await expect(first).resolves.toBeNull(); // 被重入顶掉 → 取消结算
    useTextPromptState().value = "answer";
    submitTextPrompt();
    await expect(second).resolves.toBe("answer");
    unregister();
  });

  it("settle 后重复 submit/cancel 幂等（不再 resolve 第二次）", async () => {
    const unregister = registerTextPromptHost();
    const promise = askText({ title: "once" });
    submitTextPrompt();
    useTextPromptState().value = "later";
    submitTextPrompt(); // 已关闭：no-op
    cancelTextPrompt(); // 已关闭：no-op
    await expect(promise).resolves.toBeNull();
    unregister();
  });

  it("宿主注销后再调用回到 fail-closed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unregister = registerTextPromptHost();
    unregister();
    // warnedNoHost 单例标志在上一个用例已置位并因同模块复用保持 true，
    // 这里只断言 fail-closed 行为本身（警告不重复）。
    await expect(askText({ title: "t" })).resolves.toBeNull();
    expect(warn).not.toHaveBeenCalled(); // 首次警告已消费，不重复
    warn.mockRestore();
  });
});
