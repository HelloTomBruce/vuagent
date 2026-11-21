/**
 * 模型配置数据域（P0 重构：Provider 1:N Model）
 *
 * 分层：
 *   供应商（端点 + 凭证，配一次） ──1:N── 模型（标识 + 能力元数据）
 *
 * 交互形态（用户反馈后调整）：
 *   左列是**扁平的供应商列表**（不展开子项）；
 *   模型的增删改统一在右侧完成——选中供应商后，右侧同时给出
 *   「供应商凭证」与「该供应商下的模型清单 + 内联编辑表单」。
 *
 * 兼容：会话级 activeModel 仍然绑定 model id（会话选的是模型不是供应商），
 * 因此 Composer / 会话恢复逻辑无需感知分层。
 */
import { computed, reactive, ref } from "vue";
import {
  createModelUnderProvider,
  verifyModelCapabilities,
  createProviderApi,
  deleteModelProfileById,
  deleteProviderApi,
  discoverProviderModels,
  listModelProfiles,
  listProviders,
  testModelConnectionApi,
  updateModelProfileApi,
  updateProviderApi,
} from "../api/client";
import type { DetectedModelInfo, ProviderPayload } from "../api/client";
import { vaConfirm, vaToaster } from "@vuagent/ui";
import { AVAILABLE_MODELS, DEFAULT_MODEL_FORM, PROVIDER_PRESETS } from "../types";
import type {
  CapabilityVerdict,
} from "../api/client";
import type {
  ModelCapabilities,
  ModelOption,
  ModelProfileItem,
  ProviderItem,
} from "../types";

export interface ModelProfilesOptions {
  closeMenus?: () => void;
  /** 当前会话 id getter（TASK-052：推理档位按会话隔离，新建态返回空串） */
  getSessionId?: () => string;
}

const EMPTY_PROVIDER_FORM = (): ProviderPayload & { id?: string; maskedApiKey?: string } => ({
  name: "",
  provider: "deepseek",
  baseUrl: "",
  apiKey: "",
  parameters: { temperature: 0.2 },
});

