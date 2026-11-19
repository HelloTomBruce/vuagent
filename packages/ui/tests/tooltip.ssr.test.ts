/**
 * VaTooltip SSR 冒烟：渲染不报错；未触发时不渲染提示内容（无 role=tooltip）；
 * disabled 同样无任何浮层输出；SSR 不输出 aria-describedby（浮层不存在，避免悬空引用）。
 *
 * 注：tooltip 无受控 open，SSR 下没有任何打开途径（hover/focus 只在浏览器发生），
 * 因此 SSR 输出恒为「仅触发器」。Teleport 缓冲断言同 popover.ssr.test.ts。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaTooltip } from "../src";

interface SsrCtx {
  teleports?: Record<string, string>;
}

async function ssr(props: Record<string, unknown>, slots: Record<string, () => string> = {}) {
  const app = createSSRApp({ render: () => h(VaTooltip, props, slots) });
  const ctx: SsrCtx = {};
  const html = await renderToString(app, ctx);
  return { html, teleported: ctx.teleports?.["body"] ?? "" };
}

describe("VaTooltip SSR", () => {
  it("渲染触发器但不渲染提示内容（未触发）", async () => {
    const { html, teleported } = await ssr(
      { content: "保存更改" },
      { default: () => "<button>保存</button>" },
    );
    expect(html).toContain("保存");
    expect(html).toContain("va-tip__trigger");
    expect(teleported).not.toContain("保存更改");
    expect(teleported).not.toContain('role="tooltip"');
    expect(teleported).not.toContain("va-tip");
  });

  it("disabled：同样不渲染任何浮层内容，触发器带 data-disabled", async () => {
    const { html, teleported } = await ssr(
      { content: "提示", disabled: true },
      { default: () => "<button>按钮</button>" },
    );
    expect(html).toContain("data-disabled");
    expect(teleported).not.toContain('role="tooltip"');
    expect(teleported).not.toContain("va-tip");
  });

  it("SSR 不输出 aria-describedby（浮层尚未存在，引用会悬空）", async () => {
    const { html } = await ssr({ content: "提示" }, { default: () => "<button>按钮</button>" });
    expect(html).not.toContain("aria-describedby");
  });

  it("#content 插槽内容同样只在打开后才渲染", async () => {
    const { html, teleported } = await ssr(
      {},
      { default: () => "<button>按钮</button>", content: () => "<b>加粗提示</b>" },
    );
    expect(html).not.toContain("加粗提示");
    expect(teleported).not.toContain("加粗提示");
  });
});
