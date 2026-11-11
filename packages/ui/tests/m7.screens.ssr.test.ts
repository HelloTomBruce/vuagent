/**
 * M7 Screens SSR smoke：页面骨架可渲染 + 插槽注入。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import {
  VaAgentChat,
  VaAgentRun,
  VaAppShell,
  VaOnboarding,
  VaSettingsBilling,
} from "../src";

describe("M7 Screens SSR 渲染", () => {
  it("VaAppShell：导航/徽标/选中态/插槽", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            VaAppShell,
            {
              brand: "Vuagent",
              nav: [
                { id: "runs", label: "运行" },
                { id: "inbox", label: "收件箱", badge: 3 },
                { id: "settings", label: "设置", disabled: true },
              ],
              active: "inbox",
            },
            { topbar: () => h("span", { id: "tb" }, "顶栏"), default: () => h("p", { id: "main" }, "主内容") },
          ),
      }),
    );
    expect(html).toContain("Vuagent");
    expect(html).toContain("收件箱");
    expect(html).toContain('data-active="true"');
    expect(html).toContain("disabled"); // 设置项禁用
    expect(html).toContain("顶栏");
    expect(html).toContain("主内容");
  });

  it("VaAgentChat：双角色气泡 + 工具 chips + 思考态 + 空态", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaAgentChat, {
            title: "代码审查员",
            messages: [
              { id: "m1", role: "user", text: "审查这个 PR" },
              { id: "m2", role: "agent", text: "发现 2 处竞态。", tools: ["read_file", "run_tests"] },
            ],
          }),
      }),
    );
    expect(html).toContain('data-role="user"');
    expect(html).toContain('data-role="agent"');
    expect(html).toContain("read_file");
    expect(html).toContain("将 VaComposer 放入");

    const thinking = await renderToString(
      createSSRApp({ render: () => h(VaAgentChat, { messages: [], thinking: true }) }),
    );
    expect(thinking).toContain("va-chat__pulse");
    expect(thinking).toContain("思考中");

    const empty = await renderToString(
      createSSRApp({ render: () => h(VaAgentChat, { messages: [] }) }),
    );
    expect(empty).toContain("给 agent 一个任务");
  });

  it("VaAgentRun：状态徽章 + 三栏插槽", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            VaAgentRun,
            { title: "重构用户列表", status: "running", duration: 84_000 },
            {
              plan: () => h("div", { id: "plan-slot" }, "计划区"),
              default: () => h("div", { id: "stream-slot" }, "执行流"),
              aside: () => h("div", { id: "aside-slot" }, "上下文区"),
              actions: () => h("button", "停止"),
            },
          ),
      }),
    );
    expect(html).toContain("重构用户列表");
    expect(html).toContain('data-status="running"');
    expect(html).toContain("1m 24s");
    expect(html).toContain("计划区");
    expect(html).toContain("执行流");
    expect(html).toContain("上下文区");
  });

  it("VaOnboarding：hero + 双 CTA + 步骤区插槽", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(
            VaOnboarding,
            { title: "让 agent 接手重复工作", subtitle: "三步接入你的仓库", secondaryCtaLabel: "看文档" },
            { default: () => h("div", { id: "steps-slot" }, "SetupGuide 放这里") },
          ),
      }),
    );
    expect(html).toContain("让 agent 接手重复工作");
    expect(html).toContain("开始使用");
    expect(html).toContain("看文档");
    expect(html).toContain("SetupGuide 放这里");
  });

  it("VaSettingsBilling：导航选中 + 套餐当前/推荐态", async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(VaSettingsBilling, {
            nav: [
              { id: "profile", label: "个人资料" },
              { id: "billing", label: "账单" },
            ],
            active: "billing",
            plans: [
              { id: "free", name: "Free", price: "$0 / 月", features: ["每月 50 次运行"], current: true },
              { id: "pro", name: "Pro", price: "$20 / 月", features: ["无限运行", "优先模型"], recommended: true },
            ],
          }),
      }),
    );
    expect(html).toContain('data-active="true"');
    expect(html).toContain("当前");
    expect(html).toContain("推荐");
    expect(html).toContain("使用中");
    expect(html).toContain("切换到此套餐");
  });
});
