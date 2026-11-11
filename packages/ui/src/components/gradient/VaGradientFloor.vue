<script setup lang="ts">
import { computed, withDefaults } from "vue";
import type { GradientFloorProps } from "./types";

const props = withDefaults(defineProps<GradientFloorProps>(), { breathing: true });

const style = computed(() => ({
  "--va-gf-h": `${props.height ?? 320}px`,
  "--va-gf-x": `${(props.position ?? 0.5) * 100}%`,
  "--va-gf-c1": props.color ?? "var(--va-accent)",
  "--va-gf-c2": props.color2 ?? "var(--va-info)",
  "--va-gf-o": String(props.opacity ?? 0.5),
}));
</script>

<template>
  <div class="va-gfloor" :class="{ 'va-gfloor--breathe': props.breathing }" :style="style" aria-hidden="true" />
</template>

<style src="./VaGradientFloor.css"></style>
