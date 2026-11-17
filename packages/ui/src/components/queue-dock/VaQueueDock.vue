<script setup lang="ts">
import { nextTick, ref, useTemplateRef } from "vue";
import { Check, Pen, X, Zap } from "lucide-vue-next";
import type { QueueDockEvents, QueueDockProps } from "./types";

const props = withDefaults(defineProps<QueueDockProps>(), {
  disabled: false,
});

const emit = defineEmits<QueueDockEvents>();

/* 行内编辑 */
const editingIndex = ref<number | null>(null);
const draft = ref("");
const inputEl = useTemplateRef<HTMLInputElement>("input");
function startEdit(i: number, text: string) {
  if (props.disabled) return;
  editingIndex.value = i;
  draft.value = text;
  void nextTick(() => inputEl.value?.focus());
}
function commitEdit(i: number) {
  const t = draft.value.trim();
  if (t && t !== props.items[i]?.text) emit("edit", i, t);
  editingIndex.value = null;
}
function cancelEdit() {
  editingIndex.value = null;
}
</script>

<template>
  <div class="va-queuedock" role="list" aria-label="排队消息">
    <div v-for="(item, i) in props.items" :key="item.id" class="va-queuedock__row" role="listitem">
      <span class="va-queuedock__tag">排队 {{ i + 1 }}</span>

      <template v-if="editingIndex === i">
        <input
          ref="input"
          v-model="draft"
          class="va-queuedock__input"
          type="text"
          maxlength="2000"
          @keydown.enter.prevent="commitEdit(i)"
          @keydown.escape.prevent="cancelEdit"
        />
        <button class="va-queuedock__op" type="button" aria-label="确认编辑" @click="commitEdit(i)"><Check :size="13" /></button>
        <button class="va-queuedock__op" type="button" aria-label="取消编辑" @click="cancelEdit"><X :size="13" /></button>
      </template>
      <template v-else>
        <span class="va-queuedock__text" :title="item.text">{{ item.text }}</span>
        <button class="va-queuedock__op" type="button" :aria-label="`插队：立即发送第 ${i + 1} 条`" title="插队：run 结束后立即下发" :disabled="props.disabled" @click="emit('sendNow', i)">
          <Zap :size="13" />
        </button>
        <button class="va-queuedock__op" type="button" aria-label="编辑" :disabled="props.disabled" @click="startEdit(i, item.text)"><Pen :size="12" /></button>
        <button class="va-queuedock__op" type="button" aria-label="移除排队" :disabled="props.disabled" @click="emit('remove', i)"><X :size="13" /></button>
      </template>
    </div>
  </div>
</template>

<style src="./VaQueueDock.css"></style>
