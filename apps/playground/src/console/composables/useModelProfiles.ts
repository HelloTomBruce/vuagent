/**
 * 模型配置数据域：Profile CRUD / provider 预填 / 设置弹窗状态
 * 从原 Console.vue 模型设置逻辑平移（testModelConnection 仍为占位探测，TASK-005 接真实现）
 */
import { computed, ref } from "vue";
import {
  createModelProfileApi,
  deleteModelProfileById,
  listModelProfiles,
  testModelConnectionApi,
  updateModelProfileApi,
} from "../api/client";
import type { ModelProfilePayload } from "../api/client";
import { AVAILABLE_MODELS, DEFAULT_MODEL_FORM, PROVIDER_PRESETS } from "../types";
import type { ModelOption, ModelProfileItem } from "../types";

export interface ModelProfilesOptions {
  /** 打开设置弹窗前关闭下拉菜单（原 openModelSettings 首行 closeAllMenus） */
  closeMenus?: () => void;
}

export function useModelProfiles(options: ModelProfilesOptions = {}) {
  const availableModels = ref<ModelOption[]>([...AVAILABLE_MODELS]);
  const activeModel = ref("deepseek-v3");
  /** 默认模型档（isDefault 或列表首个），新建会话时回退用 */
  const defaultModelId = ref("");

  // 模型设置弹窗状态
  const isModelSettingsOpen = ref(false);
  const modelProfiles = ref<ModelProfileItem[]>([]);
  const selectedProfileId = ref("");
  const isCreatingNewModel = ref(false);
  const showApiKey = ref(false);
  const isTestingConnection = ref(false);
  const testStatus = ref<{ ok: boolean; message: string } | null>(null);
  const modelForm = ref<ModelProfileItem>({ ...DEFAULT_MODEL_FORM });
  /** API Key 输入框占位：编辑已配置 profile 时显示掩码占位，提示留空保持原密钥（TASK-011） */
  const apiKeyPlaceholder = ref("sk-...");

  const activeModelObj = computed(() => {
    return (
      availableModels.value.find((m) => m.id === activeModel.value) ||
      availableModels.value[0]
    );
  });

  async function fetchModelProfiles() {
    try {
      const list = await listModelProfiles();
      if (list && list.length > 0) {
        modelProfiles.value = list;
        availableModels.value = list.map((m) => ({
          id: m.id,
          label: m.name,
          meta: `${(m.provider || "custom").toUpperCase()} · ${m.model}`,
          contextWindow: m.contextWindow || 128000,
        }));
        if (!activeModel.value || !list.some((m) => m.id === activeModel.value)) {
          const def = list.find((m) => m.isDefault) || list[0];
          defaultModelId.value = def.id;
          activeModel.value = def.id;
        } else {
          defaultModelId.value = (list.find((m) => m.isDefault) || list[0]).id;
        }
      }
    } catch (e) {
      console.error("加载模型列表失败:", e);
    }
  }

  /** 新建会话时回退到默认模型档 */
  function resetModelToDefault() {
    if (defaultModelId.value) activeModel.value = defaultModelId.value;
  }

  function openModelSettings() {
    options.closeMenus?.();
    isModelSettingsOpen.value = true;
    testStatus.value = null;
    if (modelProfiles.value.length > 0) {
      const cur =
        modelProfiles.value.find((m) => m.id === activeModel.value) ||
        modelProfiles.value[0];
      selectProfileForEdit(cur);
    } else {
      createNewProfile();
    }
  }

  function closeModelSettings() {
    isModelSettingsOpen.value = false;
    testStatus.value = null;
  }

  function selectProfileForEdit(profile: ModelProfileItem) {
    isCreatingNewModel.value = false;
    selectedProfileId.value = profile.id;
    testStatus.value = null;
    // TASK-011：服务端已脱敏回显，编辑态不回填明文密钥；留空保存即保持原密钥
    apiKeyPlaceholder.value = profile.maskedApiKey
      ? `已配置（${profile.maskedApiKey}）· 留空保持不变`
      : "sk-...";
    modelForm.value = {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl || "",
      apiKey: "",
      // 仅展示用：掩码不参与 buildPayload，不会回传服务端
      maskedApiKey: profile.maskedApiKey,
      contextWindow: profile.contextWindow || 128000,
      temperature: profile.temperature ?? 0.2,
      isDefault: !!profile.isDefault,
    };
  }

  function createNewProfile() {
    isCreatingNewModel.value = true;
    selectedProfileId.value = "new";
    testStatus.value = null;
    apiKeyPlaceholder.value = "sk-...";
    modelForm.value = {
      ...DEFAULT_MODEL_FORM,
      name: "新自定义模型",
    };
  }

  function onProviderChange(provider: string) {
    modelForm.value.provider = provider;
    if (!isCreatingNewModel.value) return;
    const preset = PROVIDER_PRESETS[provider];
    modelForm.value.name = preset.name;
    modelForm.value.model = preset.model;
    modelForm.value.baseUrl = preset.baseUrl;
    modelForm.value.contextWindow = preset.contextWindow;
  }

  function buildPayload(): ModelProfilePayload {
    const form = modelForm.value;
    return {
      name: form.name.trim(),
      provider: form.provider,
      model: form.model.trim(),
      baseUrl: form.baseUrl?.trim() || undefined,
      apiKey: form.apiKey?.trim() || undefined,
      contextWindow: form.contextWindow || 128000,
      temperature: form.temperature,
      isDefault: form.isDefault,
    };
  }

  async function saveModelProfile() {
    const form = modelForm.value;
    if (!form.name.trim() || !form.model.trim()) {
      alert("请填写模型名称与模型 ID");
      return;
    }

    try {
      if (isCreatingNewModel.value) {
        const created = await createModelProfileApi(buildPayload());
        if (created) {
          await fetchModelProfiles();
          selectProfileForEdit(created);
          testStatus.value = { ok: true, message: "模型配置已保存成功！" };
        }
      } else {
        const updated = await updateModelProfileApi(form.id, buildPayload());
        if (updated) {
          await fetchModelProfiles();
          testStatus.value = { ok: true, message: "模型配置已成功更新！" };
        }
      }
    } catch (e: any) {
      testStatus.value = { ok: false, message: `保存失败: ${e.message || String(e)}` };
    }
  }

  async function deleteModelProfile(id: string) {
    if (modelProfiles.value.length <= 1) {
      alert("至少保留一个模型配置！");
      return;
    }
    if (!confirm("确认删除该模型配置吗？")) return;
    try {
      const res = await deleteModelProfileById(id);
      if (res) {
        await fetchModelProfiles();
        if (modelProfiles.value.length > 0) {
          selectProfileForEdit(modelProfiles.value[0]);
        } else {
          createNewProfile();
        }
      }
    } catch (e) {
      console.error("删除模型失败:", e);
    }
  }

  /** 连通性真探测（TASK-005）：以表单配置发起最小 chat completion，展示真实首响应时延或错误 */
  async function testModelConnection() {
    isTestingConnection.value = true;
    testStatus.value = null;
    try {
      const form = modelForm.value;
      const result = await testModelConnectionApi({
        // TASK-011：编辑已保存配置时携带 profileId，未重输密钥则探测复用服务端存储凭据
        profileId: isCreatingNewModel.value ? undefined : form.id,
        baseUrl: form.baseUrl?.trim() || undefined,
        apiKey: form.apiKey?.trim() || undefined,
        model: form.model.trim(),
      });
      if (result.ok) {
        testStatus.value = {
          ok: true,
          message: `连通性测试通过：${result.model} @ ${result.endpoint}（首响应 ${result.latencyMs}ms）`,
        };
      } else {
        testStatus.value = {
          ok: false,
          message: `探测失败（${result.latencyMs}ms）：${result.error || "端点无响应"}`,
        };
      }
    } catch (e: any) {
      testStatus.value = {
        ok: false,
        message: `探测失败: ${e.message || String(e)}`,
      };
    } finally {
      isTestingConnection.value = false;
    }
  }

  return {
    availableModels,
    activeModel,
    isModelSettingsOpen,
    modelProfiles,
    selectedProfileId,
    isCreatingNewModel,
    showApiKey,
    isTestingConnection,
    testStatus,
    modelForm,
    apiKeyPlaceholder,
    activeModelObj,
    defaultModelId,
    resetModelToDefault,
    fetchModelProfiles,
    openModelSettings,
    closeModelSettings,
    selectProfileForEdit,
    createNewProfile,
    onProviderChange,
    saveModelProfile,
    deleteModelProfile,
    testModelConnection,
  };
}
