<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { Check, ChevronDown, FileText, Loader2, Paperclip, Shield, X, Zap } from "lucide-vue-next";
import type { ComposerEvents, ComposerProps } from "./types";
import { useComposer } from "./useComposer";

const props = withDefaults(defineProps<ComposerProps>(), {
  text: undefined,
  placeholder: "给 agent 一个任务…",
  disabled: false,
  busy: false,
  maxHeight: 160,
  allowEmpty: false,
  models: () => [],
  model: "",
  permissions: () => [],
  permission: "",
  attachable: false,
  uploading: false,
  attachments: () => [],
});

const text = defineModel<string>("text", { default: "" });

const emit = defineEmits<ComposerEvents>();

const area = useTemplateRef<HTMLTextAreaElement>("area");
const { composing, onInput, submit, onKeydown } = useComposer(props, text, area, {
  send: (t) => emit("send", t),
});

/* ---------- 模型 / 权限 seat（G21/G22） ---------- */
const currentModel = computed(() => props.model || props.models[0]?.id || "");
const currentPermission = computed(() => props.permission || props.permissions[0]?.id || "");
const modelOpen = ref(false);
const permOpen = ref(false);
function toggleModel() {
  modelOpen.value = !modelOpen.value;
  permOpen.value = false;
}
function togglePerm() {
  permOpen.value = !permOpen.value;
  modelOpen.value = false;
}
function pickModel(id: string) {
  if (id !== currentModel.value) emit("update:model", id);
  modelOpen.value = false;
}
function pickPermission(id: string) {
  if (id !== currentPermission.value) emit("update:permission", id);
  permOpen.value = false;
}
const modelLabel = computed(() => props.models.find((m) => m.id === currentModel.value)?.label ?? currentModel.value);
const permLabel = computed(() => props.permissions.find((p) => p.id === currentPermission.value)?.label ?? currentPermission.value);

/* ---------- 附件（G23）：回形针 / 拖拽 / 粘贴 ---------- */
const fileInput = useTemplateRef<HTMLInputElement>("file");
const dragging = ref(false);
function onPickFiles() {
  if (props.disabled || props.uploading) return;
  fileInput.value?.click();
}
function onFileChange(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (files?.length) emit("filesSelected", Array.from(files));
  (e.target as HTMLInputElement).value = "";
}
function onDrop(e: DragEvent) {
  dragging.value = false;
  if (!props.attachable || props.disabled) return;
  const files = e.dataTransfer?.files;
  if (files?.length) emit("filesSelected", Array.from(files));
}
function onPaste(e: ClipboardEvent) {
  if (!props.attachable || props.disabled) return;
  const files = e.clipboardData?.files;
  if (files?.length) {
    e.preventDefault();
    emit("filesSelected", Array.from(files));
  }
}

function fmtSize(n?: number): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 宿主聚焦输入区（如新建会话后自动聚焦） */
defineExpose({
  focus: () => area.value?.focus(),
});
</script>

