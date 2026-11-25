// @vitest-environment happy-dom
/**
 * 空态动效化 + 复制反馈统一 dom 断言（TASK-106，代表组件抽测）：
 * - 空态：列表类组件空态节点挂 .va-fade-in（仅 opacity 弱化档）——turn-list /
 *   session-manager / agent-inbox 三代表；
 * - 空态 hero：VaEmptyHero 根节点挂 .va-enter-up（一次性上浮入场）；
 * - 复制反馈：terminal-log / code-diff / message-actions 三消费方均挂
 *   .va-copy 交叉结构，copied 置真切 .va-copy--done（120ms 交叉 + spring 微弹由
 *   motion.css 承接，此处断言 class 挂载与时序状态切换）。
 */
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VaTurnList from "../src/components/turn-list/VaTurnList.vue";
import VaSessionManager from "../src/components/session-manager/VaSessionManager.vue";
import VaAgentInbox from "../src/components/agent-inbox/VaAgentInbox.vue";
import VaEmptyHero from "../src/components/empty-hero/VaEmptyHero.vue";
import VaTerminalLog from "../src/components/terminal-log/VaTerminalLog.vue";
import VaCodeDiff from "../src/components/code-diff/VaCodeDiff.vue";
import VaMessageActions from "../src/components/message-actions/VaMessageActions.vue";

describe("空态渐入（.va-fade-in）", () => {
  it("turn-list 空态容器挂 .va-fade-in", () => {
    const wrapper = mount(VaTurnList, { props: { turns: [] } });
    expect(wrapper.find(".va-turn-list__empty").classes()).toContain("va-fade-in");
    expect(wrapper.text()).toContain("给 Agent 发送一条消息开始交互");
  });

  it("session-manager 空会话提示挂 .va-fade-in", async () => {
    const wrapper = mount(VaSessionManager, {
      props: { sessions: [], activeId: "" },
    });
    // 空态在面板内（默认收起），先点开触发器
    await wrapper.find(".va-smn__trigger").trigger("click");
    expect(wrapper.find(".va-smn__empty").classes()).toContain("va-fade-in");
  });

  it("agent-inbox 空视图提示挂 .va-fade-in", () => {
    const wrapper = mount(VaAgentInbox, { props: { tasks: [] } });
    expect(wrapper.find(".va-inb__empty").classes()).toContain("va-fade-in");
  });

  it("VaEmptyHero 根节点挂 .va-enter-up（一次性上浮入场）", () => {
    const wrapper = mount(VaEmptyHero, { props: { workspaces: [] } });
    expect(wrapper.find(".va-hero").classes()).toContain("va-enter-up");
  });
});

describe("复制反馈（.va-copy 交叉结构）", () => {
  it("terminal-log 行复制：idle/done 同格堆叠，复制后切 --done 且触发 copy 事件", async () => {
    const wrapper = mount(VaTerminalLog, {
      props: { lines: ["hello world"] },
    });
    const swap = wrapper.find(".va-term__copy .va-copy");
    expect(swap.exists()).toBe(true);
    expect(swap.classes()).not.toContain("va-copy--done");
    expect(swap.find(".va-copy__idle").text()).toBe("⧉");
    expect(swap.find(".va-copy__done").text()).toBe("✓");

    await wrapper.find(".va-term__copy").trigger("click");
    expect(swap.classes()).toContain("va-copy--done");
    expect(wrapper.emitted("copy")?.[0]).toEqual(["hello world"]);
  });

  it("code-diff 复制按钮：复制后切 --done（文案交叉，宽度同格不跳动）", async () => {
    const wrapper = mount(VaCodeDiff, {
      props: { oldText: "a\nb", newText: "a\nc" },
    });
    const btn = wrapper.find(".va-cdiff__btn.va-act");
    const swap = btn.find(".va-copy");
    expect(swap.exists()).toBe(true);
    expect(swap.find(".va-copy__idle").text()).toBe("复制新文件");

    await btn.trigger("click");
    expect(swap.classes()).toContain("va-copy--done");
    expect(wrapper.emitted("copy")).toHaveLength(1);
  });

  it("message-actions 复制图标：复制后切 --done 且 copy 事件上抛（TASK-106 统一为 useCopyable 驱动）", async () => {
    const wrapper = mount(VaMessageActions, {
      props: { text: "复制我" },
    });
    const swap = wrapper.find(".va-msg__act .va-copy");
    expect(swap.exists()).toBe(true);
    expect(swap.classes()).not.toContain("va-copy--done");
    // idle/done 两个图标常驻（交叉过渡形态，非 v-if 换节点）
    expect(swap.findAll("svg")).toHaveLength(2);

    await wrapper.find(".va-msg__act").trigger("click");
    expect(swap.classes()).toContain("va-copy--done");
    expect(wrapper.emitted("copy")?.[0]).toEqual(["复制我"]);
  });
});
