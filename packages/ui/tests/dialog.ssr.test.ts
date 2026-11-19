/**
 * VaDialog SSR 冒烟：渲染不报错；open=false 不渲染弹层；open=true 渲染
 * role=dialog / aria-modal；title 通过 aria-labelledby 关联；无 title 时走 aria-label。
 *
 * 注意：Vue SSR 把 <Teleport> 内容渲染进 ctx.teleports[target] 缓冲（宿主负责合并输出），
 * 因此弹层断言读取 teleports["body"]（同 VaPopover 测试模式）。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaDialog } from "../src";

interface SsrCtx {
  teleports?: Record<string, string>;
}

async function ssr(props: Record<string, unknown>, slots: Record<string, () => string> = {}) {
  const app = createSSRApp({ render: () => h(VaDialog, props, slots) });
  const ctx: SsrCtx = {};
  const html = await renderToString(app, ctx);
  return { html, teleported: ctx.teleports?.["body"] ?? "" };
}

describe("VaDialog SSR", () => {
  it("默认（未开）不渲染弹层", async () => {
    const { teleported } = await ssr({ title: "标题" }, { default: () => "内容" });
    expect(teleported).not.toContain("内容");
    expect(teleported).not.toContain("role=\"dialog\"");
  });

  it("open=false：不渲染弹层（受控关闭）", async () => {
    const { teleported } = await ssr({ open: false, title: "标题" }, { default: () => "内容" });
    expect(teleported).not.toContain("内容");
    expect(teleported).not.toContain("va-dlg__overlay");
  });

  it("open=true：渲染 role=dialog + aria-modal=true 与内容", async () => {
    const { teleported } = await ssr({ open: true, title: "标题" }, { default: () => "内容" });
    expect(teleported).toContain("内容");
    expect(teleported).toContain('role="dialog"');
    expect(teleported).toContain('aria-modal="true"');
    expect(teleported).toContain("va-dlg__overlay");
    expect(teleported).toContain('data-state="open"');
  });

  it("title 通过 aria-labelledby 自动关联", async () => {
    const { teleported } = await ssr({ open: true, title: "删除确认" }, { default: () => "x" });
    const m = teleported.match(/aria-labelledby="([^"]+)"/);
    expect(m).toBeTruthy();
    const id = m![1];
    expect(teleported).toContain(`id="${id}"`);
    // 关联元素就是标题本身（SSR 的 slot 内容带 <!--[--> 注释包裹，故宽松匹配）
    expect(teleported).toMatch(new RegExp(`<h2[^>]*id="${id}"[^>]*>[\\s\\S]*?删除确认[\\s\\S]*?</h2>`));
  });

  it("role 可覆盖为 alertdialog（危险操作确认）", async () => {
    const { teleported } = await ssr({ open: true, title: "删除确认", role: "alertdialog" }, { default: () => "x" });
    expect(teleported).toContain('role="alertdialog"');
    expect(teleported).toContain('aria-modal="true"');
  });

  it("description 通过 aria-describedby 自动关联", async () => {
    const { teleported } = await ssr(
      { open: true, title: "标题", description: "这是一段描述" },
      { default: () => "x" },
    );
    const m = teleported.match(/aria-describedby="([^"]+)"/);
    expect(m).toBeTruthy();
    expect(teleported).toContain(`id="${m![1]}"`);
    expect(teleported).toContain("这是一段描述");
  });

  it("无 title 时通过 aria-label 提供可访问名（且不输出 labelledby）", async () => {
    const { teleported } = await ssr({ open: true, ariaLabel: "纯图标弹窗" }, { default: () => "x" });
    expect(teleported).toContain('aria-label="纯图标弹窗"');
    expect(teleported).not.toContain("aria-labelledby");
  });

  it("size 透传到面板类名", async () => {
    const { teleported } = await ssr({ open: true, title: "t", size: "lg" }, { default: () => "x" });
    expect(teleported).toContain("va-dlg--lg");
  });

  it("closable=false：不渲染关闭按钮", async () => {
    const { teleported } = await ssr({ open: true, title: "t", closable: false }, { default: () => "x" });
    expect(teleported).not.toContain("va-dlg__close");
  });

  it("header / footer 插槽渲染", async () => {
    const { teleported } = await ssr(
      { open: true, ariaLabel: "自定义" },
      { default: () => "主体", header: () => "自定义头部", footer: () => "底部按钮" },
    );
    expect(teleported).toContain("自定义头部");
    expect(teleported).toContain("底部按钮");
    expect(teleported).toContain("va-dlg__footer");
  });
});
