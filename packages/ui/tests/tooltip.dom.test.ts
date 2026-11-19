/**
 * VaTooltip 交互测试（happy-dom 真实挂载 + fake timers）：
 * mouseenter/focusin 延迟开、mouseleave/focusout 延迟关、Esc 立即关、
 * aria-describedby 回填与跳过规则、disabled 永不显示、hideDelay 内回移取消关闭。
 * Teleport 真实落地 document.body，提示泡用 document 查询。
 */
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import VaTooltip from "../src/components/tooltip/VaTooltip.vue";

const tipEl = () => document.body.querySelector<HTMLElement>('[role="tooltip"]');
const tipId = () => tipEl()?.id ?? null;

/** 登记挂载的 wrapper，用例结束统一 unmount（手动清 body 会让存活实例的 Teleport patch 崩溃） */
const mounted: VueWrapper[] = [];
function track<T extends VueWrapper>(w: T): T {
  mounted.push(w);
  return w;
}

function mountTooltip(props: Record<string, unknown> = {}, triggerHtml = "<button class='t'>保存</button>") {
  return track(
    mount(VaTooltip, {
      props: { content: "提示文案", ...props },
      slots: { default: triggerHtml },
    }),
  );
}

/** 推进计时器并等视图/浮层测量稳定（open 的 post watch 需再过一拍） */
async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  await nextTick();
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("VaTooltip 打开/关闭时序", () => {
  it("mouseenter 后经过 delay（默认 300ms）渲染 role=tooltip 并派发 show", async () => {
    const wrapper = mountTooltip();
    const trigger = wrapper.find(".va-tip__trigger");
    expect(tipEl()).toBeNull();

    await trigger.trigger("mouseenter");
    await advance(299);
    expect(tipEl()).toBeNull(); // 延迟未到不显示
    expect(wrapper.emitted("show")).toBeUndefined();

    await advance(1);
    expect(tipEl()).not.toBeNull();
    expect(tipEl()?.textContent).toContain("提示文案");
    expect(wrapper.emitted("show")).toHaveLength(1);
  });

  it("delay 内 mouseleave 取消打开（掠过不闪）", async () => {
    const wrapper = mountTooltip();
    const trigger = wrapper.find(".va-tip__trigger");

    await trigger.trigger("mouseenter");
    await advance(100);
    await trigger.trigger("mouseleave");
    await advance(1000);
    expect(tipEl()).toBeNull();
    expect(wrapper.emitted("show")).toBeUndefined();
  });

  it("mouseleave 后经过 hideDelay（默认 80ms）关闭并派发 hide", async () => {
    const wrapper = mountTooltip();
    const trigger = wrapper.find(".va-tip__trigger");

    await trigger.trigger("mouseenter");
    await advance(300);
    expect(tipEl()).not.toBeNull();

    await trigger.trigger("mouseleave");
    await advance(79);
    expect(tipEl()).not.toBeNull(); // 隐藏延迟未到仍开着
    await advance(1);
    expect(tipEl()).toBeNull();
    expect(wrapper.emitted("hide")).toHaveLength(1);
  });

  it("hideDelay 内重新 mouseenter 取消关闭（保持打开）", async () => {
    mountTooltip();
    const trigger = mounted[0].find(".va-tip__trigger");

    await trigger.trigger("mouseenter");
    await advance(300);
    await trigger.trigger("mouseleave");
    await advance(40);
    await trigger.trigger("mouseenter"); // 回移：取消待关闭
    await advance(1000);
    expect(tipEl()).not.toBeNull();
  });

  it("focusin 打开 / focusout 关闭（键盘可达）", async () => {
    const wrapper = mountTooltip();
    const trigger = wrapper.find(".va-tip__trigger");

    await trigger.trigger("focusin");
    await advance(300);
    expect(tipEl()).not.toBeNull();
    expect(wrapper.emitted("show")).toHaveLength(1);

    await trigger.trigger("focusout");
    await advance(80);
    expect(tipEl()).toBeNull();
    expect(wrapper.emitted("hide")).toHaveLength(1);
  });

  it("Esc 立即关闭（不走 hideDelay）", async () => {
    const wrapper = mountTooltip();
    await wrapper.find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    expect(tipEl()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    await nextTick();
    expect(tipEl()).toBeNull(); // 未推进任何计时器即已关闭
    expect(wrapper.emitted("hide")).toHaveLength(1);
  });
});

describe("VaTooltip aria-describedby 回填", () => {
  it("打开时给触发按钮回填 aria-describedby 指向浮层 id，关闭后移除", async () => {
    mountTooltip();
    const btn = mounted[0].find(".t").element as HTMLElement;
    expect(btn.getAttribute("aria-describedby")).toBeNull();

    await mounted[0].find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    const id = tipId();
    expect(id).toBeTruthy();
    expect(btn.getAttribute("aria-describedby")).toBe(id);

    await mounted[0].find(".va-tip__trigger").trigger("mouseleave");
    await advance(80);
    expect(btn.getAttribute("aria-describedby")).toBeNull();
  });

  it("触发器自带 aria-label 时跳过回填（不覆盖自足的可访问名）", async () => {
    mountTooltip({}, "<button class='t' aria-label='保存操作'>💾</button>");
    const btn = mounted[0].find(".t").element as HTMLElement;

    await mounted[0].find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    expect(tipEl()).not.toBeNull(); // 提示照常显示
    expect(btn.getAttribute("aria-describedby")).toBeNull(); // 但不回填
  });

  it("触发器已有 aria-describedby 时合并而非覆盖，关闭后仅摘除自身 id", async () => {
    mountTooltip({}, "<button class='t' aria-describedby='other-hint'>保存</button>");
    const btn = mounted[0].find(".t").element as HTMLElement;

    await mounted[0].find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    expect(btn.getAttribute("aria-describedby")).toBe(`other-hint ${tipId()}`);

    await mounted[0].find(".va-tip__trigger").trigger("mouseleave");
    await advance(80);
    expect(btn.getAttribute("aria-describedby")).toBe("other-hint");
  });

  it("纯文本触发器（无可聚焦子元素）回填到首个子元素", async () => {
    mountTooltip({}, "<span class='txt'>悬停我</span>");
    const span = mounted[0].find(".txt").element as HTMLElement;

    await mounted[0].find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    expect(span.getAttribute("aria-describedby")).toBe(tipId());
  });
});

describe("VaTooltip 边界", () => {
  it("disabled：永不渲染（mouseenter/focusin 均无效），打开中置 disabled 立即收起", async () => {
    const wrapper = mountTooltip({ disabled: true });
    const trigger = wrapper.find(".va-tip__trigger");

    await trigger.trigger("mouseenter");
    await advance(5000);
    await trigger.trigger("focusin");
    await advance(5000);
    expect(tipEl()).toBeNull();
    expect(wrapper.emitted("show")).toBeUndefined();

    // 打开中置 disabled → 立即收起
    await wrapper.setProps({ disabled: false });
    await trigger.trigger("mouseenter");
    await advance(300);
    expect(tipEl()).not.toBeNull();
    await wrapper.setProps({ disabled: true });
    await nextTick();
    await nextTick();
    expect(tipEl()).toBeNull();
    expect(wrapper.emitted("hide")).toHaveLength(1);
  });

  it("content 与 #content 插槽皆空时不显示（不渲染空气泡）", async () => {
    const wrapper = track(
      mount(VaTooltip, { slots: { default: "<button class='t'>按钮</button>" } }),
    );
    await wrapper.find(".va-tip__trigger").trigger("mouseenter");
    await advance(5000);
    expect(tipEl()).toBeNull();
    expect(wrapper.emitted("show")).toBeUndefined();
  });

  it("#content 插槽优先于 content prop", async () => {
    track(
      mount(VaTooltip, {
        props: { content: "prop 文案" },
        slots: { default: "<button class='t'>按钮</button>", content: "<em>插槽文案</em>" },
      }),
    );
    await mounted[0].find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    expect(tipEl()?.textContent).toContain("插槽文案");
    expect(tipEl()?.textContent).not.toContain("prop 文案");
  });

  it("placement 透传到底层浮层（left/right 不参与翻转）", async () => {
    mountTooltip({ placement: "right" });
    await mounted[0].find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    expect(document.body.querySelector(".va-pop")?.getAttribute("data-placement")).toBe("right");
  });

  it("variant 与 maxWidth 落到提示泡元素", async () => {
    mountTooltip({ variant: "default", maxWidth: 160 });
    await mounted[0].find(".va-tip__trigger").trigger("mouseenter");
    await advance(300);
    const tip = tipEl();
    expect(tip?.getAttribute("data-variant")).toBe("default");
    expect(tip?.style.maxWidth).toBe("160px");
  });

  it("卸载后清理：待打开计时器与 aria 回填全部回收", async () => {
    const wrapper = mountTooltip();
    const trigger = wrapper.find(".va-tip__trigger");
    await trigger.trigger("mouseenter");
    await advance(300);
    const btn = mounted[0].find(".t").element as HTMLElement;
    expect(btn.getAttribute("aria-describedby")).toBeTruthy();

    wrapper.unmount();
    mounted.pop(); // 已手动卸载，移出登记表
    await advance(5000);
    expect(btn.getAttribute("aria-describedby")).toBeNull();
    expect(tipEl()).toBeNull();
  });
});
