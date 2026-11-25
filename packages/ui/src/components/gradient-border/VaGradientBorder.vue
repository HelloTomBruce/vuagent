<script setup lang="ts">
import { computed } from "vue";
import type { GradientBorderProps } from "./types";

const props = withDefaults(defineProps<GradientBorderProps>(), {
  variant: "static",
  width: 1,
});

/** 边框量：from/to 缺省吃 accent 渐变端点；speed 数字按 ms，缺省走 --va-dur-loop 底速 */
const style = computed(() => {
  const speed =
    props.speed === undefined ? null : typeof props.speed === "number" ? `${props.speed}ms` : props.speed;
  return {
    "--va-gb-w": `${props.width}px`,
    "--va-gb-from": props.from ?? "var(--va-grad-accent-from, #c2410c)",
    "--va-gb-to": props.to ?? "var(--va-grad-accent-to, #2563eb)",
    ...(speed ? { "--va-gb-speed": speed } : null),
  };
});
</script>

<template>
  <div class="va-gborder" :class="`va-gborder--${props.variant}`" :style="style">
    <slot />
  </div>
</template>

<style src="./VaGradientBorder.css"></style>