<template>
  <div
    class="va-cmp"
    :class="{ 'va-cmp--busy': props.busy, 'va-cmp--drag': dragging }"
    @dragover.prevent="dragging = props.attachable"
    @dragleave="dragging = false"
    @drop="onDrop"
  >
    <!-- 附件 rail（G23） -->
    <div v-if="props.attachments.length" class="va-cmp__atts">
      <span v-for="a in props.attachments" :key="a.id" class="va-cmp__att">
        <img v-if="a.kind === 'image' && a.previewUrl" class="va-cmp__att-thumb" :src="a.previewUrl" alt="" />
        <FileText v-else :size="13" aria-hidden="true" />
        <span class="va-cmp__att-name" :title="a.name">{{ a.name }}</span>
        <span v-if="a.size !== undefined" class="va-cmp__att-size">{{ fmtSize(a.size) }}</span>
        <button class="va-cmp__att-x" type="button" :aria-label="`移除附件 ${a.name}`" @click="emit('removeAttachment', a.id)">
          <X :size="11" aria-hidden="true" />
        </button>
      </span>
    </div>

    <div v-if="$slots.prefix" class="va-cmp__prefix"><slot name="prefix" /></div>
    <textarea
      ref="area"
      class="va-cmp__area"
      :value="text"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      rows="1"
      @input="onInput"
      @keydown="onKeydown"
      @compositionstart="composing = true"
      @compositionend="composing = false"
      @paste="onPaste"
    />
    <div class="va-cmp__foot">
      <div class="va-cmp__actions">
        <slot name="actions" />

        <!-- 模型 seat（G21） -->
        <span v-if="props.models.length" class="va-cmp__seat-wrap">
          <button class="va-cmp__seat" type="button" :aria-label="`切换模型（当前 ${modelLabel}）`" :disabled="props.disabled" @click.stop="toggleModel">
            <Zap :size="12" aria-hidden="true" />
            <span class="va-cmp__seat-label">{{ modelLabel }}</span>
            <ChevronDown :size="11" aria-hidden="true" />
          </button>
          <div v-if="modelOpen" class="va-cmp__menu" role="menu" aria-label="切换模型">
            <button
              v-for="m in props.models"
              :key="m.id"
              class="va-cmp__menu-row"
              type="button"
              role="menuitem"
              :data-active="m.id === currentModel || undefined"
              @click.stop="pickModel(m.id)"
            >
              <Check v-if="m.id === currentModel" :size="13" aria-hidden="true" />
              <span v-else class="va-cmp__menu-gap" aria-hidden="true" />
              <span class="va-cmp__menu-name">{{ m.label }}</span>
              <span v-if="m.meta" class="va-cmp__menu-meta">{{ m.meta }}</span>
            </button>
          </div>
        </span>

        <!-- 权限 seat（G22） -->
        <span v-if="props.permissions.length" class="va-cmp__seat-wrap">
          <button class="va-cmp__seat" type="button" :aria-label="`权限预设（当前 ${permLabel}）`" :disabled="props.disabled" @click.stop="togglePerm">
            <Shield :size="12" aria-hidden="true" />
            <span class="va-cmp__seat-label">{{ permLabel }}</span>
            <ChevronDown :size="11" aria-hidden="true" />
          </button>
          <div v-if="permOpen" class="va-cmp__menu" role="menu" aria-label="权限预设">
            <button
              v-for="p in props.permissions"
              :key="p.id"
              class="va-cmp__menu-row"
              type="button"
              role="menuitem"
              :data-active="p.id === currentPermission || undefined"
              @click.stop="pickPermission(p.id)"
            >
              <Check v-if="p.id === currentPermission" :size="13" aria-hidden="true" />
              <span v-else class="va-cmp__menu-gap" aria-hidden="true" />
              <span class="va-cmp__menu-col">
                <span class="va-cmp__menu-name">{{ p.label }}</span>
                <span v-if="p.desc" class="va-cmp__menu-desc">{{ p.desc }}</span>
              </span>
            </button>
          </div>
        </span>

        <!-- 附件入口（G23） -->
        <button v-if="props.attachable" class="va-cmp__seat va-cmp__seat--icon" type="button" aria-label="上传附件" title="上传附件（也可拖入/粘贴）" :disabled="props.disabled || props.uploading" @click="onPickFiles">
          <Loader2 v-if="props.uploading" :size="12" class="va-cmp__spin" aria-hidden="true" />
          <Paperclip v-else :size="12" aria-hidden="true" />
        </button>
        <input ref="file" class="va-cmp__file" type="file" multiple hidden @change="onFileChange" />
      </div>
      <!-- busy：发送钮变为停止钮（运行中断）；空闲：正常发送 -->
      <button v-if="props.busy" class="va-cmp__send va-cmp__send--stop" type="button" aria-label="停止运行" title="停止（Esc）" @click="emit('stop')">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        </svg>
      </button>
      <button v-else class="va-cmp__send" type="button" :disabled="props.disabled || (!props.allowEmpty && !text.trim())" aria-label="发送" @click="submit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style src="./VaComposer.css"></style>
