// @vitest-environment happy-dom
/**
 * VaAgentRenderer skeleton→内容交叉过渡 dom 测试（TASK-103）：
 * streaming 且非 progressive 渲染骨架（无 va-crossfade）；骨架→内容切换后
 * 内容节点挂 .va-crossfade（motion.css 纯淡入协议）；未经骨架直接渲染实体
 * 组件（历史回放）不重复入场。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll } from "vitest";
import { mount } from "@vue/test-utils";
import VaAgentRenderer from "../src/runtime/VaAgentRenderer.vue";
import { setupDefaultAgentRegistry } from "../src/runtime/registry";

// happy-dom 的全局 URL 会把相对解析劫持到其默认 location（http://localhost:3000），
// 静态断言读文件统一走 fileURLToPath(import.meta.url) + path 组合（不经全局 URL）
const here = path.dirname(fileURLToPath(import.meta.url));

// ui_code_diff：progressive=false 且带 CodeSkeleton——标准的「骨架→内容」切换样例
const baseProps = {
  toolCallId: "call-cross-1",
  componentName: "ui_code_diff",
  args: { oldText: "const a = 1;", newText: "const a = 2;", fileName: "a.ts" },
};

beforeAll(() => {
  setupDefaultAgentRegistry();
});

describe("VaAgentRenderer skeleton→内容交叉过渡", () => {
  it("streaming 且非渐进：渲染骨架，骨架节点不挂 .va-crossfade（避免与 shimmer 双动画）", () => {
    const wrapper = mount(VaAgentRenderer, {
      props: { ...baseProps, status: "streaming" },
    });

    expect(wrapper.find(".va-agent-skeleton-code").exists()).toBe(true);
    expect(wrapper.find(".va-crossfade").exists()).toBe(false);
  });

  it("骨架→内容切换：内容节点挂 .va-crossfade（纯淡入交叉）", async () => {
    const wrapper = mount(VaAgentRenderer, {
      props: { ...baseProps, status: "streaming" },
    });
    expect(wrapper.find(".va-agent-skeleton-code").exists()).toBe(true);

    await wrapper.setProps({ status: "executing" });

    expect(wrapper.find(".va-agent-skeleton-code").exists()).toBe(false);
    expect(wrapper.find(".va-crossfade").exists()).toBe(true);
  });

  it("未经骨架直接渲染实体组件（历史回放口径）不重复入场", () => {
    const wrapper = mount(VaAgentRenderer, {
      props: { ...baseProps, status: "executing" },
    });

    expect(wrapper.find(".va-crossfade").exists()).toBe(false);
  });

  it("渐进渲染组件（progressive）不渲染骨架，直接内容且不挂交叉类", () => {
    const wrapper = mount(VaAgentRenderer, {
      props: {
        toolCallId: "call-cross-2",
        componentName: "ui_approval_card",
        status: "streaming",
        args: { title: "渐进审批" },
      },
    });

    expect(wrapper.find(".va-agent-skeleton-card").exists()).toBe(false);
    expect(wrapper.find(".va-crossfade").exists()).toBe(false);
  });

  it("reduced-motion 分支：motion.css 媒体块覆盖 .va-crossfade（降级纯 fade 等价口径）", () => {
    const css = fs.readFileSync(path.resolve(here, "../src/styles/motion.css"), "utf8");
    const reducedBlock = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedBlock).toContain(".va-crossfade");
    expect(reducedBlock).toContain("animation-name: va-motion-fade-in");
  });
});
