// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaTurnList from "../src/components/turn-list/VaTurnList.vue";
import type { TurnItem } from "../src/components/turn-list/types";

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
});
