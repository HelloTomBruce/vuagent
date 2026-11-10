<script setup lang="ts">
import { computed } from "vue";
import type { SkeletonProps } from "./types";

const props = withDefaults(defineProps<SkeletonProps>(), {});

/** 数字与纯数字字符串都转 px；其余（%, rem…）原样 */
const len = (v: number | string | undefined) => {
  if (v === undefined) return undefined;
  if (typeof v === "number") return `${v}px`;
  return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
};

const style = computed(() => {
  const w = len(props.width ?? "100%");
  const h = len(props.height ?? "12px");
  return {
    width: props.circle ? h : w,
    height: h,
    borderRadius: props.circle ? "50%" : len(props.radius ?? "6px"),
  };
});
</script>

<template>
  <span class="va-skel" :style="style" aria-hidden="true" />
</template>

<style src="./VaSkeleton.css"></style>
