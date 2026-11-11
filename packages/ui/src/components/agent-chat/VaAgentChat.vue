<script setup lang="ts">
import { nextTick, onMounted, ref, watch, useTemplateRef } from "vue";
import type { AgentChatEvents, AgentChatProps } from "./types";

const props = defineProps<AgentChatProps>();

const emit = defineEmits<AgentChatEvents>();

const scrollEl = useTemplateRef<HTMLElement>("scroll");

const stick = ref(true);
function onScroll() {
  const el = scrollEl.value;
  if (!el) return;
  stick.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
}

watch(
  () => [props.messages.length, props.thinking],
  () => {
    if (!stick.value) return;
    nextTick(() => {
      const el = scrollEl.value;
      if (el) el.scrollTop = el.scrollHeight;
      emit("scrollToBottom");
    });
  },
);

onMounted(() => {
  const el = scrollEl.value;
  if (el) el.scrollTop = el.scrollHeight;
});

const initials = (m: { role: string }) => (m.role === "user" ? "你" : "A");
</script>

<template>
  <div class="va-chat">
    <header v-if="props.title" class="va-chat__head">{{ props.title }}</header>

    <div
      ref="scroll"
      class="va-chat__stream"
      :style="props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined"
      @scroll="onScroll"
    >
      <p v-if="!props.messages.length && !props.thinking" class="va-chat__empty">
        给 agent 一个任务开始对话。
      </p>

      <div
        v-for="m in props.messages"
        :key="m.id"
        class="va-chat__msg"
        :data-role="m.role"
      >
        <span class="va-chat__avatar" :data-role="m.role" aria-hidden="true">{{ initials(m) }}</span>
        <div class="va-chat__bubble">
          <p class="va-chat__text">{{ m.text }}</p>
          <span v-if="m.tools?.length" class="va-chat__tools">
            <span v-for="t in m.tools" :key="t" class="va-chat__tool">{{ t }}</span>
          </span>
        </div>
      </div>

      <div v-if="props.thinking" class="va-chat__msg" data-role="agent">
        <span class="va-chat__avatar" data-role="agent" aria-hidden="true">A</span>
        <div class="va-chat__bubble va-chat__bubble--thinking">
          <span class="va-chat__pulse" aria-hidden="true" /><span class="va-chat__pulse" aria-hidden="true" /><span class="va-chat__pulse" aria-hidden="true" />
          <span class="va-chat__sr">{{ props.thinkingLabel ?? "思考中…" }}</span>
        </div>
      </div>
      <slot name="stream-foot" />
    </div>

    <footer v-if="!props.composerless" class="va-chat__composer">
      <slot name="composer">
        <p class="va-chat__composer-hint">将 VaComposer 放入 #composer 插槽</p>
      </slot>
    </footer>
  </div>
</template>

<style src="./VaAgentChat.css"></style>
