/**
 * VaSelect 交互测试（happy-dom 真实挂载）：
 * 键盘 ↓+Enter 选中、多选 Space 切换、disabled 跳过/不可选、搜索过滤、clear 事件、
 * Esc 关闭并还原焦点、字母首字符跳转、Home/End、选中回显。
 * 弹层经 Teleport 落地 document.body，用 document 查询（同 VaPopover 测试模式）。
 */
// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import VaSelect from "../src/components/select/VaSelect.vue";
import type { SelectOption, SelectValue } from "../src/components/select/types";

const OPTIONS: SelectOption[] = [
  { value: "apple", label: "苹果" },
  { value: "banana", label: "香蕉", disabled: true },
  { value: "cherry", label: "樱桃" },
];

const listEl = () => document.body.querySelector<HTMLElement>('[role="listbox"]');
const optionEls = () => [...document.body.querySelectorAll<HTMLElement>('[role="option"]')];
const activeEl = () => document.body.querySelector<HTMLElement>(".va-sel__opt[data-active]");
const searchEl = () => document.body.querySelector<HTMLInputElement>(".va-sel__search-input");

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

describe("VaSelect 交互", () => {
  it("键盘 ↓+Enter 选中并派发 update:modelValue / change，单选选中后关闭", async () => {
    const wrapper = track(mount(VaSelect, { props: { options: OPTIONS } }));
    const trigger = wrapper.find(".va-sel__trigger");

    await trigger.trigger("keydown", { key: "ArrowDown" }); // 关闭态 ↓ → 打开，高亮首项
    await settle();
    expect(listEl()).not.toBeNull();
    expect(activeEl()?.textContent).toContain("苹果");

    await trigger.trigger("keydown", { key: "ArrowDown" }); // ↓ 跳过 disabled 的香蕉 → 樱桃
    await settle();
    expect(activeEl()?.textContent).toContain("樱桃");

    await trigger.trigger("keydown", { key: "Enter" });
    await settle();
    expect(wrapper.emitted("update:modelValue")).toEqual([["cherry"]]);
    expect(wrapper.emitted("change")?.[0]).toEqual(["cherry", OPTIONS[2]]);
    expect(listEl()).toBeNull(); // 单选选中后关闭
    expect(wrapper.emitted("visibleChange")).toEqual([[true], [false]]);
  });

  it("disabled 选项不可选：点击与键盘均跳过", async () => {
    const wrapper = track(mount(VaSelect, { props: { options: OPTIONS } }));
    await wrapper.find(".va-sel__trigger").trigger("click");
    await settle();
    const banana = optionEls().find((el) => el.textContent?.includes("香蕉"))!;
    expect(banana.getAttribute("aria-disabled")).toBe("true");
    banana.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(listEl()).not.toBeNull(); // 未选中也未关闭
  });

  it("多选 Space 切换：保持打开，值累积/移除", async () => {
    const wrapper = track(
      mount(VaSelect, { props: { options: OPTIONS, multiple: true } }),
    );
    const trigger = wrapper.find(".va-sel__trigger");
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await settle();

    await trigger.trigger("keydown", { key: " " }); // Space 选中苹果
    await trigger.trigger("keyup", { key: " " });
    await settle();
    expect(wrapper.emitted("update:modelValue")).toEqual([[["apple"]]]);
    expect(listEl()).not.toBeNull(); // 多选保持打开

    await trigger.trigger("keydown", { key: "ArrowDown" }); // 跳过香蕉 → 樱桃
    await trigger.trigger("keydown", { key: " " });
    await settle();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["apple", "cherry"]]);

    await trigger.trigger("keydown", { key: " " }); // 再次 Space 取消樱桃
    await settle();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["apple"]]);
  });

  it("多选勾选框 aria-selected 与 listbox aria-multiselectable", async () => {
    track(
      mount(VaSelect, {
        props: { options: OPTIONS, multiple: true, defaultValue: ["apple"], defaultOpen: true },
      }),
    );
    await settle();
    expect(listEl()?.getAttribute("aria-multiselectable")).toBe("true");
    const apple = optionEls().find((el) => el.textContent?.includes("苹果"))!;
    expect(apple.getAttribute("aria-selected")).toBe("true");
    expect(apple.querySelector(".va-sel__check")?.hasAttribute("data-checked")).toBe(true);
  });

  it("searchable：打开自动聚焦搜索框，输入过滤，无匹配显示 emptyLabel", async () => {
    const wrapper = track(
      mount(VaSelect, { props: { options: OPTIONS, searchable: true } }),
    );
    await wrapper.find(".va-sel__trigger").trigger("click");
    await settle();
    const input = searchEl()!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input); // 自动聚焦

    input.value = "樱";
    input.dispatchEvent(new Event("input"));
    await settle();
    const texts = optionEls().map((el) => el.textContent);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("樱桃");

    input.value = "不存在";
    input.dispatchEvent(new Event("input"));
    await settle();
    expect(optionEls()).toHaveLength(0);
    expect(document.body.querySelector(".va-sel__empty")?.textContent).toContain("无匹配项");
    expect(wrapper.emitted("visibleChange")).toEqual([[true]]);
  });

  it("searchable：搜索框内 Enter 选中高亮项", async () => {
    const wrapper = track(
      mount(VaSelect, { props: { options: OPTIONS, searchable: true } }),
    );
    await wrapper.find(".va-sel__trigger").trigger("click");
    await settle();
    const input = searchEl()!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await settle();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(wrapper.emitted("update:modelValue")).toEqual([["cherry"]]); // 跳过 disabled 香蕉
  });

  it("clearable：清除按钮阻止冒泡（不打开弹层），清空值并发 clear 事件", async () => {
    const wrapper = track(
      mount(VaSelect, {
        props: { options: OPTIONS, clearable: true, modelValue: "apple" },
      }),
    );
    await settle();
    const clearBtn = wrapper.find(".va-sel__clear");
    expect(clearBtn.exists()).toBe(true);
    await clearBtn.trigger("click");
    await settle();
    expect(wrapper.emitted("update:modelValue")).toEqual([[""]]);
    expect(wrapper.emitted("clear")).toHaveLength(1);
    expect(listEl()).toBeNull(); // 冒泡被阻止，弹层未打开
  });

  it("clearable 无值时不渲染清除按钮", async () => {
    const wrapper = track(mount(VaSelect, { props: { options: OPTIONS, clearable: true } }));
    expect(wrapper.find(".va-sel__clear").exists()).toBe(false);
  });

  it("Esc 关闭并还原焦点到触发器", async () => {
    // attachTo：happy-dom 只对挂载进 document 的元素跟踪 focus（触发器在 Teleport 之外的 wrapper 里）
    const wrapper = track(mount(VaSelect, { props: { options: OPTIONS }, attachTo: document.body }));
    const trigger = wrapper.find(".va-sel__trigger");
    (trigger.element as HTMLElement).focus();
    await trigger.trigger("keydown", { key: "Enter" }); // 打开
    await settle();
    expect(listEl()).not.toBeNull();

    await trigger.trigger("keydown", { key: "Escape" });
    await settle();
    expect(listEl()).toBeNull();
    expect(document.activeElement).toBe(trigger.element); // 焦点还原
  });

  it("字母首字符跳转：循环定位下一个匹配项", async () => {
    const opts: SelectOption[] = [
      { value: "apple", label: "Apple" },
      { value: "banana", label: "Banana" },
      { value: "avocado", label: "Avocado" },
    ];
    const wrapper = track(mount(VaSelect, { props: { options: opts } }));
    const trigger = wrapper.find(".va-sel__trigger");
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await settle();
    expect(activeEl()?.textContent).toContain("Apple");

    await trigger.trigger("keydown", { key: "a" }); // 跳到下一个 a 开头项
    await settle();
    expect(activeEl()?.textContent).toContain("Avocado");

    await trigger.trigger("keydown", { key: "Enter" });
    await settle();
    expect(wrapper.emitted("update:modelValue")).toEqual([["avocado"]]);
  });

  it("Home/End 跳到首个/末个可选项，aria-activedescendant 同步", async () => {
    const wrapper = track(mount(VaSelect, { props: { options: OPTIONS } }));
    const trigger = wrapper.find(".va-sel__trigger");
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await settle();

    await trigger.trigger("keydown", { key: "End" }); // 末个可选项 = 樱桃（香蕉 disabled 不算？末项本身是樱桃）
    await settle();
    expect(activeEl()?.textContent).toContain("樱桃");
    const ad = trigger.attributes("aria-activedescendant");
    expect(ad).toBeTruthy();
    expect(document.getElementById(ad!)?.textContent).toContain("樱桃");

    await trigger.trigger("keydown", { key: "Home" });
    await settle();
    expect(activeEl()?.textContent).toContain("苹果");
  });

  it("点击选项选中（单选关闭），受控 v-model 回显 label", async () => {
    const Host = defineComponent({
      components: { VaSelect },
      setup() {
        const val = ref<SelectValue>("apple");
        return { val, OPTIONS };
      },
      render() {
        return h(VaSelect, {
          options: this.OPTIONS,
          modelValue: this.val,
          "onUpdate:modelValue": (v: SelectValue) => (this.val = v),
        });
      },
    });
    const wrapper = track(mount(Host));
    expect(wrapper.find(".va-sel__value").text()).toContain("苹果"); // 回显 label 而非 value

    await wrapper.find(".va-sel__trigger").trigger("click");
    await settle();
    optionEls()
      .find((el) => el.textContent?.includes("樱桃"))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(wrapper.vm.val).toBe("cherry");
    expect(listEl()).toBeNull();
    expect(wrapper.find(".va-sel__value").text()).toContain("樱桃");
  });

  it("分组渲染：role=group + 组标题，无匹配时 empty 插槽", async () => {
    const opts: SelectOption[] = [
      { value: "a", label: "普通项" },
      { value: "b", label: "樱桃", group: "浆果" },
      { value: "c", label: "葡萄", group: "浆果" },
    ];
    track(
      mount(VaSelect, {
        props: { options: opts, defaultOpen: true },
        slots: { empty: "<span class='custom-empty'>啥也没有</span>" },
      }),
    );
    await settle();
    const group = document.body.querySelector(".va-sel__group");
    expect(group?.getAttribute("role")).toBe("group");
    const titleId = group?.getAttribute("aria-labelledby");
    expect(document.getElementById(titleId!)?.textContent).toBe("浆果");
    expect(group?.querySelectorAll('[role="option"]').length).toBe(2);
  });

  it("disabled 时 trigger 点击/键盘均不打开", async () => {
    const wrapper = track(mount(VaSelect, { props: { options: OPTIONS, disabled: true } }));
    const trigger = wrapper.find(".va-sel__trigger");
    await trigger.trigger("click");
    await trigger.trigger("keydown", { key: "ArrowDown" });
    await settle();
    expect(listEl()).toBeNull();
    expect(wrapper.emitted("visibleChange")).toBeUndefined();
  });

  it("placeholder 与 invalid 态", async () => {
    const wrapper = track(
      mount(VaSelect, { props: { options: OPTIONS, placeholder: "挑一个", invalid: true } }),
    );
    expect(wrapper.find(".va-sel__value").text()).toBe("挑一个");
    expect(wrapper.find(".va-sel__trigger").attributes("aria-invalid")).toBe("true");
  });
});
