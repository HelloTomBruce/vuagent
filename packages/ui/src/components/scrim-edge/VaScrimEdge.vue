<script setup lang="ts">
import { computed } from "vue";
import type { ScrimEdgeProps } from "./types";

const props = withDefaults(defineProps<ScrimEdgeProps>(), {
  direction: "bottom",
  height: 72,
});

/** 渐变量（颜色缺省吃 --va-scrim 遮罩色：亮暗主题自适应，宿主可显式覆盖） */
const style = computed(() => {
  const [from, to] = props.stops ?? [0, 100];
  return {
    "--va-scrim-edge-h": `${props.height}px`,
    "--va-scrim-edge-c": props.scrimColor ?? "var(--va-scrim, rgba(26, 25, 23, 0.45))",
    "--va-scrim-edge-from": `${from}%`,
    "--va-scrim-edge-to": `${to}%`,
  };
});
</script>

<template>
  <div class="va-scrim-edge" :class="`va-scrim-edge--${props.direction}`" :style="style" aria-hidden="true" />
</template>

<style src="./VaScrimEdge.css"></style>
