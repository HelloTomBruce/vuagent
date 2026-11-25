// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaAssistantTurn from "../src/components/assistant-turn/VaAssistantTurn.vue";

// happy-dom 的全局 URL 会把相对解析劫持到其默认 location（http://localhost:3000），
// 静态断言读文件统一走 fileURLToPath(import.meta.url) + path 组合（不经全局 URL）
const here = path.dirname(fileURLToPath(import.meta.url));

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

  it("入场动效：行节点挂 .va-enter-up（180ms 上浮+fade，TASK-103）", () => {
    const wrapper = mount(VaAssistantTurn, {
      props: { content: "入场回复" },
    });

    expect(wrapper.find(".va-assistant-turn-row").classes()).toContain("va-enter-up");
  });

  it("流式点与入场衔接：脉冲 animation-delay 对齐入场时长，先入场后脉冲（CSS 静态断言，重构需同步）", () => {
    // 静态断言说明：脉冲延迟写死在 VaAssistantTurn.css 的 animation 简写里（非元素
    // style 绑定，happy-dom 也不解析外部样式表的 animation 值），无法改为挂载后读
    // style 的行为断言——重构该规则（改名/换写法/拆 longhand）时必须同步改本断言。
    const css = fs.readFileSync(
      path.resolve(here, "../src/components/assistant-turn/VaAssistantTurn.css"),
      "utf8",
    );

    // 脉冲延迟 = --va-dur-in（180ms）：行 .va-enter-up 与点同帧挂载时不并发闪两个动画
    expect(css).toMatch(
      /\.va-assistant-turn__cursor-dot\s*\{[^}]*animation:\s*va-dot-pulse\s+1\.2s\s+ease-in-out\s+var\(--va-dur-in,\s*180ms\)\s+infinite/,
    );

    // reduced-motion 分支：脉冲整体停用（静态常亮点），入场降级由 motion.css 兜底
    const reducedBlock = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedBlock).toMatch(/\.va-assistant-turn__cursor-dot\s*\{[^}]*animation:\s*none/);
  });

  it("reduced-motion 分支：motion.css 媒体块覆盖 .va-enter-up（行节点入场降级纯 fade）", () => {
    const css = fs.readFileSync(path.resolve(here, "../src/styles/motion.css"), "utf8");
    const reducedBlock = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));

    expect(reducedBlock).toContain(".va-enter-up");
    expect(reducedBlock).toContain("animation-name: va-motion-fade-in");
  });
});
