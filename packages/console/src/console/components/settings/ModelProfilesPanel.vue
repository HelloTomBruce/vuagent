<script setup lang="ts">
/**
 * 「模型与 API」设置面板（P0：Provider 1:N Model）
 *
 * 交互形态（用户反馈后调整）：
 *   左列 —— **扁平的供应商列表**，不展开子项，只显示名称与模型数量；
 *   右列 —— 全部配置集中在此：
 *            · 上：供应商凭证（名称/类型/端点/密钥）
 *            · 下：该供应商下的模型清单，点「添加」或某一行即内联展开编辑表单
 *
 * 凭证只在供应商层填写一次，其下所有模型共用——这是本次重构的核心
 * （旧版配第二个模型要复制整条含密钥的配置）。
 */
import { computed, ref, watch } from "vue";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Globe,
  Image as ImageIcon,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Sliders,
  Sparkles,
  Trash2,
  Wrench,
  Zap,
} from "lucide-vue-next";
import { VaSelect } from "@vuagent/ui";
import type { ModelProfileItem, ProviderItem } from "../../types";
import type { DetectedModelInfo } from "../../api/client";
import { capabilityBadges } from "../../utils/capability-badges";
import { PROVIDER_OPTIONS } from "../../types";

const props = defineProps<{
  providers: ProviderItem[];
  selectedProviderId: string;
  isCreatingProvider: boolean;
  currentProvider?: ProviderItem;
  currentProviderModels: ModelProfileItem[];
  providerForm: { id?: string; name: string; provider: string; baseUrl?: string; apiKey?: string; maskedApiKey?: string; parameters?: Record<string, unknown> };
  modelDraft: ModelProfileItem | null;
  isCreatingModel: boolean;
  showApiKey: boolean;
  isTestingConnection: boolean;
  /** 列表行快捷探测进行中的档案 id（该行按钮转圈） */
  testingProfileId: string;
  /** 最近一次行内探测结果（profileId → 结果；进程内存态，面板重开清空） */
  probeResults?: Map<string, { ok: boolean; latencyMs?: number; error?: string; at: number }>;
  isDiscovering: boolean;
  testStatus: { ok: boolean; message: string } | null;
  discoveredModels: string[];
  discoveredItems: DetectedModelInfo[];
  isVerifyingCapabilities: boolean;
  capabilityVerdicts: Array<{ capability: string; ok: boolean | null; detail: string }>;
}>();

const emit = defineEmits<{  (e: "close"): void;
  (e: "select-provider", id: string): void;
  (e: "create-provider"): void;
  (e: "delete-provider", id: string): void;
  (e: "create-model"): void;
  (e: "edit-model", model: ModelProfileItem): void;
  (e: "delete-model", id: string): void;
  (e: "cancel-model-edit"): void;
  (e: "save-provider"): void;
  (e: "save-model"): void;
  (e: "test"): void;
  (e: "discover"): void;
  /** VaSelect 选择模型标识：回填标识 + 显示名称（始终覆盖）+ 能力 */
  (e: "select-model", id: string): void;
  /** 列表行快捷探测：不进编辑表单直接测试已保存模型 */
  (e: "test-model", m: ModelProfileItem): void;
  (e: "provider-kind-change", kind: string): void;
  (e: "update:showApiKey", value: boolean): void;
  (e: "toggle-modality", modality: string): void;
  (e: "toggle-reasoning"): void;
  (e: "toggle-tool-use"): void;
  (e: "verify-capabilities"): void;
}>();

/* ---- 模型标识选择（方案：自动拉取 + VaSelect 列表 + 手动输入兜底） ---- */
/** 拉取失败或候选为空时自动切手动输入（端点不支持 /models 列表的兜底），也可手动切换 */
const manualModelInput = ref(false);
/** 用户显式选择的手动/列表偏好：显式选择后自动翻转不再覆盖（评审 R-4 修复） */
const manualInputPreferred = ref<boolean | null>(null);
function onToggleManual() {
  manualModelInput.value = !manualModelInput.value;
  manualInputPreferred.value = manualModelInput.value;
}
const modelOptions = computed(() =>
  props.discoveredItems.map((d) => ({
    value: d.id,
    label: d.displayName ? `${d.displayName} · ${d.id}` : d.id,
  }))
);
watch(
  () => [props.discoveredModels.length, props.isDiscovering] as const,
  ([len, loading]) => {
    if (loading) return;
    // 候选为空（拉取失败或端点不支持）→ 自动兜底手动；有候选 → 回列表，
    // 但用户显式选择过手动模式则尊重，不再被任何刷新强制翻转
    if (len === 0) manualModelInput.value = true;
    else if (manualInputPreferred.value !== true) manualModelInput.value = false;
  },
);

