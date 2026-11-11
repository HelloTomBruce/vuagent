<script setup lang="ts">
import { computed } from "vue";
import type { BlurCrossfadeProps } from "./types";

const props = defineProps<BlurCrossfadeProps>();

const dur = computed(() => `${props.duration ?? 300}ms`);
const blur = computed(() => `${props.blur ?? 8}px`);
const rise = computed(() => `${props.rise ?? 8}px`);
</script>

<template>
  <div class="va-xfade" :style="{ '--va-xf-dur': dur, '--va-xf-blur': blur, '--va-xf-rise': rise }">
    <!-- key 变化触发重挂载 → CSS animation 播放 blur-in -->
    <div :key="String(props.target)" class="va-xfade__pane">
      <slot />
    </div>
  </div>
</template>

<style src="./VaBlurCrossfade.css"></style>
