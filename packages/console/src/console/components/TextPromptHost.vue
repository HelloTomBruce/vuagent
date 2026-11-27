<script setup lang="ts">
/**
 * askText 的渲染宿主（console 本地，模式对齐 <VaConfirmHost />）
 * - 基于 VaDialog size=sm：Esc / 遮罩 = 取消（经 update:open 回流 cancelTextPrompt）
 * - 打开时自动聚焦并全选输入框；Enter 直接确认
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { VaButton, VaDialog } from "@vuagent/ui";
import {
  cancelTextPrompt,
  registerTextPromptHost,
  submitTextPrompt,
  useTextPromptState,
} from "../composables/useTextPrompt";

const state = useTextPromptState();

let unregister: (() => void) | null = null;
onMounted(() => {
  unregister = registerTextPromptHost();
});
onUnmounted(() => unregister?.());

const inputRef = ref<HTMLInputElement | null>(null);
watch(
  () => state.open,
  async (v) => {
    if (v) {
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    }
  },
);

/** Enter 确认；IME 组词中的 Enter（isComposing / keyCode 229）不触发，避免中文输入误提交 */
function onEnter(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return;
  submitTextPrompt();
}
</script>

<template>
  <VaDialog
    :open="state.open"
    size="sm"
    :title="state.title"
    :description="state.description || undefined"
    @update:open="(v: boolean) => { if (!v) cancelTextPrompt(); }"
  >
    <input
      ref="inputRef"
      v-model="state.value"
      class="va-console__input"
      type="text"
      :placeholder="state.placeholder"
      :aria-label="state.title"
      @keydown.enter.prevent="onEnter"
    />
    <template #footer>
      <VaButton variant="secondary" size="sm" @click="cancelTextPrompt">
        {{ state.cancelText }}
      </VaButton>
      <VaButton variant="primary" size="sm" @click="submitTextPrompt">
        {{ state.confirmText }}
      </VaButton>
    </template>
  </VaDialog>
</template>