/** 模型层输入模态候选（文本恒选中且不可取消） */
const MODALITY_OPTIONS = [
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "pdf", label: "PDF", icon: null },
  { id: "audio", label: "音频", icon: null },
  { id: "video", label: "视频", icon: null },
];

/** 模型角标：委托给共享 helper，避免与 composable 各写一份 */
function badges(m: ModelProfileItem): string[] {
  return capabilityBadges({ capabilities: m.capabilities, contextWindow: m.contextWindow });
}

/** 行内探测错误摘要：一行放不下的完整错误悬浮 title 看（§模板 title 绑定） */
function clipProbeError(error?: string): string {
  const msg = (error || "").replace(/\s+/g, " ").trim();
  return msg.length > 42 ? `${msg.slice(0, 42)}…` : msg || "端点无响应";
}

function modalityActive(id: string): boolean {
  return (props.modelDraft?.capabilities?.inputModalities || ["text"]).includes(id as never);
}
function reasoningOn(): boolean {
  return !!props.modelDraft?.capabilities?.reasoning?.supported;
}
function toolsOn(): boolean {
  return !!props.modelDraft?.capabilities?.supportedParameters?.includes("tools");
}

/** 正在编辑的模型 id（用于高亮清单中对应行） */
const editingModelId = computed(() => props.modelDraft?.id || "");
</script>

