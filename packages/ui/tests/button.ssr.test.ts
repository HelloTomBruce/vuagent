/**
 * VaButton SSR smoke：变体/尺寸类与 loading 态语义。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaButton } from "../src";

async function ssr(props: Record<string, unknown>, slot = "按钮") {
  const app = createSSRApp({ render: () => h(VaButton, props, () => slot) });
  return renderToString(app);
}

describe("VaButton SSR", () => {
  it("默认渲染 primary/md 类", async () => {
    const html = await ssr({});
    expect(html).toContain("va-btn--primary");
    expect(html).toContain("va-btn--md");
    expect(html).toContain("按钮");
  });

  it("loading：aria-busy + 禁用（转圈走 CSS ::before 流内布局）", async () => {
    const html = await ssr({ loading: true }, "提交中…");
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/disabled/);
    expect(html).toContain("va-btn--loading");
    expect(html).toContain("提交中…");
  });

  it("loading=false 可点击，disabled 独立生效", async () => {
    const ok = await ssr({ loading: false });
    expect(ok).not.toContain("aria-busy");
    const off = await ssr({ disabled: true });
    expect(off).toMatch(/disabled/);
  });
});
