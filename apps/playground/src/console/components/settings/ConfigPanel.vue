<script setup lang="ts">
/**
 * 配置中心通用面板（TASK-028）：服务端 CONFIG_SCHEMA 表驱动渲染。
 * - 按 field.type 分发控件：boolean→开关（复用 va-settings__switch）、
 *   number→数字输入（min/max 本地钳制 + toast 提示，服务端写路径二次钳制）、
 *   string/text→单行/多行文本、select→下拉；
 * - field.locked（env 部署级强制锁命中）→ 控件只读 + 锁标记，PATCH 提交由服务端 400 兜底；
 * - field.risk → 风险徽标（复用 TASK-020 toolRiskMetaOf 描述表）；
 * - 本组件只上报 patch/reset 意图，乐观更新 + 失败回滚 + 持久化由父级编排
 *   （与 ToolsPanel 同一模式）；新增配置项只需扩展服务端 schema，零组件改动。
 */
import { Lock, RotateCcw } from "lucide-vue-next";
import { reactive, watch } from "vue";
import { VaSelect, vaToaster } from "@vuagent/ui";
import { toolRiskMetaOf } from "./types";
import type { ConfigField, ConfigNamespace } from "../../api/client";

const props = defineProps<{
  /** 命名空间（schema + 生效值；父级经 /api/config 拉取） */
  namespace: ConfigNamespace | null;
  /** 首次拉取中 */
  loading: boolean;
  /** 拉取失败提示 */
  loadError: string;
}>();

const emit = defineEmits<{
  (e: "patch", key: string, value: unknown): void;
  (e: "reset"): void;
}>();

function valueOf(field: ConfigField): unknown {
  return props.namespace?.values?.[field.key] ?? field.default;
}

/**
 * 键入中的草稿（@input 记录，@change 提交后收敛）：
 * Vue 的 :value 补丁以 vnode 为准——DOM 值与绑定值不一致时，下一次重渲染会把
 * 用户未提交的输入重置回绑定值。其他字段 PATCH 回写触发重渲染时不能冲掉
 * 正在键入的内容，故文本类输入以草稿驱动显示。
 */
const drafts = reactive<Record<string, string>>({});

function displayValue(field: ConfigField): string {
  return drafts[field.key] ?? String(valueOf(field) ?? "");
}

function onDraftInput(field: ConfigField, e: Event) {
  drafts[field.key] = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
}

/** 草稿收敛：三种情形丢弃草稿并回显外部值——
 *  ① 提交值已回写（ext === 草稿）；
 *  ② 本字段生效值被外部改动（回滚 / 他人 PATCH）；
 *  ③ 整命名空间恢复默认（isDefault 翻真，见下方 watch）。
 *  其他字段变化（本字段生效值未动）保留草稿，不打断键入。 */
const externalSnapshot = reactive<Record<string, string>>({});

watch(
  () => props.namespace?.values,
  (vals) => {
    if (!vals) return;
    for (const [key, text] of Object.entries(drafts)) {
      const ext = String(vals[key] ?? "");
      if (ext === text || ext !== (externalSnapshot[key] ?? "")) delete drafts[key];
    }
    for (const key of Object.keys(externalSnapshot)) delete externalSnapshot[key];
    for (const [key, raw] of Object.entries(vals)) externalSnapshot[key] = String(raw ?? "");
  },
  { deep: true, immediate: true }
);

/** 恢复默认：整命名空间的值回到出厂设置，任何未提交草稿都失效 */
watch(
  () => props.namespace?.isDefault,
  (isDefault) => {
    if (!isDefault) return;
    for (const key of Object.keys(drafts)) delete drafts[key];
  }
);

/** number 输入提交：本地按 min/max 钳制（被钳制时提示），再以 change 事件上报 */
function onNumberCommit(field: ConfigField, e: Event) {
  const input = e.target as HTMLInputElement;
  // 空串/非数值：不提交，回显当前生效值（Number("") === 0 的 JS 陷阱——
  // 清空字段 blur 不能被当作「改成 0 再钳到 min」静默提交）
  if (input.value.trim() === "") {
    delete drafts[field.key];
    input.value = String(valueOf(field));
    return;
  }
  const raw = Number(input.value);
  if (!Number.isFinite(raw)) {
    delete drafts[field.key];
    input.value = String(valueOf(field));
    return;
  }
  let v = raw;
  if (field.min !== undefined) v = Math.max(field.min, v);
  if (field.max !== undefined) v = Math.min(field.max, v);
  if (v !== raw) {
    vaToaster.add({
      title: "已按取值范围钳制",
      description: `${field.title} 允许范围 ${field.min ?? "-∞"} ~ ${field.max ?? "+∞"}，已调整为 ${v}`,
      kind: "warning",
    });
    input.value = String(v);
  }
  // 草稿写成钳制值驱动显示，PATCH 回写收敛后由 watch 清除
  drafts[field.key] = String(v);
  if (v !== valueOf(field)) emit("patch", field.key, v);
}

