/**
 * M7 Blocks / Illustrations SSR smoke。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import {
  VaAgentTeam,
  VaAIWorkspace,
  VaModelWheel,
  VaPricingPlans,
  VaTaskBoard,
  VaVoiceOrb,
} from "../src";

async function ssr(component: Parameters<typeof h>[0], props: Record<string, unknown> = {}, slot?: () => unknown) {
  const app = createSSRApp({ render: () => h(component, props, slot) });
  return renderToString(app);
}

describe("M7 Blocks SSR 渲染", () => {
  it("VaTaskBoard：列分组 + 计数 + 优先级/选中", async () => {
    const html = await ssr(VaTaskBoard, {
      columns: [
        { id: "todo", title: "待办" },
        { id: "doing", title: "进行中" },
      ],
      tasks: [
        { id: "t1", columnId: "todo", title: "接入 GitHub", priority: "high", assignee: "张北" },
        { id: "t2", columnId: "doing", title: "写文档", meta: "2h" },
      ],
      selected: "t1",
    });
    expect(html).toContain("待办");
    expect(html).toContain("进行中");
    expect(html).toContain('data-priority="high"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("张"); // 负责人首字母
    expect(html).toMatch(/<span class="va-board__count">1<\/span>/);
  });

  it("VaPricingPlans：推荐/当前态 + 特性 + CTA", async () => {
    const html = await ssr(VaPricingPlans, {
      tiers: [
        { id: "free", name: "Free", price: "$0", features: ["50 次/月"], current: true },
        { id: "pro", name: "Pro", price: "$20", period: "按月", features: ["无限运行"], recommended: true, ctaLabel: "升级" },
      ],
    });
    expect(html).toContain("推荐");
    expect(html).toContain("当前");
    expect(html).toContain("使用中");
    expect(html).toContain("升级");
    expect(html).toContain("无限运行");
  });

  it("VaAIWorkspace：文件栏 + 作用域插槽预览", async () => {
    const html = await ssr(
      VaAIWorkspace,
      {
        files: [
          { id: "f1", name: "useUsers.ts", status: "modified" },
          { id: "f2", name: "App.tsx", status: "added" },
        ],
        selected: "f1",
      },
      () => h("p", { id: "preview-slot" }, "这里放 VaCodeDiff"),
    );
    expect(html).toContain("useUsers.ts");
    expect(html).toMatch(/data-status="modified"/);
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("这里放 VaCodeDiff");
  });
});

describe("M7 Illustrations SSR 渲染", () => {
  it("VaVoiceOrb：三态类名与 aria", async () => {
    const speaking = await ssr(VaVoiceOrb, { state: "speaking", size: 120 });
    expect(speaking).toContain("va-orb--speaking");
    expect(speaking).toContain("说话中");
    expect((speaking.match(/va-orb__bar/g) ?? []).length).toBe(4);
    const idle = await ssr(VaVoiceOrb, {});
    expect(idle).toContain("va-orb--idle");
  });

  it("VaAgentTeam：环形徽标 + aria 名单", async () => {
    const html = await ssr(VaAgentTeam, {
      agents: [
        { id: "a", name: "Coder" },
        { id: "b", name: "Reviewer" },
        { id: "c", name: "Tester" },
      ],
    });
    expect((html.match(/va-team__chip/g) ?? []).length).toBe(3);
    expect(html).toContain("Coder、Reviewer、Tester");
  });

  it("VaModelWheel：轮盘徽标 + 中心文案", async () => {
    const html = await ssr(VaModelWheel, {
      models: [
        { id: "m1", name: "Claude" },
        { id: "m2", name: "GPT" },
        { id: "m3", name: "GLM" },
        { id: "m4", name: "Qwen" },
      ],
      centerLabel: "4 模型",
    });
    expect((html.match(/va-wheel__chip/g) ?? []).length).toBe(4);
    expect(html).toContain("4 模型");
  });
});
