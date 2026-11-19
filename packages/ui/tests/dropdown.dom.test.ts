/**
 * VaDropdown 交互测试（happy-dom 真实挂载）：
 * 点击切换、键盘 ↑↓/Home/End 导航、Enter/Space 发 select 事件、→/← 展开收起子菜单、
 * Esc 关闭并还原焦点、Tab 关闭、contextmenu 虚拟锚点打开、disabled/danger/keepOpenOnSelect。
 * 菜单经 Teleport 落地 document.body，用 document 查询（同 VaPopover/VaSelect 测试模式）。
 * Esc 由组件在 document 上统一监听（子菜单 Teleport 后父菜单容器收不到其按键）。
 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import VaDropdown from "../src/components/dropdown/VaDropdown.vue";
import type { DropdownItem } from "../src/components/dropdown/types";

const ITEMS: DropdownItem[] = [
  { id: "edit", label: "编辑", shortcut: "⌘E" },
  { id: "copy", label: "复制", disabled: true },
  { id: "div1", divider: true },
  {
    id: "share",
    label: "分享",
    children: [
      { id: "share-link", label: "复制链接" },
      { id: "share-mail", label: "邮件发送", disabled: true },
    ],
  },
  { id: "delete", label: "删除", danger: true },
];

const menuEl = () => document.body.querySelector<HTMLElement>('.va-dd__menu[role="menu"]');
const menuEls = () => [...document.body.querySelectorAll<HTMLElement>('.va-dd__menu[role="menu"]')];
const itemEls = () => [...document.body.querySelectorAll<HTMLElement>('.va-dd__item[role="menuitem"]')];
const activeEl = () => document.body.querySelector<HTMLElement>(".va-dd__item[data-active]");
const itemByText = (text: string) => itemEls().find((el) => el.textContent?.includes(text));

const keydown = (el: Element | Document, key: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

/** 登记挂载的 wrapper，用例结束统一 unmount（手动清 body 会让存活实例的 Teleport patch 崩溃） */
const mounted: VueWrapper[] = [];
function track<T extends VueWrapper>(w: T): T {
  mounted.push(w);
  return w;
}

