// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaThoughtBox from "../src/components/thought-box/VaThoughtBox.vue";

describe("VaThoughtBox", () => {
  it("默认展开态渲染思考标题与正文", () => {
    const wrapper = mount(VaThoughtBox, {
      props: {
        thought: "正在规划工具调用序列...",
        duration: 1.5,
      },
    });

    expect(wrapper.text()).toContain("思考过程");
    expect(wrapper.text()).toContain("· 耗时 1.5s");
    expect(wrapper.text()).toContain("正在规划工具调用序列...");
    expect(wrapper.find(".va-thought-box__content").exists()).toBe(true);
  });

  it("点击收起/展开切换", async () => {
    const wrapper = mount(VaThoughtBox, {
      props: {
        thought: "思考细节",
        expanded: true,
      },
    });

    const header = wrapper.find(".va-thought-box__header");
    await header.trigger("click");
    expect(wrapper.emitted("update:expanded")?.[0]).toEqual([false]);
  });

  it("渲染为已完成过程摘要条形态", async () => {
    const wrapper = mount(VaThoughtBox, {
      props: {
        thought: "完成内容",
        summaryMode: true,
        duration: 2.3,
        toolCount: 4,
      },
    });

    expect(wrapper.find(".va-thought-box__summary").exists()).toBe(true);
    expect(wrapper.text()).toContain("已完成");
    expect(wrapper.text()).toContain("2.3s");
    expect(wrapper.text()).toContain("4 次工具调用");

    // 点击摘要条触发展开
    await wrapper.find(".va-thought-box__summary").trigger("click");
    expect(wrapper.emitted("update:summaryMode")?.[0]).toEqual([false]);
    expect(wrapper.emitted("update:expanded")?.[0]).toEqual([true]);
  });
});