<template>
  <div class="va-settings__panel va-settings__panel--models">
    <div class="va-console__modal-body">
      <!-- ============ 左列：扁平供应商列表 ============ -->
      <div class="va-console__modal-left">
        <div class="va-console__modal-list-head">
          <span>供应商 ({{ providers.length }})</span>
          <button class="va-console__btn-add-profile" type="button" @click="emit('create-provider')">
            <Plus :size="13" /> 添加
          </button>
        </div>

        <div class="va-console__modal-profile-list">
          <!-- 新建中的占位项 -->
          <div
            v-if="isCreatingProvider"
            class="va-console__profile-card va-console__profile-card--active"
          >
            <div class="va-console__profile-card-top">
              <span class="va-console__profile-name">{{ providerForm.name || "新供应商" }}</span>
              <span class="va-console__new-chip">新建中</span>
            </div>
            <div class="va-console__profile-card-sub">
              <span class="va-console__provider-pill">{{ providerForm.provider }}</span>
            </div>
          </div>

          <div
            v-for="p in providers"
            :key="p.id"
            class="va-console__profile-card"
            :class="{ 'va-console__profile-card--active': p.id === selectedProviderId && !isCreatingProvider }"
            @click="emit('select-provider', p.id)"
          >
            <div class="va-console__profile-card-top">
              <span class="va-console__profile-name">{{ p.name }}</span>
              <span v-if="(p.models || []).length" class="va-prov-count-chip">
                {{ (p.models || []).length }}
              </span>
            </div>
            <div class="va-console__profile-card-sub">
              <span class="va-console__provider-pill">{{ p.provider }}</span>
              <span v-if="p.maskedApiKey" class="va-console__model-id">{{ p.maskedApiKey }}</span>
            </div>
          </div>

          <p v-if="providers.length === 0 && !isCreatingProvider" class="va-console__empty-tip">
            还没有供应商，先添加一个端点与密钥。
          </p>
        </div>
      </div>

      <!-- ============ 右列：全部配置 ============ -->
      <div class="va-console__modal-right">
        <!-- ---------- 供应商凭证 ---------- -->
        <div class="va-settings__panel-heading">
          <p class="va-console__modal-sub">
            端点与密钥在此配置一次，其下所有模型共用；修改后立即对全部模型生效。
          </p>
        </div>

        <div class="va-console__form-row">
          <div class="va-console__form-group flex-1">
            <label class="va-console__label">供应商名称</label>
            <input v-model="providerForm.name" class="va-console__input" type="text" placeholder="如 DeepSeek 官方" />
          </div>
          <div class="va-console__form-group flex-1">
            <label class="va-console__label">类型</label>
            <VaSelect
              :model-value="providerForm.provider"
              :options="PROVIDER_OPTIONS"
              label="供应商类型"
              @update:model-value="(v: unknown) => emit('provider-kind-change', Array.isArray(v) ? String(v[0] ?? '') : String(v))"
            />
          </div>
        </div>

        <div class="va-console__form-group">
          <label class="va-console__label"><Globe :size="12" /> API 基础地址</label>
          <input
            v-model="providerForm.baseUrl"
            class="va-console__input font-mono"
            type="text"
            placeholder="如 https://api.deepseek.com/v1"
          />
        </div>

        <div class="va-console__form-group">
          <label class="va-console__label">
            <Key :size="12" /> API 密钥
            <span v-if="providerForm.maskedApiKey" class="va-console__profile-card-sub" style="margin-left: 6px">
              已配置 {{ providerForm.maskedApiKey }}
            </span>
          </label>
          <div class="va-console__input-with-action">
            <input
              v-model="providerForm.apiKey"
              class="va-console__input font-mono"
              :type="showApiKey ? 'text' : 'password'"
              :placeholder="providerForm.maskedApiKey ? '留空保持原密钥' : 'sk-...'"
            />
            <button class="va-console__input-addon-btn" type="button" @click="emit('update:showApiKey', !showApiKey)">
              <EyeOff v-if="showApiKey" :size="14" />
              <Eye v-else :size="14" />
            </button>
          </div>
        </div>

        <div class="va-prov-actions">
          <button class="va-console__btn-ghost" type="button" @click="emit('save-provider')">
            {{ isCreatingProvider ? "创建供应商" : "保存供应商设置" }}
          </button>
        </div>

        <!-- ---------- 该供应商下的模型 ---------- -->
        <div class="va-model-section">
          <div class="va-model-section__head">
            <span class="va-model-section__title">
              此供应商下的模型
              <span class="va-model-section__count">{{ currentProviderModels.length }}</span>
            </span>
            <button
              class="va-console__btn-add-profile"
              type="button"
              @click="emit('create-model')"
            >
              <Plus :size="12" /> 添加模型
            </button>
          </div>

          <!-- 模型清单 -->
          <div v-if="currentProviderModels.length" class="va-model-list">
            <div
              v-for="m in currentProviderModels"
              :key="m.id"
              class="va-model-row"
              :class="{ 'va-model-row--editing': m.id === editingModelId }"
            >
              <div class="va-model-row__main" @click="emit('edit-model', m)">
                <div class="va-model-row__info">
                  <span class="va-model-row__name">
                    {{ m.name }}
                    <span v-if="m.isDefault" class="va-console__default-chip">默认</span>
                  </span>
                  <span class="va-model-row__id">{{ m.model }}</span>
                  <!-- 最近一次探测结果内联（0.9：toast 易逝且常被遮挡，行内是稳定呈现） -->
                  <span
                    v-if="probeResults?.get(m.id)"
                    class="va-model-row__probe"
                    :class="probeResults.get(m.id)!.ok ? 'va-model-row__probe--ok' : 'va-model-row__probe--fail'"
                    :title="probeResults.get(m.id)!.error || `探测成功 · 首响应 ${probeResults.get(m.id)!.latencyMs}ms`"
                  >
                    {{ probeResults.get(m.id)!.ok
                      ? `✓ 首响应 ${probeResults.get(m.id)!.latencyMs}ms`
                      : `⚠ ${clipProbeError(probeResults.get(m.id)!.error)}` }}
                  </span>
                </div>
                <div class="va-model-row__badges">
                  <span v-for="b in badges(m)" :key="b" class="va-prov-badge">{{ b }}</span>
                </div>
                <button
                  class="va-model-row__edit"
                  type="button"
                  :title="testingProfileId === m.id ? '探测中…' : testingProfileId ? '另有模型探测进行中' : '不进编辑直接测试该模型连通性'"
                  :disabled="!!testingProfileId"
                  @click.stop="emit('test-model', m)"
                >
                  <Loader2 v-if="testingProfileId === m.id" :size="13" class="va-console__spin" />
                  <Zap v-else :size="13" />
                </button>
                <button class="va-model-row__edit" type="button">
                  <ChevronUp v-if="m.id === editingModelId" :size="13" />
                  <ChevronDown v-else :size="13" />
                </button>
                <button
                  class="va-model-row__del"
                  type="button"
                  title="删除该模型"
                  @click.stop="emit('delete-model', m.id)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </div>

          <p v-else-if="!modelDraft" class="va-console__empty-tip">
            {{ isCreatingProvider ? "填写上方供应商信息后，点「添加模型」即可添加模型（将先保存供应商）。" : "该供应商下还没有模型。点「添加模型」即可复用上面的端点与密钥。" }}
          </p>

          <!-- ---------- 内联编辑表单 ---------- -->
          <div v-if="modelDraft" class="va-model-editor">
            <div class="va-model-editor__head">
              <span class="va-model-editor__title">
                {{ isCreatingModel ? "添加模型" : `编辑「${modelDraft.name || "未命名"}」` }}
              </span>
              <button class="va-model-editor__cancel" type="button" @click="emit('cancel-model-edit')">
                收起
              </button>
            </div>

            <div class="va-console__form-row">
              <div class="va-console__form-group flex-1">
                <label class="va-console__label">显示名称</label>
                <input v-model="modelDraft.name" class="va-console__input" type="text" placeholder="如 DeepSeek V3 生产" />
              </div>
              <div class="va-console__form-group flex-1">
                <label class="va-console__label">模型标识 (Model ID)</label>
                <div class="va-console__model-input-row">
                  <!-- 打开供应商后自动拉取可用模型 → 列表选择（可搜索）；拉取失败/为空自动切手动输入兜底 -->
                  <VaSelect
                    v-if="!manualModelInput"
                    class="va-console__model-select"
                    :model-value="modelDraft.model || ''"
                    :options="modelOptions"
                    searchable
                    :disabled="isDiscovering"
                    :placeholder="isDiscovering ? '正在拉取模型列表…' : modelOptions.length ? '选择模型标识（可搜索）' : '暂无候选：刷新或手动输入'"
                    :label="'模型标识'"
                    :invalid="!modelDraft.model?.trim()"
                    @update:model-value="(v: unknown) => v && emit('select-model', String(v))"
                  />
                  <input
                    v-else
                    v-model="modelDraft.model"
                    class="va-console__input font-mono"
                    type="text"
                    placeholder="如 deepseek-chat"
                    list="va-discovered-models"
                  />
                  <button
                    class="va-console__model-refresh-btn"
                    type="button"
                    :disabled="isDiscovering"
                    title="从供应商拉取可用模型列表"
                    @click="emit('discover')"
                  >
                    <Loader2 v-if="isDiscovering" :size="14" class="va-console__spin" />
                    <RefreshCw v-else :size="14" />
                  </button>
                </div>
                <button
                  type="button"
                  class="va-console__model-manual-toggle"
                  @click="onToggleManual"
                >
                  {{ manualModelInput ? "改为列表选择" : "列表里没有？手动输入标识" }}
                </button>
                <datalist id="va-discovered-models">
                  <option v-for="d in discoveredModels" :key="d" :value="d" />
                </datalist>
              </div>
            </div>

            <!-- 能力元数据 -->
            <div class="va-cap-block">
              <div class="va-cap-block__title">
                <Sparkles :size="12" /> 能力标记
                <span class="va-cap-block__hint">决定附件入口、上下文仪表等行为</span>
                <button
                  v-if="modelDraft.id"
                  class="va-console__btn-ghost va-cap-block__verify"
                  type="button"
                  :disabled="isVerifyingCapabilities"
                  title="按勾选能力逐项实测端点行为（产生少量真实 API 费用）"
                  @click="emit('verify-capabilities')"
                >
                  <Loader2 v-if="isVerifyingCapabilities" :size="12" class="va-console__spin" />
                  <CheckCircle2 v-else :size="12" />
                  验证能力
                </button>
              </div>

              <!-- 验证结果三态（TASK-058） -->
              <ul v-if="capabilityVerdicts.length" class="va-cap-verdicts">
                <li
                  v-for="v in capabilityVerdicts"
                  :key="v.capability"
                  class="va-cap-verdict"
                  :data-ok="v.ok === true || undefined"
                  :data-fail="v.ok === false || undefined"
                  :title="v.detail"
                >
                  <span class="va-cap-verdict__mark">{{ v.ok === true ? "✓" : v.ok === false ? "✗" : "?" }}</span>
                  <span class="va-cap-verdict__name">{{ v.capability === "image" ? "图片输入" : v.capability === "reasoning" ? "推理档位" : v.capability }}</span>
                  <span class="va-cap-verdict__detail">{{ v.ok === false ? "端点拒绝，建议取消勾选" : v.ok === null ? "无法判定（鉴权/网络）" : "通过" }}</span>
                </li>
              </ul>

              <div class="va-console__form-row">
                <div class="va-console__form-group flex-1">
                  <label class="va-console__label">上下文窗口 (tokens)</label>
                  <input
                    v-model.number="modelDraft.contextWindow"
                    class="va-console__input font-mono"
                    type="number"
                    step="1000"
                    placeholder="128000"
                  />
                </div>
                <div class="va-console__form-group flex-1">
                  <label class="va-console__label">最大输出 (tokens)</label>
                  <input
                    v-model.number="modelDraft.capabilities!.maxOutputTokens"
                    class="va-console__input font-mono"
                    type="number"
                    step="1000"
                    placeholder="可选"
                  />
                </div>
              </div>

              <div class="va-console__form-group">
                <label class="va-console__label">输入模态</label>
                <div class="va-cap-chips">
                  <span class="va-cap-chip va-cap-chip--locked">文本</span>
                  <button
                    v-for="opt in MODALITY_OPTIONS"
                    :key="opt.id"
                    class="va-cap-chip"
                    :class="{ 'va-cap-chip--on': modalityActive(opt.id) }"
                    type="button"
                    @click="emit('toggle-modality', opt.id)"
                  >
                    <ImageIcon v-if="opt.id === 'image'" :size="11" />
                    {{ opt.label }}
                  </button>
                </div>
              </div>

              <div class="va-cap-toggles">
                <button
                  class="va-cap-toggle"
                  :class="{ 'va-cap-toggle--on': reasoningOn() }"
                  type="button"
                  @click="emit('toggle-reasoning')"
                >
                  <Sparkles :size="12" />
                  <span>支持推理</span>
                  <Check v-if="reasoningOn()" :size="12" class="va-cap-toggle__check" />
                </button>
                <button
                  class="va-cap-toggle"
                  :class="{ 'va-cap-toggle--on': toolsOn() }"
                  type="button"
                  @click="emit('toggle-tool-use')"
                >
                  <Wrench :size="12" />
                  <span>支持工具调用</span>
                  <Check v-if="toolsOn()" :size="12" class="va-cap-toggle__check" />
                </button>
              </div>
            </div>

            <div class="va-console__form-row">
              <div class="va-console__form-group flex-1">
                <label class="va-console__label">
                  <Sliders :size="12" /> 默认温度 ({{ modelDraft.temperature }})
                </label>
                <input
                  v-model.number="modelDraft.temperature"
                  class="va-console__range"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                />
              </div>
              <div class="va-console__form-group flex-1">
                <div class="va-console__checkbox-row" style="margin-top: 22px">
                  <label class="va-console__checkbox-label">
                    <input v-model="modelDraft.isDefault" type="checkbox" />
                    <span>设为全局默认模型</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="va-model-editor__foot">
              <button class="va-console__btn-ghost" type="button" @click="emit('cancel-model-edit')">
                取消
              </button>
              <button class="va-console__btn-primary" type="button" @click="emit('save-model')">
                {{ isCreatingModel ? "添加" : "保存" }}
              </button>
            </div>
          </div>
        </div>

        <!-- 测试状态 -->
        <div
          v-if="testStatus"
          class="va-console__test-status-box"
          :class="{
            'va-console__test-status-box--ok': testStatus.ok,
            'va-console__test-status-box--err': !testStatus.ok,
          }"
        >
          <CheckCircle2 v-if="testStatus.ok" :size="14" />
          <AlertCircle v-else :size="14" />
          <span>{{ testStatus.message }}</span>
        </div>
      </div>
    </div>

    <!-- ============ 底栏 ============ -->
    <div class="va-console__modal-foot">
      <div class="va-console__foot-left">
        <button
          v-if="!isCreatingProvider && currentProvider"
          class="va-console__btn-delete-profile"
          type="button"
          @click="emit('delete-provider', currentProvider.id)"
        >
          <Trash2 :size="13" /> 删除供应商
        </button>
      </div>

      <div class="va-console__foot-right">
        <button
          class="va-console__btn-ghost"
          :disabled="isTestingConnection || !modelDraft?.model?.trim()"
          :title="modelDraft?.model?.trim() ? '向该模型发起最小探测（产生 1 token 费用）' : '先选择或填写模型标识再测试'"
          type="button"
          @click="emit('test')"
        >
          <Loader2 v-if="isTestingConnection" :size="13" class="va-console__spin" />
          <Zap v-else :size="13" />
          <span>测试连通性</span>
        </button>
        <button class="va-console__btn-ghost" type="button" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>
