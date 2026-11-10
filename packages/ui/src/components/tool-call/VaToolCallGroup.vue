<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolCallGroupProps } from "./types";
import { useToolCallGroup } from "./useToolCallGroup";

const props = withDefaults(defineProps<ToolCallGroupProps>(), {
  label: undefined,
  runningLabel: undefined,
  duration: undefined,
  defaultOpen: false,
  open: undefined,
});

const emit = defineEmits<{ "update:open": [v: boolean] }>();

// 三段判定：受控 → 内部已操作 → defaultOpen（布尔 prop 的 cast 使 defineModel 无法区分"未绑定"与"false"）
const innerOpen = ref(false);
const openTouched = ref(false);
const isOpen = computed(() => {
  if (props.open !== undefined) return props.open;
  if (openTouched.value) return innerOpen.value;
  return props.defaultOpen ?? false;
});
function toggle() {
  openTouched.value = true;
  innerOpen.value = !isOpen.value;
  emit("update:open", innerOpen.value);
}

const { cards, running, title } = useToolCallGroup(props);

const id = `va-tclg-${Math.random().toString(36).slice(2, 8)}`;
</script>

<template>
  <div class="va-tclg" :class="isOpen ? 'va-tclg--open' : ''" :data-running="running || undefined">
    <button :id="id" class="va-tclg__head" type="button" :aria-expanded="isOpen" @click="toggle">
      <span class="va-tclg__stack" aria-hidden="true">
        <slot name="icons">
          <span class="va-tclg__icon" v-for="n in Math.min(3, Math.max(cards.length, 1))" :key="n">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.7 6.3a4.6 4.6 0 0 0-6.16 5.44L3.4 16.9a2 2 0 1 0 2.83 2.83l5.16-5.16a4.6 4.6 0 0 0 5.44-6.16l-2.6 2.6-2.3-.62-.62-2.3 2.6-2.6Z" />
            </svg>
          </span>
        </slot>
      </span>
      <span class="va-tclg__title">
        <span class="va-tclg__label" :data-shine="running || undefined">{{ title }}</span>
      </span>
      <svg class="va-tclg__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="m9.5 7 5 5-5 5" />
      </svg>
    </button>

    <div class="va-tclg__body" role="region" aria-label="工具调用列表">
      <div class="va-tclg__inner">
        <slot />
      </div>
    </div>
  </div>
</template>

<style src="./VaToolCallGroup.css"></style>
