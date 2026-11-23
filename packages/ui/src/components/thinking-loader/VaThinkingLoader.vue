<script setup lang="ts">
import { computed } from "vue";
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

const { current, maxPhaseChars } = useThinkingLoader(props);

const labelText = computed(() => (props.done ? props.doneLabel : current.value));
/** key 驱动阶段切换过渡；done 与轮播文案共用一条切换通道 */
const labelKey = computed(() => (props.done ? "__done" : current.value));
/** 最长文案定宽：轮播不再因文案长短变化引起胶囊宽度抖动（CJK 1 字 ≈ 1em） */
const labelStyle = computed(() => ({ minWidth: `${maxPhaseChars.value}em` }));
</script>

<template>
  <div class="va-think" :class="[`va-think--${props.size}`, { 'va-think--done': props.done }]" role="status">
    <span class="va-think__icon" aria-hidden="true">
      <svg v-if="props.done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <path d="M5.5 12.5l4 4L18.5 8" />
      </svg>
      <span v-else class="va-think__spin" />
    </span>
    <span class="va-think__label" :style="labelStyle" aria-live="polite">
      <!-- 显式 duration：label-text 上有 shine 无限动画，Vue 按 computed
           时长等待 animationend（永不触发），旧节点会滞留——显式时长跳过探测 -->
      <Transition name="va-think-phase" mode="out-in" :duration="{ enter: 120, leave: 120 }">
        <span :key="labelKey" class="va-think__label-text" :data-shine="!props.done || undefined">{{ labelText }}</span>
      </Transition>
    </span>
  </div>
</template>

<style src="./VaThinkingLoader.css"></style>
