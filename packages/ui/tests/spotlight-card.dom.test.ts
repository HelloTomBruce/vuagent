// @vitest-environment happy-dom
/**
 * VaSpotlightCard dom 测试（TASK-109）：
 * 修饰类推导（glow/spot/elevation 分支 + elevation 钳制）、
 * pointer 光斑桥接（enter 立即写 --va-spot-x/y；spot:false 短路）、
 * 双降级与静态发光保留的 CSS 静态断言。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import VaSpotlightCard from "../src/components/spotlight-card/VaSpotlightCard.vue";
import { clampElevation, useSpotlightCard } from "../src/components/spotlight-card/useSpotlightCard";

// happy-dom 环境的全局 URL 实现会劫持 new URL 相对解析（fs 拒绝非 file 协议），
// 统一走 fileURLToPath + path.resolve（对齐 agent-renderer.dom.test.ts 口径）
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(here, "../src/components/spotlight-card/VaSpotlightCard.css"), "utf8");

describe("clampElevation（纯逻辑）", () => {
  it("缺省/合法值/小数四舍五入", () => {
    expect(clampElevation(undefined)).toBe(4);
    expect(clampElevation(2)).toBe(2);
    expect(clampElevation(2.6)).toBe(3); // 四舍五入
  });

  it("越界钳制到 1-4，NaN 回舞台档", () => {
    expect(clampElevation(0)).toBe(1);
    expect(clampElevation(-3)).toBe(1);
    expect(clampElevation(9)).toBe(4);
    expect(clampElevation(Number.NaN)).toBe(4);
  });
});

describe("useSpotlightCard（组合逻辑）", () => {
  it("类推导：glow/spot 关闭分支与 elevation 换挡", () => {
    expect(useSpotlightCard({}).classes.value).toEqual([
      "va-spot-card",
      "va-spot-card--e4",
      "va-spot-card--glow",
      "va-spot-card--spot",
    ]);
    expect(useSpotlightCard({ glow: false, spot: false, elevation: 1 }).classes.value).toEqual([
      "va-spot-card",
      "va-spot-card--e1",
    ]);
  });
});

describe("VaSpotlightCard（dom 挂载）", () => {
  it("默认：发光 + 光斑 + 舞台投影类，slot 内容渲染", () => {
    const w = mount(VaSpotlightCard, { slots: { default: "<p>Agent Ops</p>" } });
    expect(w.classes()).toContain("va-spot-card--glow");
    expect(w.classes()).toContain("va-spot-card--spot");
    expect(w.classes()).toContain("va-spot-card--e4");
    expect(w.text()).toContain("Agent Ops");
  });

  it("props 分支：glow/spot 关闭不挂修饰类，elevation 换挡", () => {
    const w = mount(VaSpotlightCard, { props: { glow: false, spot: false, elevation: 2 } });
    expect(w.classes()).not.toContain("va-spot-card--glow");
    expect(w.classes()).not.toContain("va-spot-card--spot");
    expect(w.classes()).toContain("va-spot-card--e2");
  });

  it("pointerenter 立即写 --va-spot-x/y（happy-dom 零尺寸矩形回中心 50%）", async () => {
    const w = mount(VaSpotlightCard, { slots: { default: "<p>x</p>" } });
    await w.trigger("pointerenter", { clientX: 10, clientY: 10 });
    const style = (w.element as HTMLElement).style;
    expect(style.getPropertyValue("--va-spot-x")).toBe("50%");
    expect(style.getPropertyValue("--va-spot-y")).toBe("50%");
  });

  it("spot:false：指针事件短路不写变量（enabled=false）", async () => {
    const w = mount(VaSpotlightCard, { props: { spot: false } });
    await w.trigger("pointerenter", { clientX: 10, clientY: 10 });
    await w.trigger("pointermove", { clientX: 30, clientY: 30 });
    expect((w.element as HTMLElement).style.getPropertyValue("--va-spot-x")).toBe("");
  });
});

describe("VaSpotlightCard 卸载清理（useSpotlight onScopeDispose）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hover 中卸载：在途 rAF 被 cancel，元素 detach 后不再写 CSS 变量", async () => {
    // fake rAF：手动队列 + 可断言 cancel（推进时机由测试掌控）
    const rafCbs: Array<() => void> = [];
    const cancel = vi.fn((id: number) => {
      delete rafCbs[id - 1];
    });
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);

    const w = mount(VaSpotlightCard, { slots: { default: "<p>x</p>" } });
    await w.trigger("pointermove", { clientX: 30, clientY: 30 });
    expect(rafCbs).toHaveLength(1); // move 已排队一帧（未到帧不写）
    expect((w.element as HTMLElement).style.getPropertyValue("--va-spot-x")).toBe("");

    w.unmount();
    expect(cancel).toHaveBeenCalledTimes(1); // 卸载取消在途帧（对齐 useAgentChat 卸载 flush 范式）

    // 手动推进「下一帧」：元素已 detach + 帧已取消 → 不再写 CSS 变量
    const xBefore = (w.element as HTMLElement).style.getPropertyValue("--va-spot-x");
    for (const cb of rafCbs.splice(0)) if (typeof cb === "function") cb();
    expect((w.element as HTMLElement).style.getPropertyValue("--va-spot-x")).toBe(xBefore);
    expect((w.element as HTMLElement).style.getPropertyValue("--va-spot-y")).toBe("");
  });
});

describe("VaSpotlightCard.css 静态断言（双降级）", () => {
  it("hover: none 不绘制光斑（触屏降级）", () => {
    expect(css).toMatch(/@media \(hover: none\)[^@]*\.va-spot-card--spot::after\s*\{\s*display:\s*none/);
  });

  it("reduced-motion：关过渡 + 光斑不绘制；静态发光（glow-accent）保留", () => {
    const idx = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx);
    expect(block).toMatch(/\.va-spot-card\s*\{\s*transition:\s*none/);
    expect(block).toMatch(/\.va-spot-card--spot::after\s*\{\s*display:\s*none/);
    // 静态发光是样式不是动画：glow 修饰类引用 --va-glow-accent，reduced-motion 块不摘除
    expect(css).toMatch(/\.va-spot-card--glow\s*\{[^}]*--va-glow-accent/);
    expect(block).not.toMatch(/--va-spot-card-glow:\s*none/);
  });

  it("elevation 四档修饰类映射 --va-shadow-1..4（带字面 fallback）", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(css).toMatch(new RegExp(`\\.va-spot-card--e${n}\\s*\\{[^}]*--va-shadow-${n}, `));
    }
  });
});
