<script setup lang="ts">
import { computed, ref } from "vue";
import type { AIWorkspaceEvents, AIWorkspaceProps } from "./types";
import type { WorkspaceFile } from "./types";
import { FILE_STATUS_LABEL } from "../file-tree/types";

const props = defineProps<AIWorkspaceProps>();

const emit = defineEmits<AIWorkspaceEvents>();

const touched = ref(false);
const inner = ref<string | undefined>(props.defaultSelected ?? props.files[0]?.id);
const selectedId = computed(() =>
  props.selected !== undefined || touched.value ? props.selected : inner.value,
);

function open(f: WorkspaceFile) {
  touched.value = true;
  inner.value = f.id;
  emit("update:selected", f.id);
  emit("openFile", f);
}

const current = computed(() => props.files.find((f) => f.id === selectedId.value));
</script>

<template>
  <div class="va-ws">
    <aside class="va-ws__files" :aria-label="props.filesLabel ?? '工作区文件'">
      <h3 class="va-ws__label">{{ props.filesLabel ?? "工作区文件" }}</h3>
      <button
        v-for="f in props.files"
        :key="f.id"
        class="va-ws__file"
        type="button"
        :data-selected="f.id === selectedId"
        @click="open(f)"
      >
        <span v-if="f.status" class="va-ws__status" :data-status="f.status">{{ FILE_STATUS_LABEL[f.status] }}</span>
        <span class="va-ws__name">{{ f.name }}</span>
      </button>
      <p v-if="!props.files.length" class="va-ws__none">没有文件</p>
    </aside>

    <section class="va-ws__preview" :aria-label="props.previewLabel ?? current?.name ?? '预览'">
      <h3 class="va-ws__label">{{ props.previewLabel ?? current?.name ?? "预览" }}</h3>
      <div class="va-ws__body">
        <slot :file="current" />
      </div>
    </section>
  </div>
</template>

<style src="./VaAIWorkspace.css"></style>