const settle = async () => {
  await nextTick();
  await nextTick();
};

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("VaDropdown 交互", () => {
  it("click 触发：点击打开/再点关闭，派发 update:open / open / close", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    const trigger = wrapper.find(".va-dd__trigger");
    expect(menuEl()).toBeNull();

    await trigger.trigger("click");
    await settle();
    expect(menuEl()).not.toBeNull();
    expect(wrapper.emitted("update:open")).toEqual([[true]]);
    expect(wrapper.emitted("open")).toHaveLength(1);
    // 打开后焦点进入菜单（首个可用项）
    expect(document.activeElement?.textContent).toContain("编辑");
    expect(activeEl()?.textContent).toContain("编辑");

    await trigger.trigger("click");
    await settle();
    expect(menuEl()).toBeNull();
    expect(wrapper.emitted("update:open")).toEqual([[true], [false]]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("键盘 ↑↓ 导航跳过 disabled 与 divider，Enter 派发 select 并关闭", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    const trigger = wrapper.find(".va-dd__trigger");
    await trigger.trigger("keydown", { key: "ArrowDown" }); // 关闭态 ↓ 打开
    await settle();
    expect(menuEl()).not.toBeNull();
    expect(activeEl()?.textContent).toContain("编辑");

    keydown(menuEl()!, "ArrowDown"); // 跳过 disabled 的「复制」与 divider → 分享
    await settle();
    expect(activeEl()?.textContent).toContain("分享");

    keydown(menuEl()!, "ArrowUp"); // 回到编辑
    await settle();
    expect(activeEl()?.textContent).toContain("编辑");

    keydown(menuEl()!, "Enter");
    await settle();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ id: "edit" });
    expect(menuEl()).toBeNull(); // 选中后自动关闭
    expect(wrapper.emitted("update:open")).toEqual([[true], [false]]);
  });

  it("Space 选中；Home/End 跳到首个/末个可用项", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();

    keydown(menuEl()!, "End"); // 末项 = 删除
    await settle();
    expect(activeEl()?.textContent).toContain("删除");

    keydown(menuEl()!, "Home");
    await settle();
    expect(activeEl()?.textContent).toContain("编辑");

    keydown(menuEl()!, " ");
    await settle();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ id: "edit" });
  });

  it("disabled 项点击不触发 select、不关闭；danger 项可正常选中", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();

    const disabled = itemByText("复制")!;
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    disabled.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(wrapper.emitted("select")).toBeUndefined();
    expect(menuEl()).not.toBeNull();

    const danger = itemByText("删除")!;
    expect(danger.hasAttribute("data-danger")).toBe(true);
    danger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ id: "delete" });
    expect(menuEl()).toBeNull();
  });

  it("→ 展开子菜单（Enter 同理）并选中子项；← 收起回父菜单", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();

    keydown(menuEl()!, "ArrowDown"); // 编辑 → 分享（跳过 disabled/divider）
    await settle();
    expect(activeEl()?.textContent).toContain("分享");

    keydown(menuEl()!, "ArrowRight"); // 展开子菜单
    await settle();
    expect(menuEls().length).toBe(2); // 主菜单 + 子菜单
    expect(document.activeElement?.textContent).toContain("复制链接");

    keydown(menuEls()[1], "ArrowDown"); // 跳过 disabled 的邮件发送 → 回到复制链接（循环）
    await settle();
    expect(document.activeElement?.textContent).toContain("复制链接");

    keydown(menuEls()[1], "Enter"); // 选中子项
    await settle();
    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ id: "share-link" });
    expect(menuEl()).toBeNull(); // 选中子项关闭整个菜单
  });

  it("子菜单入口点击展开；← 收起并把焦点还回入口项", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();

    itemByText("分享")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(menuEls().length).toBe(2);

    keydown(menuEls()[1], "ArrowLeft"); // 收起
    await settle();
    expect(menuEls().length).toBe(1);
    expect(document.activeElement?.textContent).toContain("分享");
  });

  it("Esc 关闭整个菜单（含已展开子菜单）并还原焦点到触发器", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS }, attachTo: document.body }));
    const trigger = wrapper.find(".va-dd__trigger");
    (trigger.element as HTMLElement).focus();
    await trigger.trigger("click");
    await settle();

    keydown(menuEl()!, "ArrowDown"); // → 分享
    await settle();
    keydown(menuEl()!, "ArrowRight"); // 展开子菜单
    await settle();
    expect(menuEls().length).toBe(2);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await settle();
    expect(menuEl()).toBeNull();
    expect(document.activeElement).toBe(trigger.element); // 焦点还原
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("Tab 关闭菜单（不拦截焦点）", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();
    keydown(menuEl()!, "Tab");
    await settle();
    expect(menuEl()).toBeNull();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("contextmenu 模式：右键以鼠标位置为虚拟锚点打开，左键点击不开", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS, trigger: "contextmenu" } }));
    const zone = wrapper.find(".va-dd");

    await zone.trigger("click"); // 左键：不开
    await settle();
    expect(menuEl()).toBeNull();

    zone.element.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 24, clientY: 40 }),
    );
    await settle();
    const menu = menuEl();
    expect(menu).not.toBeNull();
    expect(wrapper.emitted("open")).toHaveLength(1);
    // 虚拟锚点定位：浮层容器带内联 top/left（happy-dom 下浮层尺寸为 0，坐标即锚点）
    const pop = menu.closest(".va-pop") as HTMLElement;
    expect(pop.style.position).toBe("fixed");
    expect(pop.style.top).toBeTruthy();
    expect(pop.style.left).toBeTruthy();

    // 再次右键：仅重定位，不重复派发 open 事件
    zone.element.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 96 }),
    );
    await settle();
    expect(menuEl()).not.toBeNull();
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("manual 模式：trigger 点击/键盘均不开，expose open() 打开", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS, trigger: "manual" } }));
    const zone = wrapper.find(".va-dd");
    await zone.trigger("click");
    await zone.trigger("keydown", { key: "ArrowDown" });
    await settle();
    expect(menuEl()).toBeNull();

    (wrapper.vm as unknown as { open: () => void }).open();
    await settle();
    expect(menuEl()).not.toBeNull();
    (wrapper.vm as unknown as { close: () => void }).close();
    await settle();
    expect(menuEl()).toBeNull();
  });

  it("keepOpenOnSelect：选中后保持打开", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS, keepOpenOnSelect: true } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();
    keydown(menuEl()!, "Enter"); // 选中编辑
    await settle();
    expect(wrapper.emitted("select")).toHaveLength(1);
    expect(menuEl()).not.toBeNull(); // 保持打开
  });

  it("外部 mousedown 关闭；点菜单内部不关（含子菜单）", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();

    menuEl()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(menuEl()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    expect(menuEl()).toBeNull();
  });

  it("受控 open：内部交互只发事件，不擅自改状态", async () => {
    const wrapper = track(mount(VaDropdown, { props: { items: ITEMS, open: true } }));
    await settle();
    expect(menuEl()).not.toBeNull();

    keydown(menuEl()!, "Enter"); // 选中 → 发 select + update:open(false)，但父级未同步仍开
    await settle();
    expect(wrapper.emitted("select")).toHaveLength(1);
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(menuEl()).not.toBeNull();
  });

  it("group 组标题渲染且不参与键盘导航", async () => {
    const items: DropdownItem[] = [
      { id: "a", label: "甲", group: "操作" },
      { id: "b", label: "乙", group: "操作" },
    ];
    const wrapper = track(mount(VaDropdown, { props: { items } }));
    await wrapper.find(".va-dd__trigger").trigger("click");
    await settle();
    expect(menuEl()!.querySelector(".va-dd__group")?.textContent).toBe("操作");
    expect(menuEl()!.querySelectorAll(".va-dd__group").length).toBe(1); // 相邻同组只渲染一次
    expect(itemEls().length).toBe(2);

    keydown(menuEl()!, "End");
    await settle();
    expect(activeEl()?.textContent).toContain("乙");
  });

  it("自定义 trigger 插槽：插槽内容不绑 click，点击冒泡到包装元素完成切换", async () => {
    // 约定回归（OverlayDemo 踩坑）：trigger 插槽内元素不要再绑 @click="toggle"——
    // 点击会先命中内层 toggle（开）再冒泡到 .va-pop__trigger 的 toggle（关），
    // 同一次点击开+关，表现为「点击没反应」。正确用法是插槽内容保持无 click 绑定。
    const wrapper = track(
      mount(VaDropdown, {
        props: { items: ITEMS },
        slots: {
          trigger: `<button class="my-trigger" type="button">自定义触发器</button>`,
        },
      }),
    );
    await wrapper.find(".my-trigger").trigger("click");
    await settle();
    expect(menuEl()).not.toBeNull();
    expect(wrapper.emitted("open")).toHaveLength(1);

    await wrapper.find(".my-trigger").trigger("click");
    await settle();
    expect(menuEl()).toBeNull();
    expect(wrapper.emitted("close")).toHaveLength(1);
  });
});
