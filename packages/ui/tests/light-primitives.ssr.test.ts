/**
 * 光影渐变原语三件 SSR smoke（TASK-109）：无 window 环境渲染不炸（光斑/环境检测降级路径）、
 * 变体类与变量绑定进 HTML、warn 静默（无非法 prop 告警）。
 * 默认 vitest node 环境（无 window）即天然覆盖 SSR 路径。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaGradientBorder, VaScrimEdge, VaSpotlightCard } from "../src";

async function ssr(component: Component, props: Record<string, unknown> = {}, slot?: () => unknown) {
  const warn: string[] = [];
  const app = createSSRApp({ render: () => h(component, props, slot) });
  app.config.warnHandler = (msg) => warn.push(msg);
  return { html: await renderToString(app), warn };
}

describe("光影原语 SSR 渲染（无 window）", () => {
  it("VaSpotlightCard：修饰类默认齐备 + slot；spot:false 分支不挂光斑类", async () => {
    const { html, warn } = await ssr(VaSpotlightCard, {}, () => h("p", "聚光内容"));
    expect(warn).toEqual([]);
    expect(html).toContain("va-spot-card--glow");
    expect(html).toContain("va-spot-card--spot");
    expect(html).toContain("va-spot-card--e4");
    expect(html).toContain("聚光内容");

    const off = await ssr(VaSpotlightCard, { glow: false, spot: false, elevation: 3 });
    expect(off.html).toContain("va-spot-card--e3");
    expect(off.html).not.toContain("va-spot-card--glow");
    expect(off.html).not.toContain("va-spot-card--spot");
  });

  it("VaScrimEdge：方向类 + 变量绑定 + aria-hidden；四向分支", async () => {
    const { html, warn } = await ssr(VaScrimEdge, { direction: "top", height: 96 });
    expect(warn).toEqual([]);
    expect(html).toContain("va-scrim-edge--top");
    expect(html).toContain("--va-scrim-edge-h:96px");
    expect(html).toContain('aria-hidden="true"');
    for (const d of ["bottom", "left", "right"]) {
      const one = await ssr(VaScrimEdge, { direction: d as "bottom" });
      expect(one.html).toContain(`va-scrim-edge--${d}`);
    }
  });

  it("VaGradientBorder：static 缺省 + running/speed 分支；slot 渲染", async () => {
    const { html, warn } = await ssr(VaGradientBorder, {}, () => h("span", "边框内容"));
    expect(warn).toEqual([]);
    expect(html).toContain("va-gborder--static");
    expect(html).toContain("--va-gb-from:var(--va-grad-accent-from, #c2410c)");
    expect(html).toContain("边框内容");

    const running = await ssr(VaGradientBorder, { variant: "running", speed: 2400, width: 2 });
    expect(running.html).toContain("va-gborder--running");
    expect(running.html).toContain("--va-gb-speed:2400ms");
    expect(running.html).toContain("--va-gb-w:2px");
  });
});
