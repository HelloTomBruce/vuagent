/**
 * VaApprovalCard 安全语义测试（TASK-013）
 * - 键盘行为：默认 Enter=拒绝（Esc 恒拒绝），仅 approveShortcut=true 时 Enter=批准
 * - 倒计时：暂停/超时自动拒绝语义不变
 * - a11y：role=alertdialog + aria-modal + aria-label
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "@vue/server-renderer";
import { h } from "vue";
import { VaApprovalCard } from "../src/components/approval-card/index";
import { useApprovalCard } from "../src/components/approval-card/useApprovalCard";
import type { ApprovalCardProps } from "../src/components/approval-card/types";

// composable 直测脱离组件实例，onBeforeUnmount 会告警；属预期噪音，压掉
beforeAll(() => {
  const raw = console.warn;
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("onBeforeUnmount is called when there is no active component")) return;
    raw(...args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

function setup(props: Partial<ApprovalCardProps> = {}) {
  const events: Array<{ type: "approve" | "deny"; reason?: string }> = [];
  const api = useApprovalCard({ title: "危险操作", ...props } as ApprovalCardProps, {
    approve: () => events.push({ type: "approve" }),
    deny: (reason) => events.push({ type: "deny", reason }),
  });
  return { api, events };
}

const keyEvent = (key: string, target: unknown = null) =>
  ({ key, target, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

describe("VaApprovalCard - 键盘安全语义", () => {
  it("默认 Enter 触发拒绝（不是批准）", () => {
    const { api, events } = setup();
    api.onKeydown(keyEvent("Enter"));
    expect(events).toEqual([{ type: "deny", reason: "manual" }]);
    expect(api.result.value).toBe("denied");
  });

  it("默认 Esc 触发拒绝", () => {
    const { api, events } = setup();
    api.onKeydown(keyEvent("Escape"));
    expect(events).toEqual([{ type: "deny", reason: "manual" }]);
  });

  it("approveShortcut=true 时 Enter 才触发批准", () => {
    const { api, events } = setup({ approveShortcut: true });
    api.onKeydown(keyEvent("Enter"));
    expect(events).toEqual([{ type: "approve" }]);
    expect(api.result.value).toBe("approved");
  });

  it("approveShortcut=true 时 Esc 仍为拒绝", () => {
    const { api, events } = setup({ approveShortcut: true });
    api.onKeydown(keyEvent("Escape"));
    expect(events).toEqual([{ type: "deny", reason: "manual" }]);
  });

  it("Enter 落在按钮上时不走快捷键（交给按钮自身 click）", () => {
    const { api, events } = setup();
    const target = { closest: (sel: string) => (sel === "button" ? {} : null) };
    api.onKeydown(keyEvent("Enter", target));
    expect(events).toEqual([]);
  });

  it("已决策后快捷键不再生效", () => {
    const { api, events } = setup({ status: "approved" });
    api.onKeydown(keyEvent("Enter"));
    api.onKeydown(keyEvent("Escape"));
    expect(events).toEqual([]);
  });

  it("决策只生效一次（重复按键不重复 emit）", () => {
    const { api, events } = setup();
    api.onKeydown(keyEvent("Enter"));
    api.onKeydown(keyEvent("Enter"));
    expect(events.length).toBe(1);
  });
});

describe("VaApprovalCard - 倒计时语义（暂停/超时拒绝不变）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // node 环境无 window，为 useCountdown 提供最小计时器桩（转发到已被 fake 的全局计时器）
    vi.stubGlobal("window", {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("倒计时到 0 自动拒绝（timeout）", () => {
    const { api, events } = setup({ countdown: 1 });
    expect(api.remaining.value).toBe(1);
    vi.advanceTimersByTime(1100);
    expect(events).toEqual([{ type: "deny", reason: "timeout" }]);
    expect(api.denyReason.value).toBe("timeout");
  });

  it("paused=true 冻结倒计时，恢复后继续并在超时后拒绝", () => {
    const { api, events } = setup({ countdown: 1 });
    api.paused.value = true;
    vi.advanceTimersByTime(3000);
    expect(events).toEqual([]);
    expect(api.remaining.value).toBeGreaterThan(0);

    api.paused.value = false;
    vi.advanceTimersByTime(1100);
    expect(events).toEqual([{ type: "deny", reason: "timeout" }]);
  });

  it("已决策卡片不启动倒计时", () => {
    const { events } = setup({ countdown: 1, status: "approved" });
    vi.advanceTimersByTime(5000);
    expect(events).toEqual([]);
  });
});

describe("VaApprovalCard - SSR a11y 语义", () => {
  it("具备 alertdialog + aria-modal + aria-label，初始可聚焦", async () => {
    const html = await renderToString(h(VaApprovalCard, { title: "删除生产数据库" }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="删除生产数据库"');
    expect(html).toContain('tabindex="-1"');
  });

  it("默认快捷键提示为 Enter/Esc 均拒绝（不暗示 Enter 批准）", async () => {
    const html = await renderToString(h(VaApprovalCard, { title: "t" }));
    expect(html).toContain("Enter / Esc");
    expect(html).not.toContain("批准 ·");
  });

  it("approveShortcut=true 时提示 Enter 批准 · Esc 拒绝", async () => {
    const html = await renderToString(h(VaApprovalCard, { title: "t", approveShortcut: true }));
    expect(html).toContain("Enter");
    expect(html).toContain("批准");
    expect(html).toContain("Esc");
  });

  it("detail 存在时通过 aria-describedby 关联说明文本", async () => {
    const html = await renderToString(h(VaApprovalCard, { title: "t", detail: "将影响 3 张表" }));
    expect(html).toContain("aria-describedby");
    expect(html).toContain("将影响 3 张表");
  });
});
