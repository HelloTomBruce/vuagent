<script setup lang="ts">
import { computed, withDefaults } from "vue";
import type { CompactBreakdownProps } from "./types";

const props = withDefaults(defineProps<CompactBreakdownProps>(), { legend: true });

const PALETTE = ["var(--va-info)", "var(--va-accent)", "var(--va-success)", "var(--va-warning)", "var(--va-muted)"];

const rows = computed(() => {
  const total = props.total ?? props.segments.reduce((s, x) => s + x.value, 0);
  return props.segments.map((s, i) => ({
    ...s,
    color: s.color ?? PALETTE[i % PALETTE.length]!,
    pct: total > 0 ? s.value / total : 0,
  }));
});

const summary = computed(() =>
  rows.value.map((r) => `${r.label} ${Math.round(r.pct * 100)}%`).join("，"),
);
</script>

<template>
  <div class="va-cbd" role="img" :aria-label="`占比分布：${summary}`">
    <div
      class="va-cbd__bar"
      :style="{ height: `${props.height ?? 8}px` }"
      aria-hidden="true"
    >
      <span
        v-for="r in rows"
        :key="r.label"
        class="va-cbd__seg"
        :style="{ width: `${r.pct * 100}%`, background: r.color }"
        :title="`${r.label} ${Math.round(r.pct * 100)}%`"
      />
    </div>
    <p v-if="props.legend" class="va-cbd__legend">
      <span v-for="r in rows" :key="r.label" class="va-cbd__item">
        <span class="va-cbd__dot" :style="{ background: r.color }" aria-hidden="true" />
        {{ r.label }} <b>{{ Math.round(r.pct * 100) }}%</b>
      </span>
    </p>
  </div>
</template>

<style src="./VaCompactBreakdown.css"></style>
