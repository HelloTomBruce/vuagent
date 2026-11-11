<script setup lang="ts">
import { computed } from "vue";
import type { GradientTextProps } from "./types";

const props = defineProps<GradientTextProps>();

const style = computed(() => ({
  backgroundImage: `linear-gradient(${props.angle ?? 120}deg, ${props.from ?? "var(--va-accent)"}, ${props.to ?? "var(--va-info)"})`,
}));
</script>

<template>
  <span class="va-gtext" :class="{ 'va-gtext--flow': props.animated }" :style="style">
    <slot>{{ props.text }}</slot>
  </span>
</template>

<style src="./VaGradientText.css"></style>
