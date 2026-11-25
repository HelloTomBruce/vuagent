<script setup lang="ts">
import type { SpotlightCardProps } from "./types";
import { useSpotlightCard } from "./useSpotlightCard";

// 显式 true 缺省（Vue 会把缺省 Boolean prop 强转为 false，需 withDefaults 对冲）
const props = withDefaults(defineProps<SpotlightCardProps>(), {
  glow: true,
  spot: true,
  elevation: 4,
});

const { classes, spot } = useSpotlightCard(props);
</script>

<template>
  <div
    :class="classes"
    @pointerenter="spot.onPointerEnter"
    @pointermove="spot.onPointerMove"
    @pointerleave="spot.onPointerLeave"
  >
    <slot />
  </div>
</template>

<style src="./VaSpotlightCard.css"></style>
