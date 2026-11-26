/**
 * ModelProfilesPanel 结构测试（P0 交互调整后）
 *
 * 用户反馈的交互约束，用测试固化：
 *   1. 左列是**扁平供应商列表**——不出现任何模型节点（不再是树形）
 *   2. 模型清单只在右侧渲染
 *   3. 点模型行发出 edit-model（右侧内联编辑入口）
 */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ModelProfilesPanel from "./ModelProfilesPanel.vue";
import type { ModelProfileItem, ProviderItem } from "../../types";

const MODEL_A: ModelProfileItem = {
  id: "m-a",
  providerId: "p-1",
  name: "GLM 5.3",
  provider: "custom",
  model: "glm-5.3",
  contextWindow: 1024000,
  capabilities: { contextWindow: 1024000, inputModalities: ["text", "image"], reasoning: { supported: true } },
};
const MODEL_B: ModelProfileItem = {
  id: "m-b",
  providerId: "p-1",
  name: "GLM 4.6",
  provider: "custom",
  model: "glm-4.6",
  isDefault: true,
};

const PROVIDERS: ProviderItem[] = [
  { id: "p-1", name: "智谱", provider: "custom", baseUrl: "https://open.bigmodel.cn/v1", maskedApiKey: "****uMvt", models: [MODEL_A, MODEL_B] },
  { id: "p-2", name: "Kimi", provider: "custom", baseUrl: "https://api.kimi.com/v1", maskedApiKey: "****R8cV", models: [] },
];

const BASE_PROPS = {
  providers: PROVIDERS,
  selectedProviderId: "p-1",
  isCreatingProvider: false,
  currentProvider: PROVIDERS[0],
  currentProviderModels: PROVIDERS[0].models!,
  providerForm: { id: "p-1", name: "智谱", provider: "custom", baseUrl: "https://open.bigmodel.cn/v1", maskedApiKey: "****uMvt" },
  modelDraft: null,
  isCreatingModel: false,
  showApiKey: false,
  isTestingConnection: false,
  isDiscovering: false,
  testStatus: null,
  testingProfileId: "",
  discoveredModels: [] as string[],
  discoveredItems: [],
  isVerifyingCapabilities: false,
  capabilityVerdicts: [] as Array<{ capability: string; ok: boolean | null; detail: string }>,
};

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(ModelProfilesPanel, { props: { ...BASE_PROPS, ...overrides } });
}

describe("ModelProfilesPanel 交互结构", () => {
  it("左列是扁平供应商列表，不含任何模型节点", () => {
    const wrapper = mountPanel();
    const left = wrapper.find(".va-console__modal-left");

    // 两个供应商各一张卡片
    expect(left.findAll(".va-console__profile-card")).toHaveLength(2);
    expect(left.text()).toContain("智谱");
    expect(left.text()).toContain("Kimi");

    // 关键约束：左侧不再有树形的模型子节点
    expect(left.findAll(".va-model-row")).toHaveLength(0);
    expect(left.findAll(".va-prov-group__models")).toHaveLength(0);
    // 左侧也不该出现模型名（模型统一在右侧）
    expect(left.text()).not.toContain("GLM 5.3");

    wrapper.unmount();
  });

  it("模型清单只在右侧渲染", () => {
    const wrapper = mountPanel();
    const right = wrapper.find(".va-console__modal-right");

    expect(right.findAll(".va-model-row")).toHaveLength(2);
    expect(right.text()).toContain("GLM 5.3");
    expect(right.text()).toContain("GLM 4.6");

    wrapper.unmount();
  });

  it("模型行展示能力角标与默认标记", () => {
    const wrapper = mountPanel();
    const right = wrapper.find(".va-console__modal-right");
    const badges = right.findAll(".va-prov-badge").map((b) => b.text());

    expect(badges).toContain("1024K");
    expect(badges).toContain("图片");
    expect(badges).toContain("推理");
    expect(right.text()).toContain("默认");

    wrapper.unmount();
  });

  it("点击模型行发出 edit-model 事件（引导到右侧内联编辑）", async () => {
    const wrapper = mountPanel();
    await wrapper.findAll(".va-model-row__main")[0].trigger("click");

    const emitted = wrapper.emitted("edit-model");
    expect(emitted).toBeTruthy();
    expect((emitted![0][0] as ModelProfileItem).id).toBe("m-a");

    wrapper.unmount();
  });

  it("无模型时给出空态提示，而不是空白", () => {
    const wrapper = mountPanel({
      selectedProviderId: "p-2",
      currentProvider: PROVIDERS[1],
      currentProviderModels: [],
    });
    expect(wrapper.find(".va-console__modal-right").text()).toContain("还没有模型");

    wrapper.unmount();
  });

  it("modelDraft 存在时右侧展开内联编辑表单", () => {
    const wrapper = mountPanel({ modelDraft: { ...MODEL_A }, isCreatingModel: false });
    const editor = wrapper.find(".va-model-editor");

    expect(editor.exists()).toBe(true);
    expect(editor.text()).toContain("编辑「GLM 5.3」");
    // 能力开关可见
    expect(editor.text()).toContain("支持推理");
    expect(editor.text()).toContain("支持工具调用");

    wrapper.unmount();
  });

  it("新建模型时呈添加态", () => {
    const wrapper = mountPanel({
      modelDraft: { id: "", providerId: "p-1", name: "", provider: "custom", model: "", capabilities: { source: "declared" } },
      isCreatingModel: true,
    });
    expect(wrapper.find(".va-model-editor").text()).toContain("添加模型");

    wrapper.unmount();
  });
});
