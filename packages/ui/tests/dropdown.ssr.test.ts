/**
 * VaDropdown SSR 冒烟：
 * - 关闭态：触发器 aria-haspopup=menu + aria-expanded=false，不渲染浮层
 * - 打开态（defaultOpen）：菜单 role=menu、项 role=menuitem + aria-disabled、
 *   divider 渲染为 role=separator、子菜单入口 aria-haspopup=menu、danger/checked/shortcut
 * 注意：浮层经 Teleport 渲染进 ctx.teleports["body"]（同 VaPopover/VaSelect SSR 测试）。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaDropdown } from "../src";
import type { DropdownItem } from "../src";

interface SsrCtx {
  teleports?: Record<string, string>;
}

const ITEMS: DropdownItem[] = [
  { id: "edit", label: "编辑", icon: "✎", shortcut: "⌘E" },
  { id: "copy", label: "复制", checked: true },
  { id: "disabled", label: "禁用项", disabled: true },
  { id: "div1", divider: true },
  {
    id: "share",
    label: "分享",
    children: [
      { id: "share-link", label: "复制链接" },
      { id: "share-mail", label: "邮件发送" },
    ],
  },
  { id: "delete", label: "删除", danger: true },
];

async function ssr(props: Record<string, unknown>, slots: Record<string, (p: unknown) => string> = {}) {
  const app = createSSRApp({ render: () => h(VaDropdown, props, slots) });
  const ctx: SsrCtx = {};
  const html = await renderToString(app, ctx);
  return { html, teleported: ctx.teleports?.["body"] ?? "" };
}

describe("VaDropdown SSR", () => {
  it("关闭态：渲染 aria-haspopup=menu 触发器（默认三点图标），不渲染菜单", async () => {
    const { html, teleported } = await ssr({ items: ITEMS });
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("va-dd__icon"); // 默认垂直三点
    expect(teleported).not.toContain('role="menu"');
  });

  it("打开态：菜单 role=menu + 项 role=menuitem", async () => {
    const { teleported } = await ssr({ items: ITEMS, defaultOpen: true });
    expect(teleported).toContain('role="menu"');
    expect(teleported).toContain('role="menuitem"');
    expect(teleported).toContain("编辑");
    expect(teleported).toContain("va-dd__menu");
  });

  it("打开态：divider 渲染为 role=separator，且不算 menuitem", async () => {
    const { teleported } = await ssr({ items: ITEMS, defaultOpen: true });
    expect(teleported).toContain('role="separator"');
    expect(teleported).toContain("va-dd__divider");
    // 5 个真实项（edit/copy/disabled/share/delete），divider 不在其中
    expect(teleported.match(/role="menuitem"/g)?.length).toBe(5);
  });

  it("打开态：disabled 项带 aria-disabled 且原生 disabled", async () => {
    const { teleported } = await ssr({ items: ITEMS, defaultOpen: true });
    expect(teleported).toMatch(/aria-disabled="true"[\s\S]{0,300}禁用项/);
    expect(teleported).toMatch(/aria-disabled="true" disabled[\s\S]{0,300}禁用项/);
  });

  it("打开态：子菜单入口 aria-haspopup=menu；子菜单默认不展开", async () => {
    const { teleported } = await ssr({ items: ITEMS, defaultOpen: true });
    expect(teleported).toMatch(/aria-haspopup="menu"[\s\S]{0,200}分享/);
    expect(teleported).toContain("va-dd__sub-arrow");
    // 子菜单未展开：不渲染子项
    expect(teleported).not.toContain("复制链接");
  });

  it("打开态：danger 项 / checked 项 / shortcut / group 渲染", async () => {
    const items: DropdownItem[] = [
      { id: "a", label: "常规", group: "操作" },
      { id: "b", label: "已选", checked: true },
      { id: "c", label: "危险", danger: true, shortcut: "⌫" },
    ];
    const { teleported } = await ssr({ items, defaultOpen: true });
    expect(teleported).toMatch(/data-danger[\s\S]{0,200}危险/);
    expect(teleported).toMatch(/va-dd__check[\s\S]{0,60}✓/);
    expect(teleported).toContain("va-dd__shortcut");
    expect(teleported).toContain("va-dd__group");
    expect(teleported).toContain("操作");
  });

  it("triggerLabel：无图标时渲染文字按钮并作为可访问名", async () => {
    const { html } = await ssr({ items: ITEMS, triggerLabel: "操作" });
    expect(html).toContain("操作");
    expect(html).toContain("va-dd__chev");
    // 有文字时不再渲染默认图标
    expect(html).not.toContain("va-dd__icon");
  });

  it("图标态：aria-label 兜底为「更多操作」，可用 ariaLabel 覆盖", async () => {
    const { html } = await ssr({ items: ITEMS });
    expect(html).toContain('aria-label="更多操作"');
    const custom = await ssr({ items: ITEMS, ariaLabel: "行操作" });
    expect(custom.html).toContain('aria-label="行操作"');
  });

  it("disabled：触发器原生 disabled", async () => {
    const { html } = await ssr({ items: ITEMS, disabled: true });
    expect(html).toMatch(/va-dd__trigger[^>]*disabled/);
  });

  it("受控 open=true：SSR 直接渲染打开态菜单", async () => {
    const { teleported } = await ssr({ items: ITEMS, open: true });
    expect(teleported).toContain('role="menu"');
  });
});
