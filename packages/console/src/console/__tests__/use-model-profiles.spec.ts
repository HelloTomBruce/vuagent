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
import { nextTick, ref } from "vue";
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

  it("有供应商时扁平模型列表从 providers 展开，并正确按 Provider 供应商归属", async () => {
    vi.mocked(listProviders).mockResolvedValue([
      {
        id: "p1",
        name: "Moonshot 官方",
        provider: "moonshot",
        models: [
          { id: "m1", providerId: "p1", name: "Kimi 8K", model: "moonshot-v1-8k", provider: "moonshot", contextWindow: 64000 },
          { id: "m2", providerId: "p1", name: "Kimi 32K", model: "moonshot-v1-32k", provider: "moonshot" },
        ],
      },
      {
        id: "p2",
        name: "DeepSeek",
        provider: "deepseek",
        models: [
          { id: "m3", providerId: "p2", name: "DeepSeek V3", model: "deepseek-chat", provider: "deepseek" },
        ],
      },
    ]);
    const m = useModelProfiles();
    await m.loadProviders();

    expect(m.modelProfiles.value).toHaveLength(3);
    expect(m.availableModels.value).toHaveLength(3);
    expect(m.availableModels.value[0].provider).toBe("Moonshot 官方");
    expect(m.availableModels.value[0].label).toBe("Kimi 8K");
    expect(m.availableModels.value[0].meta).toBe("moonshot-v1-8k");
    expect(m.availableModels.value[1].provider).toBe("Moonshot 官方");
    expect(m.availableModels.value[1].label).toBe("Kimi 32K");
    expect(m.availableModels.value[2].provider).toBe("DeepSeek");
    expect(m.availableModels.value[2].label).toBe("DeepSeek V3");
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

describe("useModelProfiles：档位会话级隔离（TASK-052）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CAPS = {
    reasoning: { supported: true, supportedEfforts: ["low", "high"], defaultEffort: "low" },
  };

  function loadWithCaps() {
    vi.mocked(listProviders).mockResolvedValue([
      {
        id: "p1", name: "P", provider: "custom",
        models: [{ id: "m-r", providerId: "p1", name: "R", provider: "custom", model: "r", isDefault: true, capabilities: CAPS }],
      },
    ]);
  }

  it("两会话独立记忆：A 选 high 不影响 B 的默认 low，切回 A 恢复 high", async () => {
    loadWithCaps();
    // ref 模拟真实会话切换（activeSessionId 是响应式 ref，computed 才能追踪失效）
    const currentSession = ref("sA");
    const m = useModelProfiles({ getSessionId: () => currentSession.value });
    await m.loadProviders();
    expect(m.reasoningEffort.value).toBe("low"); // A 会话默认

    m.setReasoningEffort("high");
    expect(m.reasoningEffort.value).toBe("high");

    currentSession.value = "sB"; // 切到会话 B：未写过 → 读取侧兜底 defaultEffort
    expect(m.reasoningEffort.value).toBe("low");

    currentSession.value = "sA";
    expect(m.reasoningEffort.value).toBe("high"); // 恢复 A 的选择
  });

  it("模型切换重置只写当前会话槽位", async () => {
    loadWithCaps();
    let currentSession = "sA";
    const m = useModelProfiles({ getSessionId: () => currentSession });
    await m.loadProviders();
    m.setReasoningEffort("high");

    // 切到无声明模型 → 当前会话（sA）归零；B 不受影响（未被写）
    const plain = { id: "m-plain", providerId: "p1", name: "Plain", provider: "custom", model: "p" };
    vi.mocked(listProviders).mockResolvedValue([
      { id: "p1", name: "P", provider: "custom", models: [
        { id: "m-r", providerId: "p1", name: "R", provider: "custom", model: "r", isDefault: true, capabilities: CAPS },
        plain,
      ] },
    ]);
    await m.loadProviders();
    m.activeModel.value = "m-plain";
    await nextTick();
    expect(m.reasoningEffort.value).toBe("");
  });
});

describe("useModelProfiles：草稿槽迁移（TASK-081）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const CAPS = {
    reasoning: { supported: true, supportedEfforts: ["low", "medium", "high"], defaultEffort: "medium" },
  };

  function loadWithCaps() {
    vi.mocked(listProviders).mockResolvedValue([
      {
        id: "p1", name: "P", provider: "custom",
        models: [{ id: "m-r", providerId: "p1", name: "R", provider: "custom", model: "r", isDefault: true, capabilities: CAPS }],
      },
    ]);
  }

  it("新建态选档后会话创建：档位从 \"\" 槽迁移到新 sessionId，不回落默认", async () => {
    loadWithCaps();
    // 模拟 Console 的 draft→created：新建态 getSessionId() = ""，建会话后变为新 id
    const currentSession = ref("");
    const m = useModelProfiles({ getSessionId: () => currentSession.value });
    await m.loadProviders();

    m.setReasoningEffort("high"); // 草稿态选择落 "" 槽
    expect(m.reasoningEffort.value).toBe("high");

    // 修复前：会话创建后按新 id 读取 → 无槽回落 "medium"，首条消息静默丢档
    m.migrateSessionEffort("", "sess-new");
    currentSession.value = "sess-new";
    expect(m.reasoningEffort.value).toBe("high");
  });

  it("目标槽已有显式选择时不被草稿值覆盖；源槽迁移后清空", async () => {
    loadWithCaps();
    const currentSession = ref("");
    const m = useModelProfiles({ getSessionId: () => currentSession.value });
    await m.loadProviders();

    m.setReasoningEffort("high"); // "" 槽草稿值
    currentSession.value = "sess-new";
    m.setReasoningEffort("low"); // 目标槽已有显式选择

    m.migrateSessionEffort("", "sess-new");
    expect(m.reasoningEffort.value).toBe("low"); // 不覆盖目标槽

    // 源槽已清空：切回新建态回落 defaultEffort 而非旧草稿值
    currentSession.value = "";
    expect(m.reasoningEffort.value).toBe("medium");
  });

  it("空槽迁移 / 自迁移是幂等无操作", async () => {
    loadWithCaps();
    const currentSession = ref("");
    const m = useModelProfiles({ getSessionId: () => currentSession.value });
    await m.loadProviders();

    m.migrateSessionEffort("", "sess-new"); // "" 槽未写过：无操作
    currentSession.value = "sess-new";
    expect(m.reasoningEffort.value).toBe("medium"); // defaultEffort

    m.setReasoningEffort("high");
    m.migrateSessionEffort("sess-new", "sess-new"); // 自迁移：值保留
    expect(m.reasoningEffort.value).toBe("high");
  });
});
