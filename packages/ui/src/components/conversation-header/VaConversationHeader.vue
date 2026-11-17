<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from "vue";
import { Check, Pen, X } from "lucide-vue-next";
import type { ConversationHeaderEvents, ConversationHeaderProps, HeaderView } from "./types";

const props = withDefaults(defineProps<ConversationHeaderProps>(), {
  title: "",
  running: false,
  elapsedLabel: "",
  waitingApproval: false,
  views: () => [{ id: "chat", label: "聊天" }],
  activeView: "",
  renamable: true,
});

const emit = defineEmits<ConversationHeaderEvents>();

const activeId = computed(() => props.activeView || props.views[0]?.id || "");
const title = computed(() => props.title || "未命名会话");

/* 行内重命名 */
const editing = ref(false);
const draft = ref("");
const inputEl = useTemplateRef<HTMLInputElement>("input");
function startRename() {
  if (!props.renamable) return;
  draft.value = props.title;
  editing.value = true;
  void nextTick(() => inputEl.value?.select());
}
function commit() {
  const t = draft.value.trim();
  if (t && t !== props.title) emit("rename", t);
  editing.value = false;
}
function cancel() {
  editing.value = false;
}
</script>

<template>
  <header class="va-chead">
    <template v-if="editing">
      <input
        ref="input"
        v-model="draft"
        class="va-chead__input"
        type="text"
        maxlength="60"
        aria-label="重命名会话"
        @keydown.enter.prevent="commit"
        @keydown.escape.prevent="cancel"
      />
      <button class="va-chead__op" type="button" aria-label="确认重命名" @click="commit"><Check :size="14" /></button>
      <button class="va-chead__op" type="button" aria-label="取消重命名" @click="cancel"><X :size="14" /></button>
    </template>
    <template v-else>
      <span class="va-chead__title" :title="title">{{ title }}</span>
      <button v-if="props.renamable" class="va-chead__op" type="button" aria-label="重命名会话" @click="startRename"><Pen :size="13" /></button>
    </template>

    <nav v-if="props.views.length > 1" class="va-chead__views" role="tablist" aria-label="会话视图">
      <button
        v-for="v in props.views as HeaderView[]"
        :key="v.id"
        class="va-chead__view"
        type="button"
        role="tab"
        :aria-selected="v.id === activeId"
        :data-active="v.id === activeId || undefined"
        @click="emit('update:activeView', v.id)"
      >{{ v.label }}</button>
    </nav>

    <span class="va-chead__spacer" />

    <span v-if="props.waitingApproval" class="va-chead__badge va-chead__badge--warn">待审批</span>
    <span v-else-if="props.running" class="va-chead__badge va-chead__badge--run">
      <span class="va-chead__run-dot" aria-hidden="true" />
      运行中<template v-if="props.elapsedLabel"> {{ props.elapsedLabel }}</template>
    </span>
  </header>
</template>

<style src="./VaConversationHeader.css"></style>
