/**
 * VaDialog 交互测试（happy-dom 真实挂载）：
 * 焦点陷阱 Tab 循环、初始焦点、Esc 仅关栈顶、遮罩关闭、关闭后焦点恢复、
 * 滚动锁计数器、destroyOnClose 卸载语义、opened/closed 事件时序。
 * Teleport 真实落地 document.body，弹层用 document 查询。
 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import VaDialog from "../src/components/dialog/VaDialog.vue";

/** 组件内过渡时长（--va-dur-2 = 200ms）+ 余量 */
const ANIM_WAIT = 260;

const overlayEl = () => document.body.querySelector<HTMLElement>(".va-dlg__overlay");
const panelEl = () => document.body.querySelector<HTMLElement>(".va-dlg");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 等渲染 + openLifecycle 的 nextTick 链 + 焦点激活 */
const settle = async () => {
  await nextTick();
  await nextTick();
  await nextTick();
};

/** 登记挂载的 wrapper，用例结束统一 unmount（手动清 body 会让存活实例的 Teleport patch 崩溃） */
const mounted: VueWrapper[] = [];
function track<T extends VueWrapper>(w: T): T {
  mounted.push(w);
  return w;
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

describe("VaDialog 交互", () => {
  it("打开后渲染弹层并派发 update:open；初始焦点落在内容区第一个可聚焦元素", async () => {
    const wrapper = track(
      mount(VaDialog, {
        props: { title: "标题" },
        slots: { default: "<button class='b1'>一</button><button class='b2'>二</button>" },
      }),
    );
    expect(overlayEl()).toBeNull();

    // 非受控没有触发器：通过 expose 的 open() 程序化打开
    (wrapper.vm as unknown as { open: () => void }).open();
    await settle();

    expect(overlayEl()).not.toBeNull();
    expect(wrapper.emitted("update:open")).toEqual([[true]]);
    expect(document.activeElement).toBe(document.body.querySelector(".b1"));
  });

  it("initialFocus：选择器命中指定元素", async () => {
    track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "t", initialFocus: ".b2" },
        slots: { default: "<button class='b1'>一</button><button class='b2'>二</button>" },
      }),
    );
    await settle();
    expect(document.activeElement).toBe(document.body.querySelector(".b2"));
  });

  it("焦点陷阱：末位 Tab 回到首位；首位 Shift+Tab 回到末位；无焦点元素时钉住容器", async () => {
    track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "t" },
        slots: { default: "<button class='b1'>一</button>" },
      }),
    );
    await settle();

    const first = document.body.querySelector<HTMLElement>(".b1")!;
    const closeBtn = document.body.querySelector<HTMLElement>(".va-dlg__close")!;
    // 初始焦点在首位；末位是关闭按钮
    expect(document.activeElement).toBe(first);

    // 末位 Tab → 回首位
    closeBtn.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(first);

    // 首位 Shift+Tab → 回末位
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    expect(document.activeElement).toBe(closeBtn);

    // 焦点逃出容器（如点到遮罩使 activeElement 变成 body）→ Tab 拉回首位
    (document.body as HTMLElement).focus?.();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(first);
  });

  it("无内容可聚焦元素时：Tab 钉在面板容器上", async () => {
    track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "t", closable: false },
        slots: { default: "<span>纯文本</span>" },
      }),
    );
    await settle();
    const panel = panelEl()!;
    // 无焦点元素 → 初始聚焦容器本身
    expect(document.activeElement).toBe(panel);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(panel);
  });

  it("Esc 关闭；多弹窗叠开仅关栈顶", async () => {
    const Host = defineComponent({
      components: { VaDialog },
      setup() {
        const a = ref(true);
        const b = ref(true);
        return { a, b };
      },
      render() {
        return h("div", [
          h(VaDialog, { open: this.a, "onUpdate:open": (v: boolean) => (this.a = v), title: "A" }, { default: () => h("div", { class: "da" }, "A") }),
          h(VaDialog, { open: this.b, "onUpdate:open": (v: boolean) => (this.b = v), title: "B" }, { default: () => h("div", { class: "db" }, "B") }),
        ]);
      },
    });
    const wrapper = track(mount(Host));
    await settle();
    expect(document.body.querySelectorAll(".va-dlg__overlay").length).toBe(2);

    // 第一次 Esc：仅关栈顶 B（A 仍在，且 destroyOnClose=false → B 保留 DOM 转隐藏）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(wrapper.vm.b).toBe(false);
    expect(wrapper.vm.a).toBe(true);

    // 第二次 Esc：A 成为栈顶后关闭
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(wrapper.vm.a).toBe(false);
  });

  it("closeOnEscape=false 时 Esc 不关", async () => {
    const wrapper = track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "t", closeOnEscape: false },
        slots: { default: "x" },
      }),
    );
    await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(overlayEl()?.dataset.state).toBe("open");
  });

  it("遮罩点击：默认关闭；maskClosable=false 不关；点面板内部不关", async () => {
    const wrapper = track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "t" },
        slots: { default: "<span class='inner'>内容</span>" },
      }),
    );
    await settle();

    // 面板内部点击：不关
    document.body.querySelector(".inner")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(overlayEl()?.dataset.state).toBe("open");

    // 遮罩（target === overlay 自身）：关
    overlayEl()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("maskClosable=false 时遮罩点击不关", async () => {
    const wrapper = track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "t", maskClosable: false },
        slots: { default: "x" },
      }),
    );
    await settle();
    overlayEl()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("关闭后焦点恢复到打开前的元素；opened/closed 在动画结束后派发", async () => {
    const Host = defineComponent({
      components: { VaDialog },
      setup() {
        const open = ref(false);
        return { open };
      },
      render() {
        return h("div", [
          h("button", { class: "host-btn" }, "宿主按钮"),
          h(VaDialog, { open: this.open, "onUpdate:open": (v: boolean) => (this.open = v), title: "t" }, { default: () => h("button", { class: "in-btn" }, "内部") }),
        ]);
      },
    });
    const wrapper = track(mount(Host, { attachTo: document.body }));
    const hostBtn = document.body.querySelector<HTMLElement>(".host-btn")!;
    hostBtn.focus();
    expect(document.activeElement).toBe(hostBtn);

    // 打开：焦点移入弹窗
    wrapper.vm.open = true;
    await settle();
    expect(document.activeElement).toBe(document.body.querySelector(".in-btn"));
    await sleep(ANIM_WAIT);
    expect(wrapper.findComponent(VaDialog).emitted("opened")).toHaveLength(1);

    // 关闭：动画结束后焦点还原
    wrapper.vm.open = false;
    await sleep(ANIM_WAIT);
    expect(wrapper.findComponent(VaDialog).emitted("closed")).toHaveLength(1);
    expect(document.activeElement).toBe(hostBtn);
  });

  it("destroyOnClose=false（默认）：关闭后保留 DOM 仅隐藏；destroyOnClose=true：动画后卸载", async () => {
    // 默认：保留
    track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "keep" },
        slots: { default: "<span class='keep'>保留</span>" },
      }),
    );
    // 卸载：destroy
    track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "destroy", destroyOnClose: true },
        slots: { default: "<span class='destroy'>卸载</span>" },
      }),
    );
    await settle();
    expect(document.body.querySelectorAll(".va-dlg__overlay").length).toBe(2);

    // 依次 Esc 关闭两个（先栈顶 destroy，再 keep）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    await sleep(ANIM_WAIT);

    const overlays = [...document.body.querySelectorAll<HTMLElement>(".va-dlg__overlay")];
    expect(overlays.length).toBe(1); // destroy 已卸载
    expect(overlays[0].dataset.state).toBe("closed"); // keep 保留但隐藏
    expect(overlays[0].textContent).toContain("保留");
  });

  it("lockScroll：开时锁定 body 滚动；叠开时计数器不提前解锁；全关后还原", async () => {
    const Host = defineComponent({
      components: { VaDialog },
      setup() {
        const a = ref(false);
        const b = ref(false);
        return { a, b };
      },
      render() {
        return h("div", [
          h(VaDialog, { open: this.a, "onUpdate:open": (v: boolean) => (this.a = v), title: "A" }, { default: () => "A" }),
          h(VaDialog, { open: this.b, "onUpdate:open": (v: boolean) => (this.b = v), title: "B" }, { default: () => "B" }),
        ]);
      },
    });
    const wrapper = track(mount(Host));
    expect(document.body.style.overflow).toBe("");

    // 叠开两个：仍只锁一次语义，overflow 保持 hidden
    wrapper.vm.a = true;
    wrapper.vm.b = true;
    await settle();
    expect(document.body.style.overflow).toBe("hidden");

    // 关掉栈顶 B：动画后释放一层，但 A 仍持有锁 → 依旧 hidden
    wrapper.vm.b = false;
    await sleep(ANIM_WAIT);
    expect(document.body.style.overflow).toBe("hidden");

    // 关掉 A：计数归零 → 还原
    wrapper.vm.a = false;
    await sleep(ANIM_WAIT);
    expect(document.body.style.overflow).toBe("");
  });

  it("卸载后清理：Esc / 遮罩不再触发事件，滚动锁释放", async () => {
    const wrapper = track(
      mount(VaDialog, {
        props: { defaultOpen: true, title: "t" },
        slots: { default: "x" },
      }),
    );
    await settle();
    expect(document.body.style.overflow).toBe("hidden");
    wrapper.unmount();
    mounted.pop(); // 已手动卸载，移出登记表
    expect(document.body.style.overflow).toBe("");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });
});
