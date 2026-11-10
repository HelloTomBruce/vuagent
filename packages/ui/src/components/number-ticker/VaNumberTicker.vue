<script setup lang="ts">
import { useTemplateRef } from "vue";
import type { NumberTickerProps } from "./types";
import { useNumberTicker } from "./useNumberTicker";

const props = withDefaults(defineProps<NumberTickerProps>(), { duration: 900, delay: 0 });

const root = useTemplateRef<HTMLElement>("root");
const { rolled, parts, formatted } = useNumberTicker(props, root);
</script>

<template>
  <span ref="root" class="va-ticker" role="img" :aria-label="formatted">
    <span
      v-for="p in parts"
      :key="p.key"
      class="va-ticker__col"
      :data-static="p.digit === undefined || undefined"
    >
      <span
        v-if="p.digit !== undefined"
        class="va-ticker__reel"
        :style="{
          transform: rolled ? `translateY(${(-p.digit / 11) * 100}%)` : 'translateY(0)',
          transitionDuration: `${duration}ms`,
        }"
      >
        <span v-for="n in 11" :key="n" class="va-ticker__num">{{ (n - 1) % 10 }}</span>
      </span>
      <span v-else class="va-ticker__char">{{ p.char }}</span>
    </span>
  </span>
</template>

<style src="./VaNumberTicker.css"></style>
