/**
 * useModelProfiles 修复回归（P0 分层 review 修复）
 *
 * 固化两条行为约束：
 *   1. 无任何已配置模型时，模型选择器回落内置展示列表（AVAILABLE_MODELS），
 *      全新安装的 Composer 不至于空白——修复前 syncFlatModels 会无条件清空。
 *   2. 删除最后一个模型不再被「至少保留一个」拦截：供应商下零模型是合法状态，
 *      服务端 resolveEffectiveSettings 自有兜底。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import { useModelProfiles } from "../composables/useModelProfiles";
import { deleteModelProfileById, listProviders } from "../api/client";
import { vaToaster } from "@vuagent/ui";

vi.mock("@vuagent/ui", () => ({
  vaConfirm: vi.fn(async () => true),
  vaToaster: { add: vi.fn() },
}));

vi.mock("../api/client", () => ({
  createModelUnderProvider: vi.fn(),
  createProviderApi: vi.fn(),
  deleteModelProfileById: vi.fn(),
  deleteProviderApi: vi.fn(),
  discoverProviderModels: vi.fn(),
  listModelProfiles: vi.fn(async () => null),
  listProviders: vi.fn(),
  testModelConnectionApi: vi.fn(),
  updateModelProfileApi: vi.fn(),
  updateProviderApi: vi.fn(),
}));

const MODEL = {
  id: "m1",
  providerId: "p1",
  name: "M1",
  provider: "custom",
  model: "some-model",
  isDefault: true,
};

describe("useModelProfiles：修复回归", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("无任何供应商/模型时，选择器回落内置展示列表而非空白", async () => {
    vi.mocked(listProviders).mockResolvedValue([]);
    const m = useModelProfiles();
    await m.loadProviders();

    expect(m.modelProfiles.value).toEqual([]);
    expect(m.defaultModelId.value).toBe("");
    // 内置兜底列表生效，activeModel 指向其首项
    expect(m.availableModels.value.length).toBeGreaterThan(0);
    expect(m.availableModels.value[0].id).toBe("deepseek-v3");
    expect(m.activeModel.value).toBe("deepseek-v3");
  });

  it("有供应商时扁平模型列表从 providers 展开", async () => {
    vi.mocked(listProviders).mockResolvedValue([
      { id: "p1", name: "P", provider: "custom", models: [{ ...MODEL, contextWindow: 64000 }] },
    ]);
    const m = useModelProfiles();
    await m.loadProviders();

    expect(m.modelProfiles.value).toHaveLength(1);
    expect(m.availableModels.value[0].contextWindow).toBe(64000);
    expect(m.activeModel.value).toBe("m1");
  });

  it("删除最后一个模型不被拦截，删除后回落空态", async () => {
    vi.mocked(listProviders)
      .mockResolvedValueOnce([{ id: "p1", name: "P", provider: "custom", models: [{ ...MODEL }] }])
      .mockResolvedValueOnce([{ id: "p1", name: "P", provider: "custom", models: [] }]);
    vi.mocked(deleteModelProfileById).mockResolvedValue({ success: true });

    const m = useModelProfiles();
    await m.loadProviders();
    await m.deleteModel("m1");

    expect(deleteModelProfileById).toHaveBeenCalledWith("m1");
    // 修复前：这里会弹出「至少保留一个模型配置」并直接 return
    expect(vaToaster.add).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "至少保留一个模型配置" })
    );
    // 删除后重新拉取，空模型供应商合法存在，选择器回落内置列表
    expect(m.modelProfiles.value).toEqual([]);
    expect(m.availableModels.value[0].id).toBe("deepseek-v3");
  });
});

describe("useModelProfiles：推理档位（能力运行时 P1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CAPS_MODEL = {
    id: "m-r",
    providerId: "p1",
    name: "Reasoner",
    provider: "custom",
    model: "reasoner",
    isDefault: true,
    capabilities: {
      reasoning: { supported: true, supportedEfforts: ["low", "medium", "max"], defaultEffort: "max" },
    },
  };
  const PLAIN_MODEL = {
    id: "m-plain",
    providerId: "p1",
    name: "Plain",
    provider: "custom",
    model: "plain",
  };

  it("声明档位的模型：选项 = supportedEfforts，默认选中 defaultEffort", async () => {
    vi.mocked(listProviders).mockResolvedValue([
      { id: "p1", name: "P", provider: "custom", models: [{ ...CAPS_MODEL }] },
    ]);
    const m = useModelProfiles();
    await m.loadProviders();

    expect(m.reasoningEffortOptions.value).toEqual(["low", "medium", "max"]);
    expect(m.reasoningEffort.value).toBe("max");
  });

  it("切换到未声明模型：选项清空、档位归零（请求不带 effort）", async () => {
    vi.mocked(listProviders).mockResolvedValue([
      { id: "p1", name: "P", provider: "custom", models: [{ ...CAPS_MODEL }, { ...PLAIN_MODEL }] },
    ]);
    const m = useModelProfiles();
    await m.loadProviders();
    expect(m.reasoningEffort.value).toBe("max");

    m.activeModel.value = "m-plain";
    await nextTick();
    expect(m.reasoningEffortOptions.value).toEqual([]);
    expect(m.reasoningEffort.value).toBe("");
  });

  it("supported 但无集合 / 未声明：选项为空（保守，无法校验不发送）", async () => {
    const supportedNoList = {
      ...PLAIN_MODEL,
      id: "m-nolist",
      capabilities: { reasoning: { supported: true } },
    };
    vi.mocked(listProviders).mockResolvedValue([
      { id: "p1", name: "P", provider: "custom", models: [supportedNoList] },
    ]);
    const m = useModelProfiles();
    await m.loadProviders();

    expect(m.reasoningEffortOptions.value).toEqual([]);
    expect(m.reasoningEffort.value).toBe("");
  });
});
