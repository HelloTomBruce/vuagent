<script setup lang="ts">
import type { ThinkingLoaderProps } from "./types";
import { useThinkingLoader } from "./useThinkingLoader";

const props = withDefaults(defineProps<ThinkingLoaderProps>(), {
  phases: undefined,
  interval: 1600,
  done: false,
  doneLabel: "已完成",
  loop: false,
  size: "md",
});

const { current } = useThinkingLoader(props);
</script>

<template>
  <div class="va-think" :class="[`va-think--${props.size}`, { 'va-think--done': props.done }]" role="status">
    <span class="va-think__icon" aria-hidden="true">
      <svg v-if="props.done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <path d="M5.5 12.5l4 4L18.5 8" />
      </svg>
      <span v-else class="va-think__spin" />
    </span>
    <span class="va-think__label" :data-shine="!props.done || undefined">
      {{ props.done ? props.doneLabel : current }}
    </span>
  </div>
</template>

<style src="./VaThinkingLoader.css"></style>
