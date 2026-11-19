/**
 * VaPopover SSR 冒烟：渲染不报错；open=false 不渲染浮层；open=true 渲染且带定位样式；
 * 浮层容器保持语义中立（无 role，由消费组件声明）。
 *
 * 注意：Vue SSR 把 <Teleport> 内容渲染进 ctx.teleports[target] 缓冲（宿主负责合并输出），
 * 因此浮层断言读取 teleports["body"]，触发器等非传送内容断言主 html。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaPopover } from "../src";

interface SsrCtx {
  teleports?: Record<string, string>;
}

async function ssr(props: Record<string, unknown>, slots: Record<string, () => string> = {}) {
  const app = createSSRApp({ render: () => h(VaPopover, props, slots) });
  const ctx: SsrCtx = {};
  const html = await renderToString(app, ctx);
  return { html, teleported: ctx.teleports?.["body"] ?? "" };
}

describe("VaPopover SSR", () => {
  it("默认（未开）不渲染浮层内容", async () => {
    // 注：Teleport 缓冲恒含锚点注释，关闭态只断言无浮层标记与内容
    const { html, teleported } = await ssr({}, { default: () => "面板内容" });
    expect(html).not.toContain("面板内容");
    expect(teleported).not.toContain("面板内容");
    expect(teleported).not.toContain('class="va-pop"');
  });

  it("open=true：渲染浮层且带定位样式（position/top/left）", async () => {
    const { teleported } = await ssr({ open: true }, { default: () => "面板内容" });
    expect(teleported).toContain("面板内容");
    expect(teleported).toContain("va-pop");
    expect(teleported).toMatch(/style="[^"]*position:\s*fixed/);
    expect(teleported).toMatch(/style="[^"]*top:/);
    expect(teleported).toMatch(/style="[^"]*left:/);
    expect(teleported).toContain('data-placement="bottom-start"');
  });

  it("open=false：不渲染浮层（受控关闭）", async () => {
    const { teleported } = await ssr({ open: false }, { default: () => "面板内容" });
    expect(teleported).not.toContain("面板内容");
    expect(teleported).not.toContain('class="va-pop"');
  });

  it("浮层容器无额外 role（语义由消费组件声明）", async () => {
    const { teleported } = await ssr({ open: true }, { default: () => "x" });
    expect(teleported).not.toContain("role=");
  });

  it("defaultOpen：非受控初始打开", async () => {
    const { teleported } = await ssr({ defaultOpen: true }, { default: () => "初始开" });
    expect(teleported).toContain("初始开");
  });

  it("trigger 插槽：渲染触发器包装元素，未开时不渲染浮层", async () => {
    const { html, teleported } = await ssr({}, { trigger: () => "触发器", default: () => "面板" });
    expect(html).toContain("触发器");
    expect(html).toContain("va-pop__trigger");
    expect(teleported).not.toContain("面板");
  });

  it("placement 透传到 data-placement", async () => {
    const { teleported } = await ssr({ open: true, placement: "top-end" }, { default: () => "x" });
    expect(teleported).toContain('data-placement="top-end"');
  });
});
