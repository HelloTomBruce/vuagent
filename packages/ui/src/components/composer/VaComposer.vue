<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { ComposerProps } from "./types";
import { useComposer } from "./useComposer";

const props = withDefaults(defineProps<ComposerProps>(), {
  text: undefined,
  placeholder: "给 agent 一个任务…",
  disabled: false,
  busy: false,
  maxHeight: 160,
  allowEmpty: false,
});

const text = defineModel<string>("text", { default: "" });

const emit = defineEmits<{ send: [text: string] }>();

const area = useTemplateRef<HTMLTextAreaElement>("area");
const { composing, onInput, submit, onKeydown } = useComposer(props, text, area, {
  send: (t) => emit("send", t),
});
</script>

<template>
  <div class="va-cmp" :class="{ 'va-cmp--busy': props.busy }">
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
    />
    <div class="va-cmp__foot">
      <div class="va-cmp__actions"><slot name="actions" /></div>
      <button
        class="va-cmp__send"
        type="button"
        :disabled="props.disabled || props.busy || (!props.allowEmpty && !text.trim())"
        aria-label="发送"
        @click="submit"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style src="./VaComposer.css"></style>
