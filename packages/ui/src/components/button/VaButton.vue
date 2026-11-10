<script setup lang="ts">
import { withDefaults } from "vue";
import type { ButtonProps } from "./types";

withDefaults(defineProps<ButtonProps>(), {
  variant: "primary",
  size: "md",
  type: "button",
  disabled: false,
  loading: false,
  block: false,
});

defineSlots<{
  default?: () => unknown;
  icon?: () => unknown;
  "icon-right"?: () => unknown;
}>();
</script>

<template>
  <button
    class="va-btn"
    :class="[`va-btn--${variant}`, `va-btn--${size}`, { 'va-btn--block': block, 'va-btn--loading': loading }]"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <span v-if="$slots.icon" class="va-btn__icon"><slot name="icon" /></span>
    <span v-if="$slots.default" class="va-btn__label"><slot /></span>
    <span v-if="$slots['icon-right']" class="va-btn__icon"><slot name="icon-right" /></span>
  </button>
</template>

<style src="./VaButton.css"></style>
