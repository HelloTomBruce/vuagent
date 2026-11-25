// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaUserBubble from "../src/components/user-bubble/VaUserBubble.vue";

// happy-dom 的全局 URL 会把相对解析劫持到其默认 location（http://localhost:3000），
// 静态断言读文件统一走 fileURLToPath(import.meta.url) + path 组合（不经全局 URL）
const here = path.dirname(fileURLToPath(import.meta.url));

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

  it("入场动效：行节点挂 .va-enter-up（180ms 上浮+fade，TASK-103）", () => {
    const wrapper = mount(VaUserBubble, {
      props: { content: "入场消息" },
    });

    expect(wrapper.find(".va-user-bubble-row").classes()).toContain("va-enter-up");
  });

  it("reduced-motion 分支：motion.css 媒体块将 .va-enter-up 降级为纯 fade", () => {
    const css = fs.readFileSync(path.resolve(here, "../src/styles/motion.css"), "utf8");
    const reducedBlock = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedBlock).toContain(".va-enter-up");
    // 降级口径：动画名整体替换为纯 opacity fade（无位移）
    expect(reducedBlock).toContain("animation-name: va-motion-fade-in");
  });
});
