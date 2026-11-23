// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaUserBubble from "../src/components/user-bubble/VaUserBubble.vue";

describe("VaUserBubble", () => {
  it("渲染用户提问文本和默认头像", () => {
    const wrapper = mount(VaUserBubble, {
      props: {
        content: "帮我查询生产环境集群状态",
        avatar: "张",
      },
    });

    expect(wrapper.text()).toContain("帮我查询生产环境集群状态");
    expect(wrapper.find(".va-user-bubble__avatar").text()).toBe("张");
  });

  it("渲染多模态附件（图片与文件 chip）", () => {
    const wrapper = mount(VaUserBubble, {
      props: {
        content: "排查日志",
        attachments: [
          { kind: "image", name: "error.png", dataUrl: "data:image/png;base64,123" },
          { kind: "file", name: "deploy.yaml", size: 1024 },
        ],
      },
    });

    expect(wrapper.find(".va-user-bubble__att-img").attributes("src")).toBe("data:image/png;base64,123");
    expect(wrapper.text()).toContain("deploy.yaml");
  });
});
