<script setup lang="ts">
import { computed } from "vue";
import type { BreakdownChartEvents, BreakdownChartProps } from "./types";
import type { BreakdownItem } from "./types";

const props = defineProps<BreakdownChartProps>();

const emit = defineEmits<BreakdownChartEvents>();

const PALETTE = ["var(--va-info)", "var(--va-accent)", "var(--va-success)", "var(--va-warning)", "var(--va-muted)"];
const colorOf = (i: number, item?: BreakdownItem) => item?.color ?? PALETTE[i % PALETTE.length]!;

/** 排序（降序）+ 超出 maxRows 折叠为「其他」 */
const rows = computed<Array<BreakdownItem & { pct: number }>>(() => {
  const sorted = [...props.items].sort((a, b) => b.value - a.value);
  let list = sorted;
  if (props.maxRows !== undefined && sorted.length > props.maxRows) {
    const head = sorted.slice(0, props.maxRows - 1);
    const rest = sorted.slice(props.maxRows - 1);
    list = [...head, { label: "其他", value: rest.reduce((s, x) => s + x.value, 0) }];
  }
  const total = props.total ?? sorted.reduce((s, x) => s + x.value, 0);
  return list.map((x) => ({ ...x, pct: total > 0 ? x.value / total : 0 }));
});

const maxValue = computed(() => Math.max(1, ...rows.value.map((r) => r.value)));
const fmt = (v: number) => v.toLocaleString("en-US");
</script>

<template>
  <div class="va-bdc" role="img" :aria-label="`分布：${rows.map((r) => `${r.label} ${Math.round(r.pct * 100)}%`).join('，')}`">
    <button
      v-for="(r, i) in rows"
      :key="r.label"
      class="va-bdc__row"
      type="button"
      @click="emit('select', r)"
    >
      <span class="va-bdc__swatch" :style="{ background: colorOf(i, r.label === '其他' ? undefined : r) }" aria-hidden="true" />
      <span class="va-bdc__label">{{ r.label }}</span>
      <span class="va-bdc__track" aria-hidden="true">
        <span
          class="va-bdc__bar"
          :style="{
            width: `${(props.barScale === 'total' ? r.pct : r.value / maxValue) * 100}%`,
            background: colorOf(i, r.label === '其他' ? undefined : r),
          }"
        />
      </span>
      <span class="va-bdc__value">{{ fmt(r.value) }}{{ props.unit ? ` ${props.unit}` : "" }}</span>
      <span class="va-bdc__pct">{{ Math.round(r.pct * 100) }}%</span>
    </button>
  </div>
</template>

<style src="./VaBreakdownChart.css"></style>
