<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { TextRevealProps } from "./types";
import { useTextReveal } from "./useTextReveal";

const props = withDefaults(defineProps<TextRevealProps>(), {
  by: "word",
  stagger: 40,
  delay: 0,
  duration: 600,
  as: "span",
  once: true,
});

const root = useTemplateRef<HTMLElement>("root");
const { shown, pieces, pieceStyle } = useTextReveal(props, root);
</script>

<template>
  <component :is="props.as" ref="root" class="va-reveal" :data-shown="shown || undefined">
    <span
      v-for="(p, i) in pieces"
      :key="`${i}-${p}`"
      class="va-reveal__piece"
      :style="pieceStyle(i)"
      :data-space="/^\s+$/.test(p) || undefined"
    >{{ p }}</span>
  </component>
</template>

<style src="./VaTextReveal.css"></style>