export function useModelProfiles(options: ModelProfilesOptions = {}) {
  /* ==================== 会话级模型选择（结构不变） ==================== */
  const availableModels = ref<ModelOption[]>([...AVAILABLE_MODELS]);
  const activeModel = ref("deepseek-v3");
  const defaultModelId = ref("");

  /* ==================== 设置面板状态 ==================== */
  const isModelSettingsOpen = ref(false);
  const providers = ref<ProviderItem[]>([]);
  /** 扁平模型列表（Composer 选择器与会话恢复用） */
  const modelProfiles = ref<ModelProfileItem[]>([]);

  /** 左侧选中的供应商；空串表示列表为空 */
  const selectedProviderId = ref("");
  /** 是否正在新建供应商（左侧列表末尾的新建态） */
  const isCreatingProvider = ref(false);

  const providerForm = ref(EMPTY_PROVIDER_FORM());
  /** 右侧内联编辑中的模型草稿；null 表示当前没有在编辑模型 */
  const modelDraft = ref<ModelProfileItem | null>(null);
  /** 草稿是新建还是修改已有模型 */
  const isCreatingModel = ref(false);

  const showApiKey = ref(false);
  const isTestingConnection = ref(false);
  const testStatus = ref<{ ok: boolean; message: string } | null>(null);
  const isDiscovering = ref(false);
  /** 拉取到的可选模型 id 列表（供输入联想，避免手打模型标识） */
  const discoveredModels = ref<string[]>([]);
  /** 拉取到的模型详细信息（含能力探测结果，选中即自动填充） */
  const discoveredItems = ref<DetectedModelInfo[]>([]);

  const activeModelObj = computed(
    () => availableModels.value.find((m) => m.id === activeModel.value) || availableModels.value[0]
  );

  /** 当前会话模型的能力元数据（供附件入口等按能力联动） */
  const activeModelCapabilities = computed<ModelCapabilities | undefined>(
    () => modelProfiles.value.find((m) => m.id === activeModel.value)?.capabilities
  );

  /**
   * 当前模型是否声明支持图片输入。
   * 未声明一律按「不支持」保守处理——宁可提示用户换模型，也不要传图后让 provider 报错。
   */
  const supportsImageInput = computed(() => {
    const mods = activeModelCapabilities.value?.inputModalities;
    return Array.isArray(mods) && mods.includes("image");
  });

  /* ==================== 推理档位（能力运行时 P1） ==================== */

  /** 当前模型的推理能力声明（未声明返回 undefined） */
  const activeModelReasoning = computed(
    () => activeModelCapabilities.value?.reasoning
  );

  /**
   * 可选档位：仅当声明 supported 且 supportedEfforts 非空时给出，
   * 否则空数组（UI 不渲染选择器，请求不带档位——保守策略）。
   */
  const reasoningEffortOptions = computed(() => {
    const r = activeModelReasoning.value;
    return r?.supported && Array.isArray(r.supportedEfforts) && r.supportedEfforts.length
      ? r.supportedEfforts
      : [];
  });

  /**
   * 档位选择（TASK-052 会话级隔离）：每会话独立记忆，空串 = 不发送。
   * 无会话（新建态）落在 "" 键槽位。
   */
  // reactive Map：computed 依赖集合变更（Vue3 响应式集合，set 即触发失效）
  const sessionEfforts = reactive(new Map<string, string>());
  /**
   * 读取侧兜底（取代写入侧重置的 watch）：会话切换 / 模型切换 / 声明变化的
   * 一切组合在此收敛，不存在「watch 触发时刻会话 id 与模型未对齐」的竞态——
   *   会话未写过 → defaultEffort（模型有声明时的合理缺省）
   *   存值对当前模型非法（切模型后）→ 同样回落 defaultEffort
   *   模型无声明 → 空串（不发送）
   */
  const reasoningEffort = computed(() => {
    const opts = reasoningEffortOptions.value;
    if (opts.length === 0) return "";
    const stored = sessionEfforts.get(options.getSessionId?.() ?? "");
    if (stored && opts.includes(stored)) return stored;
    const def = activeModelReasoning.value?.defaultEffort;
    return def && opts.includes(def) ? def : opts[0];
  });

  function setReasoningEffort(effort: string): void {
    sessionEfforts.set(options.getSessionId?.() ?? "", effort);
  }


  /** 当前选中的供应商 */
  const currentProvider = computed<ProviderItem | undefined>(() =>
    providers.value.find((p) => p.id === selectedProviderId.value)
  );

  /** 当前选中供应商下的模型（右侧列表数据源） */
  const currentProviderModels = computed<ModelProfileItem[]>(
    () => currentProvider.value?.models || []
  );

  /* ==================== 加载 ==================== */

  /**
   * 拉取供应商（服务端已把归属模型内联在每个 provider 下），并同步扁平模型列表。
   *
   * 不再额外请求 /api/settings/models：那会多一次往返，且服务端在两条路径上
   * 都要做一次全表扫描。扁平列表直接从 providers 展开即可。
   */
  async function loadProviders() {
    try {
      const list = await listProviders();
      if (!list) return;
      providers.value = list;

      // 选中项失效时（被删除/首次进入）回落到第一个
      const still = list.find((p) => p.id === selectedProviderId.value);
      if (!still) {
        if (list.length > 0) selectProvider(list[0].id);
        else selectedProviderId.value = "";
      } else {
        // 选中项仍在：只同步供应商字段，不动 apiKey（用户可能正在输入）
        providerForm.value = {
          ...providerForm.value,
          id: still.id,
          name: still.name,
          provider: still.provider,
          baseUrl: still.baseUrl || "",
          maskedApiKey: still.maskedApiKey,
        };
      }

      // 扁平模型列表从 providers 展开，避免额外一次 HTTP 往返
      syncFlatModels(list.flatMap((p) => p.models ?? []));
    } catch (e) {
      console.error("加载供应商失败:", e);
    }
  }

  /** 兼容旧入口：仅刷新扁平模型列表 */
  async function fetchModelProfiles() {
    try {
      const list = await listModelProfiles();
      if (list) syncFlatModels(list);
    } catch (e) {
      console.error("加载模型列表失败:", e);
    }
  }

  function syncFlatModels(list: ModelProfileItem[]) {
    // 空列表也要同步：删掉最后一个模型后 UI 不能停留在旧数据上
    modelProfiles.value = list;
    if (list.length === 0) {
      // 无任何已配置模型时回落内置展示列表，全新安装的模型选择器不至于空白
      //（发送时服务端 resolveEffectiveSettings 自有 env 兜底，这里只管展示）
      availableModels.value = [...AVAILABLE_MODELS];
      defaultModelId.value = "";
      if (!AVAILABLE_MODELS.some((m) => m.id === activeModel.value)) {
        activeModel.value = AVAILABLE_MODELS[0]?.id ?? "";
      }
      return;
    }
    availableModels.value = list.map((m) => ({
      id: m.id,
      label: m.name,
      meta: `${(m.provider || "custom").toUpperCase()} · ${m.model}`,
      contextWindow: m.contextWindow || m.capabilities?.contextWindow || 128000,
    }));
    const def = list.find((m) => m.isDefault) || list[0];
    defaultModelId.value = def.id;
    if (!activeModel.value || !list.some((m) => m.id === activeModel.value)) {
      activeModel.value = def.id;
    }
  }

  function resetModelToDefault() {
    if (defaultModelId.value) activeModel.value = defaultModelId.value;
  }

  /* ==================== 面板开关 ==================== */

  async function openModelSettings() {
    options.closeMenus?.();
    isModelSettingsOpen.value = true;
    testStatus.value = null;
    modelDraft.value = null;
    isCreatingModel.value = false;
    await loadProviders();
    if (providers.value.length === 0) startCreateProvider();
  }

  function closeModelSettings() {
    isModelSettingsOpen.value = false;
    testStatus.value = null;
    modelDraft.value = null;
    isCreatingModel.value = false;
  }

  /* ==================== 供应商 ==================== */

  /** 选中供应商 → 右侧展示其凭证与该供应商下的模型清单 */
  function selectProvider(id: string) {
    const p = providers.value.find((x) => x.id === id);
    if (!p) return;
    isCreatingProvider.value = false;
    selectedProviderId.value = id;
    // 切换供应商时放弃未保存的模型草稿，避免串到别的供应商下
    modelDraft.value = null;
    isCreatingModel.value = false;
    testStatus.value = null;
    discoveredModels.value = [];
    discoveredItems.value = [];
    providerForm.value = {
      id: p.id,
      name: p.name,
      provider: p.provider,
      baseUrl: p.baseUrl || "",
      apiKey: "",
      maskedApiKey: p.maskedApiKey,
      parameters: { ...(p.parameters || {}) },
    };
  }

  function startCreateProvider() {
    isCreatingProvider.value = true;
    selectedProviderId.value = "";
    modelDraft.value = null;
    isCreatingModel.value = false;
    testStatus.value = null;
    discoveredModels.value = [];
    discoveredItems.value = [];
    providerForm.value = { ...EMPTY_PROVIDER_FORM(), name: "新供应商" };
  }

  /** 供应商类型切换（仅新建时预填端点） */
  function onProviderKindChange(kind: string) {
    providerForm.value.provider = kind;
    if (!isCreatingProvider.value) return;
    const preset = PROVIDER_PRESETS[kind];
    if (preset) {
      providerForm.value.name = preset.name;
      providerForm.value.baseUrl = preset.baseUrl;
    }
  }

  async function saveProvider() {
    const form = providerForm.value;
    if (!form.name.trim()) {
      vaToaster.add({ title: "请填写供应商名称", kind: "warning" });
      return;
    }

    const payload: ProviderPayload = {
      name: form.name.trim(),
      provider: form.provider,
      baseUrl: form.baseUrl?.trim() || undefined,
      apiKey: form.apiKey?.trim() || undefined,
      parameters: form.parameters,
    };

    try {
      if (isCreatingProvider.value) {
        const created = await createProviderApi(payload);
        if (created) {
          await loadProviders();
          selectProvider(created.id);
          testStatus.value = { ok: true, message: "供应商已创建，可在下方添加模型" };
        }
      } else if (form.id) {
        const updated = await updateProviderApi(form.id, payload);
        if (updated) {
          await loadProviders();
          selectProvider(form.id);
          testStatus.value = { ok: true, message: "供应商已更新，其下所有模型立即生效" };
        }
      }
    } catch (e: any) {
      testStatus.value = { ok: false, message: `保存失败: ${e.message || String(e)}` };
    }
  }

  async function deleteProvider(id: string) {
    const p = providers.value.find((x) => x.id === id);
    const count = p?.models?.length ?? 0;

    const ok = await vaConfirm({
      title: count > 0 ? `删除「${p?.name}」及其 ${count} 个模型？` : "删除这个供应商？",
      description:
        count > 0
          ? "该供应商下的模型配置会一并移除，此操作不可撤销。"
          : `「${p?.name || "未命名供应商"}」将被移除，此操作不可撤销。`,
      confirmText: count > 0 ? "全部删除" : "删除",
      tone: "danger",
      icon: true,
    });
    if (!ok) return;

    const res = await deleteProviderApi(id, count > 0);
    if (res?.success) {
      await loadProviders();
      if (providers.value.length > 0) selectProvider(providers.value[0].id);
      else startCreateProvider();
    } else {
      vaToaster.add({ title: res?.error || "删除失败", kind: "danger" });
    }
  }

  /* ==================== 模型（右侧内联编辑） ==================== */

  /** 开始新建模型：草稿挂到当前供应商下 */
  function startCreateModel() {
    const provider = currentProvider.value;
    if (!provider) {
      vaToaster.add({ title: "请先保存供应商", kind: "warning" });
      return;
    }
    isCreatingModel.value = true;
    discoveredModels.value = [];
    discoveredItems.value = [];
    testStatus.value = null;
    const preset = PROVIDER_PRESETS[provider.provider];
    modelDraft.value = {
      ...DEFAULT_MODEL_FORM,
      id: "",
      providerId: provider.id,
      provider: provider.provider,
      name: "",
      model: "",
      contextWindow: preset?.contextWindow || 128000,
      capabilities: { source: "declared" },
      isDefault: false,
    };
  }

  /** 开始编辑已有模型 */
  function editModel(m: ModelProfileItem) {
    isCreatingModel.value = false;
    capabilityVerdicts.value = [];
    discoveredModels.value = [];
    discoveredItems.value = [];
    testStatus.value = null;
    modelDraft.value = {
      id: m.id,
      providerId: m.providerId,
      name: m.name,
      provider: m.provider,
      model: m.model,
      baseUrl: m.baseUrl || "",
      apiKey: "",
      maskedApiKey: m.maskedApiKey,
      contextWindow: m.contextWindow || m.capabilities?.contextWindow || 128000,
      capabilities: m.capabilities ? { ...m.capabilities } : { source: "declared" },
      temperature: m.temperature ?? 0.2,
      isDefault: !!m.isDefault,
    };
  }

  function cancelModelEdit() {
    modelDraft.value = null;
    isCreatingModel.value = false;
    capabilityVerdicts.value = [];
    discoveredModels.value = [];
    discoveredItems.value = [];
    testStatus.value = null;
  }

  async function saveModel() {
    const form = modelDraft.value;
    if (!form) return;
    if (!form.name.trim() || !form.model.trim()) {
      vaToaster.add({ title: "请填写模型名称与模型标识", kind: "warning" });
      return;
    }

    const capabilities: ModelCapabilities = {
      ...(form.capabilities || {}),
      contextWindow: form.contextWindow || undefined,
      source: form.capabilities?.source || "declared",
    };
    const shared = {
      name: form.name.trim(),
      model: form.model.trim(),
      contextWindow: form.contextWindow || undefined,
      capabilities,
      temperature: form.temperature,
      isDefault: form.isDefault,
    };

    try {
      const wasCreating = isCreatingModel.value;
      // 更新走 PATCH 白名单：provider 类型归属供应商层，模型层不可也不需要改
      const saved = wasCreating
        ? await createModelUnderProvider(form.providerId || selectedProviderId.value, shared)
        : await updateModelProfileApi(form.id, shared);

      if (saved) {
        await loadProviders();
        // 保存后收起草稿，回到模型清单（清单里能看到刚保存项）
        cancelModelEdit();
        testStatus.value = { ok: true, message: wasCreating ? "模型已添加" : "模型已更新" };
      }
    } catch (e: any) {
      testStatus.value = { ok: false, message: `保存失败: ${e.message || String(e)}` };
    }
  }

  async function deleteModel(id: string) {
    // 允许删到最后一个：供应商下零模型是合法状态（面板有空态），
    // 服务端 resolveEffectiveSettings 在无 profile 时自有兜底配置
    const targetModel = modelProfiles.value.find((m) => m.id === id);
    const ok = await vaConfirm({
      title: "删除这个模型？",
      description: `「${targetModel?.name || "未命名模型"}」将被移除，此操作不可撤销。`,
      confirmText: "删除",
      tone: "danger",
      icon: true,
    });
    if (!ok) return;
    try {
      const res = await deleteModelProfileById(id);
      if (res) {
        if (modelDraft.value?.id === id) cancelModelEdit();
        await loadProviders();
      }
    } catch (e) {
      console.error("删除模型失败:", e);
    }
  }

  /* ==================== 模型列表发现 ==================== */

  async function discoverModels() {
    const providerId = currentProvider.value?.id;
    if (!providerId) {
      vaToaster.add({ title: "请先保存供应商，再拉取模型列表", kind: "warning" });
      return;
    }
    isDiscovering.value = true;
    try {
      const res = await discoverProviderModels(providerId);
      if (res?.ok && res.models) {
        discoveredModels.value = res.models;
        discoveredItems.value = res.items ?? [];
        const withCap = discoveredItems.value.filter((i) => i.capabilities).length;
        vaToaster.add({
          title: `已拉取 ${res.models.length} 个可用模型`,
          description: withCap > 0 ? `其中 ${withCap} 个可自动填充能力信息` : "该供应商未提供能力信息，需手动填写",
          kind: "success",
        });
      } else {
        vaToaster.add({ title: `拉取失败：${res?.error || "端点无响应"}`, kind: "warning" });
      }
    } catch (e: any) {
      vaToaster.add({ title: `拉取失败: ${e.message || String(e)}`, kind: "warning" });
    } finally {
      isDiscovering.value = false;
    }
  }

  /**
   * 选中某个探测到的模型：自动填充模型标识、显示名与能力元数据。
   * 来源标记为 detected，用户仍可手动覆盖（覆盖后写回 declared 由保存时决定）。
   */
  function applyDetected(item: DetectedModelInfo) {
    const draft = modelDraft.value;
    if (!draft) return;
    const detectedCap = item.capabilities;
    const merged: ModelCapabilities = {
      ...(draft.capabilities || {}),
      ...(detectedCap || {}),
      source: detectedCap ? "detected" : draft.capabilities?.source || "declared",
    };
    modelDraft.value = {
      ...draft,
      model: item.id,
      name: draft.name?.trim() ? draft.name : item.displayName || item.id,
      contextWindow: detectedCap?.contextWindow || draft.contextWindow,
      capabilities: merged,
    };
  }

  /* ==================== 能力验证（TASK-058） ==================== */

  const isVerifyingCapabilities = ref(false);
  /** 当前模型编辑器对应的验证结果；换模型/收起草稿时清空 */
  const capabilityVerdicts = ref<CapabilityVerdict[]>([]);

  async function verifyCapabilities() {
    const draft = modelDraft.value;
    if (!draft?.id || isVerifyingCapabilities.value) return;
    const probeCount =
      (draft.capabilities?.inputModalities?.includes("image") ? 1 : 0) +
      (draft.capabilities?.reasoning?.supported ? 1 : 0);
    if (probeCount === 0) {
      vaToaster.add({ title: "未勾选可探测能力", kind: "info" });
      return;
    }
    const ok = await vaConfirm({
      title: `发起 ${probeCount} 次最小探测请求？`,
      description: "将按勾选能力逐项实测端点行为（max_tokens=1 压成本），产生少量真实 API 费用。",
      confirmText: "开始验证",
      tone: "default",
      icon: true,
    });
    if (!ok) return;

    isVerifyingCapabilities.value = true;
    capabilityVerdicts.value = [];
    try {
      const res = await verifyModelCapabilities(draft.id);
      if (res) {
        capabilityVerdicts.value = res.results ?? [];
        if (capabilityVerdicts.value.length === 0) {
          vaToaster.add({ title: res.note || "未勾选可探测能力", kind: "info" });
        }
      }
    } catch (e: any) {
      vaToaster.add({ title: `验证失败: ${e.message || String(e)}`, kind: "danger" });
    } finally {
      isVerifyingCapabilities.value = false;
    }
  }

  /* ==================== 连通性测试 ==================== */

  /**
   * 连通性测试。
   *
   * 端点解析必须带上下文，否则会测错地方：
   *   · 编辑已保存模型 → 传 profileId，服务端 hydrate 出所属供应商的凭证
   *   · 新建模型（草稿无 id）→ 传 providerId（草稿所属供应商），仍然测的是用户配的端点
   *   · 未编辑任何模型 → 传当前选中的供应商
   * 三者都缺失时会退回服务端环境变量，那测的就不是用户的配置了。
   */
  async function testModelConnection() {
    isTestingConnection.value = true;
    testStatus.value = null;
    try {
      const draft = modelDraft.value;
      const result = await testModelConnectionApi({
        profileId: draft?.id || undefined,
        providerId: draft ? draft.providerId || currentProvider.value?.id : currentProvider.value?.id,
        model: draft?.model?.trim() || discoveredModels.value[0] || "gpt-4o-mini",
      });
      testStatus.value = result.ok
        ? {
            ok: true,
            message: `连通性正常：${result.model} @ ${result.endpoint}（首响应 ${result.latencyMs}ms）`,
          }
        : { ok: false, message: `探测失败（${result.latencyMs}ms）：${result.error || "端点无响应"}` };
    } catch (e: any) {
      testStatus.value = { ok: false, message: `探测失败: ${e.message || String(e)}` };
    } finally {
      isTestingConnection.value = false;
    }
  }

  /* ==================== 能力标记辅助（作用于 modelDraft） ==================== */

  function toggleModality(mod: string) {
    const draft = modelDraft.value;
    if (!draft) return;
    const cap = draft.capabilities || {};
    const current = new Set(cap.inputModalities || ["text"]);
    current.has(mod as any) ? current.delete(mod as any) : current.add(mod as any);
    current.add("text"); // 文本恒可用
    modelDraft.value = { ...draft, capabilities: { ...cap, inputModalities: [...current] as any } };
  }

  function toggleReasoning() {
    const draft = modelDraft.value;
    if (!draft) return;
    const cap = draft.capabilities || {};
    const supported = !cap.reasoning?.supported;
    modelDraft.value = {
      ...draft,
      capabilities: {
        ...cap,
        reasoning: supported
          ? { supported: true, supportedEfforts: ["low", "medium", "high"], defaultEffort: "medium" }
          : { supported: false },
      },
    };
  }

  function toggleToolUse() {
    const draft = modelDraft.value;
    if (!draft) return;
    const cap = draft.capabilities || {};
    const params = new Set(cap.supportedParameters || ["temperature"]);
    params.has("tools") ? params.delete("tools") : params.add("tools");
    modelDraft.value = { ...draft, capabilities: { ...cap, supportedParameters: [...params] } };
  }

  return {
    /* 会话级 */
    availableModels,
    activeModel,
    activeModelObj,
    activeModelCapabilities,
    supportsImageInput,
    /* 推理档位（能力运行时 P1，TASK-052 会话级隔离） */
    reasoningEffort,
    setReasoningEffort,
    reasoningEffortOptions,
    defaultModelId,
    resetModelToDefault,
    /* 设置面板 */
    isModelSettingsOpen,
    providers,
    modelProfiles,
    selectedProviderId,
    isCreatingProvider,
    currentProvider,
    currentProviderModels,
    providerForm,
    modelDraft,
    isCreatingModel,
    showApiKey,
    isTestingConnection,
    isDiscovering,
    testStatus,
    discoveredModels,
    discoveredItems,
    /* 加载 */
    loadProviders,
    fetchModelProfiles,
    openModelSettings,
    closeModelSettings,
    /* 供应商 */
    selectProvider,
    startCreateProvider,
    onProviderKindChange,
    saveProvider,
    deleteProvider,
    /* 模型 */
    startCreateModel,
    editModel,
    cancelModelEdit,
    saveModel,
    deleteModel,
    /* 辅助 */
    isVerifyingCapabilities,
    capabilityVerdicts,
    verifyCapabilities,
    discoverModels,
    applyDetected,
    testModelConnection,
    toggleModality,
    toggleReasoning,
    toggleToolUse,
  };
}