/** string/text 提交：变更才上报（服务端写路径负责 maxLength 截断） */
function onTextCommit(field: ConfigField, e: Event) {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement;
  const v = el.value;
  if (v !== valueOf(field)) {
    emit("patch", field.key, v);
  } else {
    // 无实际变更（键入又改回）：草稿即刻收敛
    delete drafts[field.key];
  }
}

/** VaSelect 单选写回：SelectValue(string|string[]) 归一为 string，语义与原 onChange 一致 */
function onSelectModel(field: ConfigField, v: unknown) {
  const val = Array.isArray(v) ? String(v[0] ?? "") : String(v);
  if (val !== valueOf(field)) emit("patch", field.key, val);
}

function onToggle(field: ConfigField) {
  if (field.locked) return;
  emit("patch", field.key, !valueOf(field));
}
</script>

<template>
  <div class="va-settings__panel va-settings__panel--config">
    <div class="va-settings__section">
      <div>
        <div class="va-settings__section-title">{{ namespace?.title ?? "" }}</div>
        <p class="va-console__modal-sub" style="margin-top: 2px">
          {{ namespace?.description ?? "" }}；修改即时生效并由服务端持久化
        </p>
      </div>

      <!-- 拉取失败态 -->
      <p v-if="loadError" class="va-settings__tools-error">{{ loadError }}</p>

      <!-- 加载态 -->
      <p v-else-if="loading" class="va-settings__tools-loading">正在加载配置…</p>

      <!-- 空态 -->
      <p v-else-if="!namespace" class="va-settings__tools-loading">配置不可用</p>

      <!-- schema 驱动字段列表 -->
      <div v-else class="va-settings__toggle-list">
        <div v-for="field in namespace.fields" :key="field.key" class="va-settings__toggle-row">
          <div class="va-settings__toggle-text">
            <div class="va-settings__tool-headline">
              <span class="va-settings__toggle-title">{{ field.title }}</span>
              <span
                v-if="field.risk"
                class="va-settings__tool-badge"
                :class="toolRiskMetaOf(field.risk).className"
              >
                {{ toolRiskMetaOf(field.risk).label }}
              </span>
              <span v-if="field.locked" class="va-settings__config-lock" :title="`由环境变量 ${field.envLock} 锁定`">
                <Lock :size="12" /> env 锁定
              </span>
            </div>
            <span class="va-settings__toggle-desc">{{ field.description }}</span>
            <span v-if="field.locked" class="va-settings__toggle-desc va-settings__config-lock-note">
              由环境变量 {{ field.envLock }} 显式设置锁定（部署级），不可在此修改
            </span>
          </div>

          <!-- boolean → 开关 -->
          <button
            v-if="field.type === 'boolean'"
            class="va-settings__switch"
            :class="{ 'va-settings__switch--on': valueOf(field) === true }"
            type="button"
            role="switch"
            :aria-checked="valueOf(field) === true"
            :aria-label="field.title"
            :disabled="field.locked"
            @click="onToggle(field)"
          >
            <span class="va-settings__switch-knob" />
          </button>

          <!-- number → 数字输入（blur/enter 提交，本地钳制；草稿驱动显示防重渲染冲掉键入） -->
          <input
            v-else-if="field.type === 'number'"
            class="va-console__input va-settings__config-input"
            type="number"
            :value="displayValue(field)"
            :min="field.min"
            :max="field.max"
            :disabled="field.locked"
            :aria-label="field.title"
            @input="onDraftInput(field, $event)"
            @change="onNumberCommit(field, $event)"
          />

          <!-- text → 多行文本（草稿驱动显示） -->
          <textarea
            v-else-if="field.type === 'text'"
            class="va-console__input va-settings__config-textarea"
            :value="displayValue(field)"
            :maxlength="field.maxLength"
            :disabled="field.locked"
            :aria-label="field.title"
            rows="4"
            @input="onDraftInput(field, $event)"
            @change="onTextCommit(field, $event)"
          />

          <!-- select → 下拉（VaSelect：键盘导航 + listbox 语义；写回语义与原 onChange 一致） -->
          <VaSelect
            v-else-if="field.type === 'select'"
            size="sm"
            :model-value="String(valueOf(field) ?? '')"
            :options="field.options ?? []"
            :disabled="field.locked"
            :label="field.title"
            @update:model-value="(v: unknown) => onSelectModel(field, v)"
          />

          <!-- string → 单行文本（草稿驱动显示） -->
          <input
            v-else
            class="va-console__input va-settings__config-input"
            type="text"
            :value="displayValue(field)"
            :maxlength="field.maxLength"
            :disabled="field.locked"
            :aria-label="field.title"
            @input="onDraftInput(field, $event)"
            @change="onTextCommit(field, $event)"
          />
        </div>
      </div>

      <!-- 恢复默认（有覆盖项时展示） -->
      <div v-if="namespace && !namespace.isDefault" class="va-settings__config-footer">
        <button
          class="va-console__btn-add-profile va-settings__config-reset"
          type="button"
          @click="emit('reset')"
        >
          <RotateCcw :size="13" style="vertical-align: -2px; margin-right: 4px" />
          恢复默认
        </button>
      </div>
    </div>
  </div>
</template>
