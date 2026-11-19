/**
 * VaConfirm 交互测试（happy-dom 真实挂载）：
 * Promise 化（确认/取消分别 resolve true/false）、alertdialog 语义与安全初始焦点、
 * requireText 手输校验（不匹配 disabled）、并发调用队列串行、checkboxLabel 结果、
 * closeAll 全部拒绝、无宿主时开发期警告 + fail-closed。
 *
 * VaDialog 把弹层 Teleport 到 document.body，因此断言一律走 document 查询。
 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import VaConfirmHost from "../src/components/confirm/VaConfirmHost.vue";
import { vaConfirm } from "../src/components/confirm/confirm";

/** VaDialog 内在过渡时长（--va-dur-2 = 200ms）+ 余量 */
const ANIM_WAIT = 260;

const overlayEl = () => document.body.querySelector<HTMLElement>(".va-dlg__overlay");
const panelEl = () => document.body.querySelector<HTMLElement>(".va-dlg");
const titleText = () => document.body.querySelector(".va-confirm__title")?.textContent?.trim();
const button = (kind: "confirm" | "cancel") =>
  document.body.querySelector<HTMLButtonElement>(`.va-confirm__btn--${kind}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 等渲染 + openLifecycle 的多级 nextTick 链 + 焦点激活（每次 nextTick 推进一级） */
const settle = async () => {
  for (let i = 0; i < 8; i++) await nextTick();
};

let wrapper: VueWrapper | null = null;

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
  await settle();
});

describe("VaConfirm - Promise 与语义", () => {
  it("确认按钮 resolve(true)；渲染为 role=alertdialog 且确认按钮初始聚焦", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const promise = vaConfirm({
      title: "删除这个会话？",
      description: "此操作不可撤销。",
      confirmText: "删除",
      icon: true,
    });
    expect(promise).toBeInstanceOf(Promise);
    await settle();

    expect(panelEl()?.getAttribute("role")).toBe("alertdialog");
    expect(panelEl()?.getAttribute("aria-modal")).toBe("true");
    expect(titleText()).toBe("删除这个会话？");
    expect(document.body.textContent).toContain("此操作不可撤销。");
    // 非危险 tone：初始焦点在确认按钮（用户可键盘直接确认）
    expect(document.activeElement).toBe(button("confirm"));

    button("confirm")!.click();
    await expect(promise).resolves.toBe(true);
    expect(vaConfirm.details).toEqual({ ok: true, checked: false });
  });

  it("取消按钮 resolve(false)", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const promise = vaConfirm({ title: "取消测试" });
    await settle();
    button("cancel")!.click();
    await expect(promise).resolves.toBe(false);
    expect(vaConfirm.details).toEqual({ ok: false, checked: false });
  });

  it("danger tone：确认按钮危险样式，初始焦点落在取消按钮（安全默认）", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const promise = vaConfirm({ title: "删除仓库", tone: "danger" });
    await settle();

    const confirm = button("confirm")!;
    expect(confirm.classList.contains("va-confirm__btn--danger")).toBe(true);
    expect(document.activeElement).toBe(button("cancel"));

    button("cancel")!.click();
    await expect(promise).resolves.toBe(false);
  });

  it("Esc = 取消（resolve false）", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const promise = vaConfirm({ title: "Esc 取消" });
    await settle();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(promise).resolves.toBe(false);
    expect(overlayEl()?.getAttribute("data-state")).toBe("closed");
  });

  it("遮罩点击 = 取消（resolve false）", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const promise = vaConfirm({ title: "遮罩取消" });
    await settle();

    overlayEl()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await expect(promise).resolves.toBe(false);
  });
});

describe("VaConfirm - requireText", () => {
  it("输入不匹配时确认按钮 disabled，匹配后可确认；初始焦点在输入框", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const promise = vaConfirm({
      title: "删除仓库",
      tone: "danger",
      requireText: "vuagent",
      confirmText: "删除",
    });
    await settle();

    const input = document.body.querySelector<HTMLInputElement>(".va-confirm__input")!;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    expect(button("confirm")!.disabled).toBe(true);

    input.value = "wrong";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(button("confirm")!.disabled).toBe(true);

    input.value = "vuagent";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    expect(button("confirm")!.disabled).toBe(false);

    button("confirm")!.click();
    await expect(promise).resolves.toBe(true);
  });
});

describe("VaConfirm - 队列与结果", () => {
  it("并发调用串行展示、不互相覆盖", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const first = vaConfirm({ title: "第一个" });
    await settle();
    const second = vaConfirm({ title: "第二个" });
    await settle();

    // 只展示队首，第二个在排队
    expect(titleText()).toBe("第一个");
    expect(document.body.querySelectorAll(".va-dlg").length).toBe(1);

    button("confirm")!.click();
    await expect(first).resolves.toBe(true);

    // 等退出动画结束，队首换成第二个
    await sleep(ANIM_WAIT);
    await settle();
    expect(titleText()).toBe("第二个");

    button("cancel")!.click();
    await expect(second).resolves.toBe(false);
  });

  it("checkboxLabel 勾选态经 vaConfirm.details 返回（Promise 仍只返回 ok）", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const promise = vaConfirm({ title: "删除分支", checkboxLabel: "同时删除远程分支" });
    await settle();

    const checkbox = document.body.querySelector<HTMLInputElement>(".va-confirm__check input")!;
    expect(checkbox).toBeTruthy();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    await nextTick();

    button("confirm")!.click();
    await expect(promise).resolves.toBe(true);
    expect(vaConfirm.details).toEqual({ ok: true, checked: true });
  });

  it("closeAll() 拒绝全部待确认项并关闭弹窗", async () => {
    wrapper = mount(VaConfirmHost);
    await settle();

    const first = vaConfirm({ title: "一" });
    await settle();
    const second = vaConfirm({ title: "二" });
    await settle();

    vaConfirm.closeAll();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(vaConfirm.state.queue).toHaveLength(0);

    await sleep(ANIM_WAIT);
    await settle();
    expect(document.body.querySelector(".va-confirm__title")).toBeNull();
  });

  it("无宿主挂载时给出开发期警告并 fail-closed resolve(false)", async () => {
    // 不挂载宿主：hostCount = 0
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await vaConfirm({ title: "没有宿主" });
      expect(result).toBe(false);
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain("VaConfirmHost");
    } finally {
      warn.mockRestore();
    }
  });
});
