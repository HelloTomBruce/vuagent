/**
 * VaConfirmHost SSR 冒烟：无活动确认时不渲染任何内容（不残留弹层/标题/aria 角色）；
 * 服务端调用 vaConfirm 不抛错（无宿主 → fail-closed resolve false）。
 */
import { describe, expect, it, vi } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import VaConfirmHost from "../src/components/confirm/VaConfirmHost.vue";
import { vaConfirm } from "../src/components/confirm/confirm";

interface SsrCtx {
  teleports?: Record<string, string>;
}

async function ssr() {
  const app = createSSRApp({ render: () => h(VaConfirmHost) });
  const ctx: SsrCtx = {};
  const html = await renderToString(app, ctx);
  return { html, teleported: ctx.teleports?.["body"] ?? "" };
}

describe("VaConfirmHost SSR", () => {
  it("无活动确认时不渲染内容", async () => {
    const { html, teleported } = await ssr();
    expect(html).not.toContain("va-dlg");
    expect(html).not.toContain("alertdialog");
    expect(teleported).not.toContain("va-dlg");
    expect(teleported).not.toContain("va-confirm");
  });

  it("服务端无宿主调用 vaConfirm 不抛错并 fail-closed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(vaConfirm({ title: "ssr" })).resolves.toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
