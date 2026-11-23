// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import VaModelPicker from "../src/components/model-picker/VaModelPicker.vue";
import type { ModelItem } from "../src/components/model-picker/types";

describe("VaModelPicker 模型选择菜单 (分组与防换行优化)", () => {
  const groupedModels: ModelItem[] = [
    {
      id: "deepseek-v3",
      name: "DeepSeek V3",
      provider: "DEEPSEEK",
      model: "deepseek-chat",
      tag: "DEEPSEEK · deepseek-chat",
    },
    {
      id: "deepseek-r1",
      name: "DeepSeek R1",
      provider: "DEEPSEEK",
      model: "deepseek-reasoner",
      tag: "DEEPSEEK · deepseek-reasoner",
    },
    {
      id: "gpt-4o",
      name: "GPT-4o",
      provider: "OPENAI",
      model: "gpt-4o",
      tag: "OPENAI · gpt-4o",
    },
  ];

  it("点击触发按钮展开弹出菜单", async () => {
    const wrapper = mount(VaModelPicker, {
      props: {
        models: groupedModels,
        selected: "deepseek-v3",
      },
    });

    expect(wrapper.find(".va-mpk__menu").exists()).toBe(false);

    // 点击按钮展开
    await wrapper.find(".va-mpk__btn").trigger("click", { detail: 1 });
    expect(wrapper.find(".va-mpk__menu").exists()).toBe(true);
  });

  it("一个 provider 下有多个模型时，按 Provider 分组展示且去掉冗余的 provider 前缀", async () => {
    const wrapper = mount(VaModelPicker, {
      props: {
        models: groupedModels,
        selected: "deepseek-v3",
      },
    });

    await wrapper.find(".va-mpk__btn").trigger("click", { detail: 1 });

    const groups = wrapper.findAll(".va-mpk__group");
    expect(groups.length).toBe(2);

    // 第一组 DEEPSEEK（2 个模型）
    const dsGroup = groups[0];
    expect(dsGroup.find(".va-mpk__group-title").text()).toBe("DEEPSEEK");
    const dsItems = dsGroup.findAll(".va-mpk__item");
    expect(dsItems.length).toBe(2);
    expect(dsItems[0].find(".va-mpk__name").text()).toBe("DeepSeek V3");
    // 右侧标签去掉了冗余的 "DEEPSEEK ·"，仅保留具体的 "deepseek-chat"
    expect(dsItems[0].find(".va-mpk__tag").text()).toBe("deepseek-chat");
    expect(dsItems[1].find(".va-mpk__name").text()).toBe("DeepSeek R1");
    expect(dsItems[1].find(".va-mpk__tag").text()).toBe("deepseek-reasoner");

    // 第二组 OPENAI（1 个模型）
    const oaiGroup = groups[1];
    expect(oaiGroup.find(".va-mpk__group-title").text()).toBe("OPENAI");
    expect(oaiGroup.findAll(".va-mpk__item").length).toBe(1);
    expect(oaiGroup.find(".va-mpk__name").text()).toBe("GPT-4o");
    expect(oaiGroup.find(".va-mpk__tag").text()).toBe("gpt-4o");
  });

  it("点击选项触发 update:selected 事件并关闭菜单", async () => {
    const wrapper = mount(VaModelPicker, {
      props: {
        models: groupedModels,
        selected: "deepseek-v3",
      },
    });

    await wrapper.find(".va-mpk__btn").trigger("click", { detail: 1 });

    // 选中 GPT-4o
    const items = wrapper.findAll(".va-mpk__item");
    await items[2].trigger("click");

    expect(wrapper.emitted("update:selected")).toHaveLength(1);
    expect(wrapper.emitted("update:selected")![0]).toEqual(["gpt-4o"]);
    // 菜单已关闭
    expect(wrapper.find(".va-mpk__menu").exists()).toBe(false);
  });

  it("当模型无明确 provider 时回退至扁平单列表", async () => {
    const flatModels: ModelItem[] = [
      { id: "m1", name: "Model 1", tag: "快速" },
      { id: "m2", name: "Model 2", tag: "推荐" },
    ];

    const wrapper = mount(VaModelPicker, {
      props: {
        models: flatModels,
        selected: "m1",
      },
    });

    await wrapper.find(".va-mpk__btn").trigger("click", { detail: 1 });

    // 没有 .va-mpk__group 分组头
    expect(wrapper.find(".va-mpk__group").exists()).toBe(false);
    expect(wrapper.findAll(".va-mpk__item").length).toBe(2);
    expect(wrapper.find(".va-mpk__tag").text()).toBe("快速");
  });
});
