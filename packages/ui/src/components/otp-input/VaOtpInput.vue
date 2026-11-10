<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import type { OtpInputEvents, OtpInputProps } from "./types";

const props = defineProps<OtpInputProps>();

const emit = defineEmits<OtpInputEvents>();

const len = computed(() => props.length ?? 6);
const chars = computed(() => {
  const v = props.modelValue ?? "";
  return Array.from({ length: len.value }, (_, i) => v[i] ?? "");
});
const filled = computed(() => chars.value.every((c) => c !== ""));

const rootEl = useTemplateRef<HTMLElement>("root");

function update(next: string[]) {
  const v = next.join("").slice(0, len.value);
  emit("update:modelValue", v);
  if (v.length === len.value) emit("complete", v);
}

function at(i: number) {
  return rootEl.value?.querySelectorAll<HTMLInputElement>("input")[i];
}

function onInput(i: number, e: Event) {
  const input = e.target as HTMLInputElement;
  const raw = input.value;
  // 单格只留首字符；多余部分（输入法/自动填充）顺移到后续空格
  const next = [...chars.value];
  const feed = raw.split("");
  let idx = i;
  for (const ch of feed) {
    if (idx >= len.value) break;
    if (ch.trim() === "") { idx++; continue; }
    next[idx] = ch;
    idx++;
  }
  update(next);
  const focusTo = Math.min(idx, len.value - 1);
  at(focusTo)?.focus();
  at(focusTo)?.select();
}

function onKeydown(i: number, e: KeyboardEvent) {
  const next = [...chars.value];
  if (e.key === "Backspace") {
    e.preventDefault();
    if (next[i]) next[i] = "";
    else if (i > 0) {
      next[i - 1] = "";
      at(i - 1)?.focus();
    }
    update(next);
  } else if (e.key === "ArrowLeft" && i > 0) {
    e.preventDefault();
    at(i - 1)?.focus();
  } else if (e.key === "ArrowRight" && i < len.value - 1) {
    e.preventDefault();
    at(i + 1)?.focus();
  }
}

/** 粘贴整段验证码分发到所有格子 */
function onPaste(e: ClipboardEvent) {
  e.preventDefault();
  const text = (e.clipboardData?.getData("text") ?? "").replace(/\s+/g, "").slice(0, len.value);
  if (!text) return;
  const arr = Array.from({ length: len.value }, (_, i) => text[i] ?? "");
  update(arr);
  const last = Math.min(text.length, len.value) - 1;
  at(Math.max(0, last))?.focus();
}
</script>

<template>
  <div
    ref="root"
    class="va-otp"
    role="group"
    :aria-label="props.label ?? '验证码输入'"
    @paste="onPaste"
  >
    <input
      v-for="(_, i) in len"
      :key="i"
      class="va-otp__cell"
      :class="{ 'va-otp__cell--filled': chars[i] !== '' }"
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      maxlength="1"
      :value="chars[i]"
      :placeholder="props.placeholder ?? ''"
      :disabled="props.disabled"
      :aria-label="`第 ${i + 1} 位`"
      @input="onInput(i, $event)"
      @keydown="onKeydown(i, $event)"
      @focus="(($event.target) as HTMLInputElement).select()"
    >
    <span v-if="filled" class="va-otp__done" aria-hidden="true">✓</span>
  </div>
</template>

<style src="./VaOtpInput.css"></style>
