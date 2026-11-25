// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaTurnList from "../src/components/turn-list/VaTurnList.vue";
import type { TurnItem } from "../src/components/turn-list/types";

// happy-dom 的全局 URL 会把相对解析劫持到其默认 location（http://localhost:3000），
// 静态断言读文件统一走 fileURLToPath(import.meta.url) + path 组合（不经全局 URL）
const here = path.dirname(fileURLToPath(import.meta.url));

describe("VaTurnList", () => {
  it("空列表展示默认空提示", () => {
    const wrapper = mount(VaTurnList, {
      props: {
        turns: [],
      },
    });

    expect(wrapper.text()).toContain("给 Agent 发送一条消息开始交互");
  });

  it("按角色自动分流渲染用户气泡与助手 Turn", () => {
    const turns: TurnItem[] = [
      {
        id: "turn-1",
        role: "user",
        content: "检查一下 Pod 状态",
      },
      {
        id: "turn-2",
        role: "assistant",
        content: "所有 Pod 均处于 **Running** 状态",
        thought: "已请求集群 API",
      },
    ];

    const wrapper = mount(VaTurnList, {
      props: { turns },
    });

    expect(wrapper.text()).toContain("检查一下 Pod 状态");
    expect(wrapper.text()).toContain("所有 Pod 均处于");
    expect(wrapper.find("strong").text()).toBe("Running");
  });

  it("入场动效：用户/助手轮次行节点挂 .va-enter-up（TASK-103 重挂载重放口径）", () => {
    const turns: TurnItem[] = [
      { id: "turn-1", role: "user", content: "入场检查" },
      { id: "turn-2", role: "assistant", content: "回复内容" },
    ];

    const wrapper = mount(VaTurnList, {
      props: { turns },
    });

    expect(wrapper.find(".va-user-bubble-row").classes()).toContain("va-enter-up");
    expect(wrapper.find(".va-assistant-turn-row").classes()).toContain("va-enter-up");
  });

  it("追加新轮次：新节点携带入场类（对话流只增不删，无 move/leave 过渡）", async () => {
    const wrapper = mount(VaTurnList, {
      props: { turns: [] as TurnItem[] },
    });
    expect(wrapper.find(".va-user-bubble-row").exists()).toBe(false);

    await wrapper.setProps({
      turns: [{ id: "turn-new", role: "user", content: "新消息" } as TurnItem],
    });

    expect(wrapper.find(".va-user-bubble-row").classes()).toContain("va-enter-up");
    expect(wrapper.text()).toContain("新消息");
  });

  it("贴底契约取舍已落地：模板未使用分组过渡组件（静态断言，取舍说明见组件头注释）", () => {
    const sfc = fs.readFileSync(path.resolve(here, "../src/components/turn-list/VaTurnList.vue"), "utf8");
    // 分组过渡组件的 FLIP move 与 stick-to-bottom rAF 贴底跟随冲突（滚动抖动），
    // 保守方案仅保留子组件入场过渡；断言模板无分组过渡标签（注释措辞避让其字面量）
    expect(sfc).not.toMatch(/<TransitionGroup/);
  });

  it("reduced-motion 分支：motion.css 媒体块覆盖 .va-enter-up（轮次入场降级纯 fade）", () => {
    const css = fs.readFileSync(path.resolve(here, "../src/styles/motion.css"), "utf8");
    const reducedBlock = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedBlock).toContain(".va-enter-up");
    expect(reducedBlock).toContain("animation-name: va-motion-fade-in");
  });
});
