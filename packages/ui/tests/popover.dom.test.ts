/**
 * VaPopover 交互测试（happy-dom 真实挂载）：
 * trigger 点击切换、外部 mousedown 关闭、Esc 仅关栈顶、受控 sync、卸载清理。
 * Teleport 真实落地 document.body，浮层用 document 查询。
 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import VaPopover from "../src/components/popover/VaPopover.vue";

const floatingEl = () => document.body.querySelector<HTMLElement>(".va-pop");

/** 登记挂载的 wrapper，用例结束统一 unmount（手动清 body 会让存活实例的 Teleport patch 崩溃） */
const mounted: VueWrapper[] = [];
function track<T extends VueWrapper>(w: T): T {
  mounted.push(w);
  return w;
}

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("VaPopover 交互", () => {
  it("trigger 点击切换开/关并派发 update:open / open / close", async () => {
    const wrapper = track(
      mount(VaPopover, {
        slots: {
          trigger: "<button class='t-btn'>触发</button>",
          default: "<div class='panel'>面板</div>",
        },
      }),
    );
    const trigger = wrapper.find(".va-pop__trigger");
    expect(floatingEl()).toBeNull();

    await trigger.trigger("click");
    await nextTick();
    expect(floatingEl()?.textContent).toContain("面板");
    expect(wrapper.emitted("update:open")).toEqual([[true]]);
    expect(wrapper.emitted("open")).toHaveLength(1);

    await trigger.trigger("click");
    await nextTick();
    expect(floatingEl()).toBeNull();
    expect(wrapper.emitted("update:open")).toEqual([[true], [false]]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("disabled 时 trigger 点击不打开", async () => {
    const wrapper = track(
      mount(VaPopover, {
        props: { disabled: true },
        slots: { trigger: "<button>触发</button>", default: "<div>面板</div>" },
      }),
    );
    await wrapper.find(".va-pop__trigger").trigger("click");
    await nextTick();
    expect(floatingEl()).toBeNull();
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("外部 mousedown 关闭；点浮层内部不关", async () => {
    track(
      mount(VaPopover, {
        props: { defaultOpen: true },
        slots: { trigger: "<button>触发</button>", default: "<div class='panel'>面板</div>" },
      }),
    );
    await nextTick();
    await nextTick();
    const panel = floatingEl();
    expect(panel).not.toBeNull();

    // 浮层内部：不关
    panel!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(floatingEl()).not.toBeNull();

    // body 空白处：关
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(floatingEl()).toBeNull();
  });

  it("closeOnOutsideClick=false 时外部点击不关", async () => {
    track(
      mount(VaPopover, {
        props: { defaultOpen: true, closeOnOutsideClick: false },
        slots: { default: "<div>面板</div>" },
      }),
    );
    await nextTick();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(floatingEl()).not.toBeNull();
  });

  it("Esc 关闭；多浮层叠开仅关栈顶", async () => {
    const Host = defineComponent({
      components: { VaPopover },
      setup() {
        const a = ref(true);
        const b = ref(true);
        return { a, b };
      },
      render() {
        return h("div", [
          h(VaPopover, { open: this.a, "onUpdate:open": (v: boolean) => (this.a = v) }, { default: () => h("div", { class: "pa" }, "A") }),
          h(VaPopover, { open: this.b, "onUpdate:open": (v: boolean) => (this.b = v) }, { default: () => h("div", { class: "pb" }, "B") }),
        ]);
      },
    });
    const wrapper = track(mount(Host));
    await nextTick();
    await nextTick();
    expect(document.body.querySelectorAll(".va-pop").length).toBe(2);

    // 第一次 Esc：仅关栈顶 B
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    await nextTick();
    const remain1 = [...document.body.querySelectorAll(".va-pop")].map((el) => el.textContent);
    expect(remain1).toEqual(["A"]);
    expect(wrapper.vm.b).toBe(false);
    expect(wrapper.vm.a).toBe(true);

    // 第二次 Esc：A 成为栈顶，关闭
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    await nextTick();
    expect(document.body.querySelectorAll(".va-pop").length).toBe(0);
    expect(wrapper.vm.a).toBe(false);
  });

  it("closeOnEscape=false 时 Esc 不关", async () => {
    track(
      mount(VaPopover, {
        props: { defaultOpen: true, closeOnEscape: false },
        slots: { default: "<div>面板</div>" },
      }),
    );
    await nextTick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(floatingEl()).not.toBeNull();
  });

  it("受控 open：内部交互只发事件，不擅自改状态", async () => {
    const wrapper = track(
      mount(VaPopover, {
        props: { open: true },
        slots: { trigger: "<button>触发</button>", default: "<div>面板</div>" },
      }),
    );
    await nextTick();
    await nextTick();
    // 外部点击 → 发 close 请求，但父级未同步 open，浮层仍在
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect(floatingEl()).not.toBeNull();
  });

  it("卸载后监听清理：Esc / 外部点击不再触发事件", async () => {
    const wrapper = track(
      mount(VaPopover, {
        props: { defaultOpen: true },
        slots: { default: "<div>面板</div>" },
      }),
    );
    await nextTick();
    await nextTick();
    wrapper.unmount();
    mounted.pop(); // 已手动卸载，移出登记表
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await nextTick();
    expect(floatingEl()).toBeNull();
  });
});

describe("VaPopover 尺寸自适应（ResizeObserver）", () => {
  it("打开时观察浮层尺寸，关闭/卸载时断开（内容异步增长需重测算）", async () => {
    // happy-dom 无 ResizeObserver：注入可观测的替身
    const observed: Element[] = [];
    let disconnected = 0;
    const original = (globalThis as any).ResizeObserver;
    class FakeRO {
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {
        disconnected++;
      }
    }
    (globalThis as any).ResizeObserver = FakeRO;

    try {
      const wrapper = track(
        mount(VaPopover, {
          props: { open: false },
          slots: { trigger: () => h("button", "触发器"), default: () => h("div", "内容") },
        }),
      );

      expect(observed).toHaveLength(0); // 未开不观察

      await wrapper.setProps({ open: true });
      await nextTick();
      await nextTick();
      expect(observed.length).toBe(1); // 开：观察浮层本身
      expect(observed[0]).toBe(floatingEl());

      await wrapper.setProps({ open: false });
      await nextTick();
      expect(disconnected).toBeGreaterThan(0); // 关：断开
    } finally {
      if (original) (globalThis as any).ResizeObserver = original;
      else delete (globalThis as any).ResizeObserver;
    }
  });
});
