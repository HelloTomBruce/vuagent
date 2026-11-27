// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { registerCardComponent, clearCardComponents } from "@vuagent/ui";
import ToolsPanel from "../components/settings/ToolsPanel.vue";
import type { ToolItem } from "../api/client";

describe("ToolsPanel 工具与场景组件设置面板", () => {
  beforeEach(() => {
    clearCardComponents();
  });

  const mockTools: ToolItem[] = [
    {
      name: "bash_run",
      description: "在受控沙箱中执行 Shell 命令",
      riskLevel: "high",
      writesWorkspace: true,
      requiresApproval: true,
      enabled: true,
      source: "builtin",
    },
    {
      name: "ui_deploy_status",
      description: "渲染微服务部署进展与健康巡检的专用可视化卡片",
      riskLevel: "low",
      writesWorkspace: false,
      requiresApproval: false,
      enabled: true,
      source: "ui_component",
    },
    {
      name: "db_query",
      description: "只读查询内部业务数据表",
      riskLevel: "medium",
      writesWorkspace: false,
      requiresApproval: false,
      enabled: true,
      source: "custom",
    },
    {
      name: "ci_pipeline_trigger",
      description: "向云端自动化构建中心触发流水线动作",
      riskLevel: "high",
      writesWorkspace: false,
      requiresApproval: true,
      enabled: true,
      source: "custom",
    },
  ];

  it("正确区分场景 UI 组件、业务扩展工具与内置系统工具", () => {
    // 注册 ui_deploy_status 前端组件
    registerCardComponent("ui_deploy_status", { template: "<div />" });

    const wrapper = mount(ToolsPanel, {
      props: {
        tools: mockTools,
        loading: false,
        loadError: "",
      },
    });

    expect(wrapper.text()).toContain("场景组件工具 (Generative UI)");
    expect(wrapper.text()).toContain("ui_deploy_status");
    expect(wrapper.text()).toContain("✨ 前端已就绪");

    expect(wrapper.text()).toContain("业务扩展工具 (Custom Action Tools)");
    expect(wrapper.text()).toContain("db_query");
    expect(wrapper.text()).toContain("ci_pipeline_trigger");
    expect(wrapper.text()).toContain("人工审批");

    expect(wrapper.text()).toContain("内置系统基础工具");
    expect(wrapper.text()).toContain("bash_run");
  });

  it("当场景组件未在前端注册时，展示未绑定提示", () => {
    const wrapper = mount(ToolsPanel, {
      props: {
        tools: mockTools,
        loading: false,
        loadError: "",
      },
    });

    expect(wrapper.text()).toContain("未绑定组件");
  });

  it("点击启停开关派发 toggle 事件", async () => {
    const wrapper = mount(ToolsPanel, {
      props: {
        tools: mockTools,
        loading: false,
        loadError: "",
      },
    });

    const switches = wrapper.findAll(".va-settings__switch");
    expect(switches.length).toBe(4);

    await switches[0].trigger("click");
    expect(wrapper.emitted("toggle")).toHaveLength(1);
    expect(wrapper.emitted("toggle")![0][0]).toEqual(mockTools[0]); // builtinTools 首位排在前
  });

  it("支持通过分类按钮筛选工具", async () => {
    const wrapper = mount(ToolsPanel, {
      props: {
        tools: mockTools,
        loading: false,
        loadError: "",
      },
    });

    const filterBtns = wrapper.findAll(".va-settings__tool-tab-btn");
    expect(filterBtns.length).toBe(4);

    // 仅看业务动作工具
    await filterBtns[2].trigger("click");
    expect(wrapper.text()).toContain("db_query");
    expect(wrapper.text()).not.toContain("bash_run");
    expect(wrapper.text()).not.toContain("ui_deploy_status");

    // 仅看场景组件
    await filterBtns[3].trigger("click");
    expect(wrapper.text()).toContain("ui_deploy_status");
    expect(wrapper.text()).not.toContain("bash_run");
    expect(wrapper.text()).not.toContain("db_query");

    // 仅看内置工具
    await filterBtns[1].trigger("click");
    expect(wrapper.text()).toContain("bash_run");
    expect(wrapper.text()).not.toContain("ui_deploy_status");
    expect(wrapper.text()).not.toContain("db_query");
  });
});
