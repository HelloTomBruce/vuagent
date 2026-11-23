// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaAssistantTurn from "../src/components/assistant-turn/VaAssistantTurn.vue";

describe("VaAssistantTurn", () => {
  it("渲染思考链与 Markdown 正文", () => {
    const wrapper = mount(VaAssistantTurn, {
      props: {
        content: "排查完成，**Redis 正常运行**",
        thought: "正在调用 kubectl 诊断...",
        thoughtDuration: 1.2,
      },
    });

    expect(wrapper.text()).toContain("思考过程");
    expect(wrapper.text()).toContain("正在调用 kubectl 诊断...");
    expect(wrapper.find("strong").text()).toBe("Redis 正常运行");
  });

  it("支持时序交错卡片插槽渲染", () => {
    const wrapper = mount(VaAssistantTurn, {
      props: {
        blocks: [
          { kind: "text", content: "前置分析完毕" },
          { kind: "card", cardId: "card-1" },
          { kind: "text", content: "执行结果如上" },
        ],
        cards: [
          { id: "card-1", type: "toolcall", data: { name: "get_status" } },
        ],
      },
      slots: {
        card: `
          <template #card="{ card }">
            <div class="custom-card">工具: {{ card.data.name }}</div>
          </template>
        `,
      },
    });

    expect(wrapper.find(".custom-card").text()).toBe("工具: get_status");
    expect(wrapper.text()).toContain("前置分析完毕");
    expect(wrapper.text()).toContain("执行结果如上");
  });

  it("流式与中止状态正确展示", () => {
    const wrapper = mount(VaAssistantTurn, {
      props: {
        streaming: true,
        aborted: true,
        abortReason: "用户主动取消",
      },
    });

    expect(wrapper.find(".va-assistant-turn__streaming").exists()).toBe(true);
    expect(wrapper.find(".va-assistant-turn__aborted").text()).toContain("用户主动取消");
  });
});
