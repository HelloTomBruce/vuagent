/**
 * M7 图表组件 SSR smoke：纯计算渲染（无 DOM 依赖），SSR 天然安全。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "@vue/server-renderer";
import {
  VaAiAnswer,
  VaBreakdownChart,
  VaCompactBreakdown,
  VaExperimentCard,
  VaKpiChart,
} from "../src";

async function ssr(component: Component, props: Record<string, unknown> = {}) {
  const warn: string[] = [];
  const app = createSSRApp({ render: () => h(component, props) });
  app.config.warnHandler = (msg) => warn.push(msg);
  return { html: await renderToString(app), warn };
}

describe("M7 图表 SSR 渲染", () => {
  it("VaKpiChart：数值/涨跌徽章/sparkline path", async () => {
    const { html, warn } = await ssr(VaKpiChart, {
      label: "今日 agent 运行",
      value: 1284,
      delta: 0.12,
      deltaLabel: "较上周",
      series: [8, 12, 9, 15, 14, 18],
    });
    expect(warn).toEqual([]);
    expect(html).toContain("1,284");
    expect(html).toContain("+12%");
    expect(html).toContain("data-good=\"true\"");
    expect(html).toMatch(/<path[^>]*stroke/); // sparkline 线
    expect(html).toMatch(/aria-label="今日 agent 运行/);
  });

  it("VaKpiChart：跌=好（invertDelta）与跌=坏两种着色", async () => {
    const err = await ssr(VaKpiChart, { label: "错误率", value: 0.03, delta: -0.4, series: [5, 4, 3] });
    expect(err.html).toContain("−40%");
    const good = await ssr(VaKpiChart, {
      label: "错误率",
      value: 0.03,
      delta: -0.4,
      invertDelta: true,
      series: [5, 4, 3],
    });
    expect(good.html).toContain('data-good="true"');
    expect(err.html).toContain('data-good="false"');
  });

  it("VaBreakdownChart：降序 + 条宽 + maxRows 折叠", async () => {
    const { html } = await ssr(VaBreakdownChart, {
      items: [
        { label: "代码审查", value: 40 },
        { label: "构建", value: 35 },
        { label: "测试", value: 15 },
        { label: "文档", value: 10 },
      ],
      unit: "次",
      maxRows: 3,
    });
    expect(html).toContain("代码审查");
    expect(html).toContain("其他"); // 3+1 折叠
    expect(html).not.toContain("测试"); // 被折叠进"其他"
    expect(html).toContain("次");
  });

  it("VaCompactBreakdown：堆叠段 + 图例百分比", async () => {
    const { html } = await ssr(VaCompactBreakdown, {
      segments: [
        { label: "Fast", value: 600 },
        { label: "Slow", value: 300 },
        { label: "失败", value: 100 },
      ],
    });
    expect((html.match(/va-cbd__seg/g) ?? []).length).toBe(3);
    expect(html).toContain("60%");
    expect(html).toContain("10%");
  });

  it("VaExperimentCard：胜者标记 + 置信度结论", async () => {
    const done = await ssr(VaExperimentCard, {
      title: "提示词改写实验",
      metric: "任务完成率",
      status: "success",
      confidence: 0.97,
      variants: [
        { id: "a", name: "对照组", value: 0.62, format: { style: "percent" } },
        { id: "b", name: "改写版", value: 0.71, delta: 0.145, format: { style: "percent" } },
      ],
    });
    expect(done.html).toContain("data-winner=\"true\"");
    expect(done.html).toContain("「改写版」胜出");
    expect(done.html).toContain("97%");
    // 未达显著
    const weak = await ssr(VaExperimentCard, {
      title: "实验",
      metric: "完成率",
      status: "success",
      confidence: 0.8,
      variants: [
        { id: "a", name: "A", value: 0.5 },
        { id: "b", name: "B", value: 0.52 },
      ],
    });
    expect(weak.html).toContain("未达显著");
  });

  it("VaAiAnswer：[n] 角标 + 来源列表 + 无来源标记保留", async () => {
    const { html } = await ssr(VaAiAnswer, {
      question: "vuagent 怎么装？",
      answer: "通过 registry 安装[1]，或直接 npm 安装[2]。详见未知引用[9]。",
      sources: [
        { id: "s1", title: "快速开始 · registry", origin: "vuagent.dev" },
        { id: "s2", title: "npm @vuagent/ui", origin: "npmjs.com" },
      ],
    });
    expect(html).toContain("va-ans__cite");
    expect((html.match(/va-ans__cite/g) ?? []).length).toBe(2);
    expect(html).toContain("[9]"); // 越界标记原样保留
    expect(html).toContain("npmjs.com");
  });

  it("VaAiAnswer：流式光标", async () => {
    const { html } = await ssr(VaAiAnswer, {
      answer: "正在思考",
      sources: [],
      streaming: true,
    });
    expect(html).toContain("va-ans__cursor");
    expect(html).toContain("正在生成回答");
  });
});
