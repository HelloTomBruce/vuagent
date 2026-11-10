<script setup lang="ts">
import type { GridBackgroundProps } from "./types";
import { useGridBackground } from "./useGridBackground";

const props = withDefaults(defineProps<GridBackgroundProps>(), {
  size: 44,
  speed: 2.4,
  direction: "diagonal",
  color: undefined,
  fade: 70,
});

const { bgStyle, animStyle, moving } = useGridBackground(props);
</script>

<template>
  <div class="va-grid" :data-moving="moving || undefined">
    <div class="va-grid__lines" :style="[bgStyle, animStyle]" aria-hidden="true" />
    <div class="va-grid__content"><slot /></div>
  </div>
</template>

<style src="./VaGridBackground.css"></style>
