// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaDock from "../src/components/dock/VaDock.vue";
import VaAgentRun from "../src/components/agent-run/VaAgentRun.vue";
import VaAIWorkspace from "../src/components/workspace-blocks/VaAIWorkspace.vue";
import VaPricingPlans from "../src/components/workspace-blocks/VaPricingPlans.vue";
import VaOnboarding from "../src/components/onboarding/VaOnboarding.vue";
import VaSmartRecommendation from "../src/components/smart-recommendation/VaSmartRecommendation.vue";
import VaTrajectory from "../src/components/trajectory/VaTrajectory.vue";

/**
 * TASK-107/108 零动效组件补齐 · dom 断言批
 * - 入场类（.va-enter-up/.va-fade-in）挂载到位；
 * - trajectory 渐进揭示：无 IO/reduced-motion 环境不激活（data-reveal 不挂载）→ 内容全显；
 * - 空态渐入类挂载。
 */

describe("VaDock 动效（TASK-108）", () => {
  it("pane 入场类挂载；空态渐入类挂载", () => {
    const wrapper = mount(VaDock, {
      props: {
        panes: [
          { id: "p1", activeId: "t1", tabs: [] },
        ],
      },
    });
    expect(wrapper.find(".va-dock__pane").classes()).toContain("va-enter-up");
    expect(wrapper.find(".va-dock__empty").classes()).toContain("va-fade-in");
  });
});

describe("VaAgentRun 动效（TASK-108）", () => {
  it("三列错峰入场：每列挂 va-enter-up（延迟由 CSS nth 规则提供）", () => {
    const wrapper = mount(VaAgentRun, { props: { status: "running" } });
    const cols = wrapper.findAll(".va-run__col");
    expect(cols.length).toBe(3);
    for (const col of cols) {
      expect(col.classes()).toContain("va-enter-up");
    }
  });
});

describe("workspace-blocks 动效（TASK-108）", () => {
  it("VaAIWorkspace 文件行挂 va-enter-up", () => {
    const wrapper = mount(VaAIWorkspace, {
      props: {
        files: [
          { path: "a.ts", status: "modified" },
          { path: "b.ts" },
        ],
      },
    });
    const rows = wrapper.findAll(".va-ws__file");
    expect(rows.length).toBe(2);
    for (const row of rows) expect(row.classes()).toContain("va-enter-up");
  });

  it("VaPricingPlans 定价卡挂 va-enter-up", () => {
    const wrapper = mount(VaPricingPlans, {
      props: {
        tiers: [
          { name: "基础", price: "$0" },
          { name: "专业", price: "$9" },
        ],
      },
    });
    const tiers = wrapper.findAll(".va-price__tier");
    expect(tiers.length).toBe(2);
    for (const tier of tiers) expect(tier.classes()).toContain("va-enter-up");
  });
});

describe("VaOnboarding / VaSmartRecommendation 动效（TASK-107）", () => {
  it("VaOnboarding hero 与 steps 挂 va-enter-up", () => {
    const wrapper = mount(VaOnboarding, {
      props: { title: "欢迎使用" },
      slots: { default: "<div>step</div>" },
    });
    expect(wrapper.find(".va-ob__hero").classes()).toContain("va-enter-up");
    expect(wrapper.find(".va-ob__steps").classes()).toContain("va-enter-up");
  });

  it("VaSmartRecommendation 建议卡挂 va-enter-up（title/actions 为必需 props，补齐避免 Vue warning）", () => {
    const wrapper = mount(VaSmartRecommendation, {
      props: {
        title: "建议：拆分构建缓存",
        actions: [{ id: "a1", label: "接受", primary: true }],
      },
    });
    expect(wrapper.find(".va-rec").classes()).toContain("va-enter-up");
    expect(wrapper.find(".va-rec__title").text()).toBe("建议：拆分构建缓存");
    expect(wrapper.find(".va-rec__btn").text()).toBe("接受");
  });
});

describe("VaTrajectory 渐进揭示（TASK-107）", () => {
  it("无 IO/reduced-motion 环境：不激活（data-reveal 不挂载），内容直接全显", () => {
    const wrapper = mount(VaTrajectory, {
      props: {
        events: [
          { id: "e1", type: "step", title: "步骤一", at: Date.now() },
          { id: "e2", type: "step", title: "步骤二", at: Date.now() },
        ],
      },
    });
    // happy-dom 有 IntersectionObserver 时 active 才为 true；本环境无 IO → 全显
    expect(wrapper.find(".va-traj").attributes("data-reveal")).not.toBe("on");
    const rows = wrapper.findAll(".va-traj__row");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // 未激活时 rowVisible 恒 true → data-shown 不挂载（CSS 全显路径）
      expect(row.attributes("data-hidden")).toBeUndefined();
    }
  });
});
