// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { registerCardComponent, clearCardComponents } from "@vuagent/ui";
import CardRenderer from "../components/CardRenderer.vue";
import type { ActionCard } from "../types";

import DeployStatusCard from "../custom-components/DeployStatusCard.vue";
import { applyUiComponentResult } from "../stream/reducer";
import type { MessageTurn } from "../types";

describe("CardRenderer 动态场景卡片分发", () => {
  const MyOrderCard = defineComponent({
    name: "MyOrderCard",
    props: { orderId: String, amount: Number },
    setup(props) {
      return () => h("div", { class: "my-order-card" }, `Order: ${props.orderId}, $${props.amount}`);
    },
  });

  beforeEach(() => {
    clearCardComponents();
  });

  it("当命中开发者自定义注册的场景组件时，动态渲染该组件并透传 props", () => {
    registerCardComponent("custom_order_card", MyOrderCard);

    const card: ActionCard = {
      id: "ui-1",
      type: "ui",
      data: {
        component: "custom_order_card",
        props: { orderId: "ORD-12345", amount: 99.9 },
      },
    };

    const wrapper = mount(CardRenderer, {
      props: { card },
    });

    expect(wrapper.find(".my-order-card").exists()).toBe(true);
    expect(wrapper.text()).toContain("Order: ORD-12345, $99.9");
  });

  it("当未注册且非内置组件时，优雅降级为 fallback 容器，防止前端崩溃", () => {
    const card: ActionCard = {
      id: "ui-unknown",
      type: "ui",
      data: {
        component: "unregistered_kpi_card",
        props: { kpi: 88 },
      },
    };

    const wrapper = mount(CardRenderer, {
      props: { card },
    });

    expect(wrapper.find(".va-custom-card-fallback").exists()).toBe(true);
    expect(wrapper.text()).toContain("unregistered_kpi_card");
    expect(wrapper.text()).toContain("88");
  });

  it("支持渲染 DeployStatusCard 微服务部署巡检卡片", () => {
    registerCardComponent("ui_deploy_status", DeployStatusCard);

    const card: ActionCard = {
      id: "ui-deploy-1",
      type: "ui",
      data: {
        component: "ui_deploy_status",
        props: {
          serviceName: "payment-api",
          environment: "production",
          version: "v3.1.0",
          status: "healthy",
          endpoints: ["https://pay.internal/health"],
          metrics: { cpu: "14%", memory: "320 MB", replicas: "3/3 Ready" },
        },
      },
    };

    const wrapper = mount(CardRenderer, {
      props: { card },
    });

    expect(wrapper.find(".va-deploy-card").exists()).toBe(true);
    expect(wrapper.text()).toContain("payment-api");
    expect(wrapper.text()).toContain("v3.1.0");
    expect(wrapper.text()).toContain("PROD 生产");
    expect(wrapper.text()).toContain("健康运行");
    expect(wrapper.text()).toContain("https://pay.internal/health");
  });

  it("reducer.applyUiComponentResult 对未硬编码的场景组件下发 type='ui' 卡片", () => {
    const turn: MessageTurn = {
      id: "t1",
      role: "assistant",
      content: "",
      blocks: [],
      cards: [],
      timestamp: Date.now(),
    };

    applyUiComponentResult(
      turn,
      {
        rendered: true,
        component: "ui_deploy_status" as any,
        props: { serviceName: "auth-service" },
      },
      "tc-1",
      { setPlanSteps: () => {} }
    );

    expect(turn.cards).toHaveLength(1);
    expect(turn.cards![0].type).toBe("ui");
    expect(turn.cards![0].data.component).toBe("ui_deploy_status");
    expect(turn.cards![0].data.props.serviceName).toBe("auth-service");
  });
});
