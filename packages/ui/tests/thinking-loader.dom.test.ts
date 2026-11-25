/**
 * VaThinkingLoader 交互测试（happy-dom 真实挂载 + fake timers）：
 * 阶段轮播推进、loop=false 停末段 / loop=true 回绕（Console 等待时长不确定，
 * 轮播停住会显得卡死——回归锁定）、done 态切换、label 定宽（防宽度抖动）、
 * aria-live 语义。
 */
// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import VaThinkingLoader from "../src/components/thinking-loader/VaThinkingLoader.vue";

// 静态断言读文件统一走 fileURLToPath(import.meta.url) + path 组合（不经全局 URL）
const here = path.dirname(fileURLToPath(import.meta.url));

const text = () => document.body.querySelector(".va-think__label-text")?.textContent?.trim();
const label = () => document.body.querySelector<HTMLElement>(".va-think__label");

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("VaThinkingLoader", () => {
  /** 推进定时器并等 Vue 重渲染 + out-in 过渡交换完成（CSS 未加载，过渡时长按 0 计） */
  const advance = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 4; i++) await nextTick();
  };

  it("阶段轮播：按 interval 推进文案", async () => {
    wrapper = mount(VaThinkingLoader, {
      props: { phases: ["连接模型", "读取上下文", "规划步骤"], interval: 1000 },
      attachTo: document.body,
    });
    expect(text()).toBe("连接模型");
    await advance(1000);
    expect(text()).toBe("读取上下文");
    await advance(1000);
    expect(text()).toBe("规划步骤");
  });

  it("loop=false 走完一轮停在末段；loop=true 回绕到首段", async () => {
    wrapper = mount(VaThinkingLoader, {
      props: { phases: ["甲", "乙"], interval: 1000 },
      attachTo: document.body,
    });
    await advance(3000);
    expect(text()).toBe("乙"); // 停末段不再推进
    wrapper.unmount();

    wrapper = mount(VaThinkingLoader, {
      props: { phases: ["甲", "乙"], interval: 1000, loop: true },
      attachTo: document.body,
    });
    await advance(1000);
    expect(text()).toBe("乙");
    await advance(1000);
    expect(text()).toBe("甲"); // 回绕
  });

  it("done：spinner 转对勾，文案切 doneLabel，不再轮播", () => {
    wrapper = mount(VaThinkingLoader, {
      props: { phases: ["甲", "乙"], done: true, doneLabel: "已完成 · 1.2s" },
      attachTo: document.body,
    });
    expect(text()).toBe("已完成 · 1.2s");
    expect(document.body.querySelector(".va-think__icon svg")).toBeTruthy();
    expect(document.body.querySelector(".va-think__spin")).toBeNull();
    // shine 载体是内层 label-shine span：done 态 data-shine 摘除（流式中的微光停止）
    expect(document.body.querySelector(".va-think__label-shine")?.hasAttribute("data-shine")).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(text()).toBe("已完成 · 1.2s");
  });

  it("label min-width 按最长阶段文案设置（防宽度抖动）", () => {
    wrapper = mount(VaThinkingLoader, {
      props: { phases: ["连接模型", "读取上下文", "规划步骤"] },
      attachTo: document.body,
    });
    expect(label()?.style.minWidth).toBe("5em"); // 「读取上下文」5 字
  });

  it("语义：role=status + label aria-live=polite", () => {
    wrapper = mount(VaThinkingLoader, { attachTo: document.body });
    expect(document.body.querySelector(".va-think")?.getAttribute("role")).toBe("status");
    expect(label()?.getAttribute("aria-live")).toBe("polite");
  });

  it("静态断言（R8 重构不变量）：shine 在内层 span、过渡子节点非 inline 且无无限动画", () => {
    // 重构背景：shine 无限动画若挂在过渡子节点自身，Vue 过渡时长探测等
    // animationend 永不触发 → 旧节点滞留 → 被迫 :duration 硬编码绕过 token。
    // shine 已挪到内层 label-shine；子节点 label-text 必须保持非 inline
    // （transform 对纯 inline 元素不生效，va-think-phase 的 translateY 会静默失效）。
    const css = fs.readFileSync(
      path.resolve(here, "../src/components/thinking-loader/VaThinkingLoader.css"),
      "utf8",
    );
    const textBlock = /(?:^|\n)\.va-think__label-text\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(textBlock).toMatch(/display:\s*inline-block/);
    expect(textBlock).not.toMatch(/animation:/);
    expect(css).toMatch(/\.va-think__label-shine\[data-shine\]\s*\{[^}]*animation:\s*va-think-shine/);
    // 过渡时长留在 CSS（--va-dur-1），SFC 不再出现 :duration 硬编码
    const sfc = fs.readFileSync(
      path.resolve(here, "../src/components/thinking-loader/VaThinkingLoader.vue"),
      "utf8",
    );
    expect(sfc).not.toMatch(/:duration=/);
    expect(sfc).toMatch(/class="va-think__label-shine"/);
  });
});
