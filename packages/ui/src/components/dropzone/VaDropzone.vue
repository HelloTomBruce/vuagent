<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { DropzoneEvents, DropzoneProps } from "./types";
import { useDropzone } from "./useDropzone";

const props = defineProps<DropzoneProps>();

const emit = defineEmits<DropzoneEvents>();

const inputEl = useTemplateRef<HTMLInputElement>("input");
const {
  dragging,
  onDragenter,
  onDragover,
  onDragleave,
  onDrop,
  openPicker,
  onInputChange,
  formatBytes,
} = useDropzone(props, inputEl, {
  add: (files) => emit("add", files),
  reject: (files, reason) => emit("reject", files, reason),
});

function onZoneKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    openPicker();
  }
}
</script>

<template>
  <div class="va-drop">
    <div
      class="va-drop__zone"
      :class="{ 'va-drop__zone--over': dragging, 'va-drop__zone--busy': props.busy }"
      role="button"
      tabindex="0"
      :aria-label="props.label ?? '点击或拖入文件上传'"
      :aria-disabled="props.busy"
      @click="openPicker"
      @keydown="onZoneKeydown"
      @dragenter="onDragenter"
      @dragover="onDragover"
      @dragleave="onDragleave"
      @drop="onDrop"
    >
      <span class="va-drop__arrow" aria-hidden="true">↑</span>
      <p class="va-drop__label">{{ props.label ?? (props.multiple ? "拖入或点击选择文件" : "拖入或点击选择文件") }}</p>
      <p class="va-drop__hint">
        {{ props.accept ? `支持 ${props.accept}` : "任意文件类型" }}
        {{ props.maxSizeMb ? ` · 单个 ≤ ${props.maxSizeMb}MB` : "" }}
      </p>
      <input
        ref="input"
        class="va-drop__input"
        type="file"
        :accept="props.accept"
        :multiple="props.multiple"
        aria-hidden="true"
        tabindex="-1"
        @change="onInputChange"
      >
    </div>

    <ul v-if="props.files.length" class="va-drop__list">
      <li
        v-for="f in props.files"
        :key="f.id"
        class="va-drop__file"
        :data-status="f.status ?? (f.error ? 'error' : f.progress !== undefined && f.progress < 100 ? 'uploading' : 'done')"
      >
        <span class="va-drop__icon" aria-hidden="true">
          <template v-if="f.status === 'error' || f.error">!</template>
          <template v-else-if="(f.status ?? 'done') === 'done' && (f.progress ?? 100) >= 100">✓</template>
          <template v-else>↑</template>
        </span>
        <div class="va-drop__meta">
          <div class="va-drop__line">
            <span class="va-drop__name">{{ f.name }}</span>
            <span class="va-drop__size">{{ formatBytes(f.size) }}</span>
            <span v-if="f.error" class="va-drop__err" role="alert">{{ f.error }}</span>
            <span v-else-if="(f.progress ?? 100) < 100" class="va-drop__pct">{{ Math.round(f.progress ?? 0) }}%</span>
          </div>
          <div v-if="!f.error && (f.progress ?? 100) < 100" class="va-drop__track">
            <span class="va-drop__bar" :style="{ width: `${f.progress ?? 0}%` }" />
          </div>
        </div>
        <button
          class="va-drop__remove"
          type="button"
          :aria-label="`移除 ${f.name}`"
          @click="emit('remove', f.id)"
        >×</button>
      </li>
    </ul>
  </div>
</template>

<style src="./VaDropzone.css"></style>
