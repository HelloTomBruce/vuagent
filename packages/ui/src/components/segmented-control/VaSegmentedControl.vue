<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { SegmentedControlProps } from "./types";
import { useSegmentedControl } from "./useSegmentedControl";

const props = withDefaults(defineProps<SegmentedControlProps>(), {
  modelValue: undefined,
  size: "md",
  fullWidth: false,
  ariaLabel: undefined,
});

const model = defineModel<string>({ default: "" });

const root = useTemplateRef<HTMLElement>("root");
const { indicator, activeIdx, select, onKeydown } = useSegmentedControl(props, model, root);
</script>

<template>
  <div
    ref="root"
    class="va-seg"
    :class="[`va-seg--${props.size}`, { 'va-seg--full': props.fullWidth }]"
    role="radiogroup"
    :aria-label="props.ariaLabel"
    @keydown="onKeydown"
  >
    <span class="va-seg__thumb" aria-hidden="true" :style="{ transform: `translateX(${indicator.left}px)`, width: `${indicator.width}px` }" />
    <button
      v-for="(o, i) in props.options"
      :key="o.value"
      class="va-seg__btn"
      :data-idx="i"
      :data-active="model === o.value || undefined"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :tabindex="i === activeIdx ? 0 : -1"
      :disabled="o.disabled"
      @click="select(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style src="./VaSegmentedControl.css"></style>
