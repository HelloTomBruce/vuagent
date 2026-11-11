<script setup lang="ts">
import { computed, ref } from "vue";
import type { TiltCardProps } from "./types";

const props = defineProps<TiltCardProps>();

/** 倾斜量 -1..1（相对中心），光斑 0..1 */
const tilt = ref({ x: 0, y: 0, gx: 0.5, gy: 0.5 });
const hovering = ref(false);

function onMove(e: MouseEvent) {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  tilt.value = { x: (0.5 - nx) * 2, y: (ny - 0.5) * 2, gx: nx, gy: ny };
}

function onEnter() {
  hovering.value = true;
}

function onLeave() {
  hovering.value = false;
  tilt.value = { x: 0, y: 0, gx: 0.5, gy: 0.5 };
}

const max = computed(() => props.maxTilt ?? 8);
const cardStyle = computed(() => ({
  transform: hovering.value
    ? `perspective(${props.perspective ?? 600}px) rotateY(${tilt.value.x * max.value}deg) rotateX(${tilt.value.y * max.value}deg)${props.zoom ? " scale(1.02)" : ""}`
    : `perspective(${props.perspective ?? 600}px)`,
}));

const glareStyle = computed(() =>
  props.glare && hovering.value
    ? {
        opacity: props.glareOpacity ?? 0.18,
        background: `radial-gradient(240px circle at ${tilt.value.gx * 100}% ${tilt.value.gy * 100}%, rgba(255,255,255,0.9), transparent 60%)`,
      }
    : { opacity: 0 },
);
</script>

<template>
  <div
    class="va-tilt"
    :style="cardStyle"
    @mousemove="onMove"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <slot />
    <span v-if="props.glare" class="va-tilt__glare" :style="glareStyle" aria-hidden="true" />
  </div>
</template>

<style src="./VaTiltCard.css"></style>
