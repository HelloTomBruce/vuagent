<script setup lang="ts">
import type { ShimmerTextProps } from "./types";

withDefaults(defineProps<ShimmerTextProps>(), { duration: 2 });
</script>

<template>
  <span class="va-shimmer-text" :style="{ animationDuration: `${duration}s` }">
    <slot />
  </span>
</template>

<style src="./VaShimmerText.css"></style>
