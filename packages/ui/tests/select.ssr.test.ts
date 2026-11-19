/**
 * VaSelect SSR 冒烟：
 * - 关闭态：触发器 role=combobox + aria-expanded=false + placeholder，不渲染浮层
 * - 打开态（defaultOpen）：浮层 role=listbox、选项 role=option + aria-selected/aria-disabled、
 *   分组 role=group + 组标题、多选 aria-multiselectable、searchable 搜索框
 * 注意：浮层经 Teleport 渲染进 ctx.teleports["body"]（同 VaPopover SSR 测试）。
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { VaSelect } from "../src";
import type { SelectOption } from "../src";

interface SsrCtx {
  teleports?: Record<string, string>;
}

const OPTIONS: SelectOption[] = [
  { value: "apple", label: "苹果" },
  { value: "banana", label: "香蕉", disabled: true },
  { value: "cherry", label: "樱桃", group: "浆果" },
  { value: "grape", label: "葡萄", group: "浆果" },
];

async function ssr(props: Record<string, unknown>, slots: Record<string, (p: unknown) => string> = {}) {
  const app = createSSRApp({ render: () => h(VaSelect, props, slots) });
  const ctx: SsrCtx = {};
  const html = await renderToString(app, ctx);
  return { html, teleported: ctx.teleports?.["body"] ?? "" };
}

describe("VaSelect SSR", () => {
  it("关闭态：渲染 role=combobox 触发器 + placeholder，不渲染浮层", async () => {
    const { html, teleported } = await ssr({ options: OPTIONS });
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("请选择");
    expect(teleported).not.toContain('role="listbox"');
  });

  it("打开态：渲染 role=listbox 与 role=option + aria-selected / aria-disabled", async () => {
    const { teleported } = await ssr({ options: OPTIONS, defaultOpen: true, modelValue: "apple" });
    expect(teleported).toContain('role="listbox"');
    // 选中项（SSR 输出含 <!----> 注释节点，用宽松断言）
    expect(teleported).toMatch(/aria-selected="true"[\s\S]{0,300}苹果/);
    // 未选中项
    expect(teleported).toContain('aria-selected="false"');
    // disabled 项
    expect(teleported).toMatch(/aria-disabled="true"[\s\S]{0,300}香蕉/);
  });

  it("打开态：分组渲染 role=group + 组标题", async () => {
    const { teleported } = await ssr({ options: OPTIONS, defaultOpen: true });
    expect(teleported).toContain('role="group"');
    expect(teleported).toContain("浆果");
    expect(teleported).toContain("va-sel__group-title");
  });

  it("多选：listbox 带 aria-multiselectable，选项渲染勾选框", async () => {
    const { teleported } = await ssr({
      options: OPTIONS,
      defaultOpen: true,
      multiple: true,
      modelValue: ["apple", "cherry"],
    });
    expect(teleported).toContain('aria-multiselectable="true"');
    expect(teleported).toContain("va-sel__check");
    // 两个选中项 aria-selected=true
    expect(teleported.match(/aria-selected="true"/g)?.length).toBe(2);
  });

  it("searchable：渲染搜索输入", async () => {
    const { teleported } = await ssr({ options: OPTIONS, defaultOpen: true, searchable: true });
    expect(teleported).toContain("va-sel__search-input");
  });

  it("invalid / disabled / 自定义 label 透传到触发器 aria", async () => {
    const { html } = await ssr({ options: OPTIONS, invalid: true, label: "水果" });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-label="水果"');
    const dis = await ssr({ options: OPTIONS, disabled: true });
    expect(dis.html).toContain("disabled");
  });

  it("受控回显：modelValue 对应的 label 显示在触发器", async () => {
    const { html } = await ssr({ options: OPTIONS, modelValue: "cherry" });
    expect(html).toContain("樱桃");
  });
});
