<script setup lang="ts">
import { computed, useAttrs } from "vue";
import type { KpiChartEvents, KpiChartProps } from "./types";
import { sparkline } from "../../utils/sparkline";

const props = defineProps<KpiChartProps>();

const emit = defineEmits<KpiChartEvents>();

const attrs = useAttrs();
const clickable = computed(() => "onClick" in attrs);

/** 稳定 hash（SSR/水合一致，不用 Math.random） */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const display = computed(() => props.value.toLocaleString("en-US", props.format));

const trend = computed(() => {
  if (props.delta === undefined) return null;
  const up = props.delta >= 0;
  const good = props.invertDelta ? !up : up;
  return { up, good, text: `${up ? "+" : "−"}${Math.abs(Math.round(props.delta * 100))}%` };
});

const geo = computed(() => sparkline(props.series, props.width ?? 120, props.height ?? 36));

const ariaSummary = computed(() => {
  const s = props.series;
  const trendText = trend.value ? `，${trend.value.text} ${props.deltaLabel ?? ""}`.trim() : "";
  return `${props.label}：${display.value}${trendText}，最近 ${s.length} 个点从 ${s[0]} 到 ${s[s.length - 1]}`;
});

const color = computed(() => props.color ?? "var(--va-accent)");
const areaId = `va-kpi-grad-${Math.abs(hash(props.label + display.value))}`;
</script>

<template>
  <div
    class="va-kpi"
    :class="{ 'va-kpi--clickable': clickable }"
    role="img"
    :aria-label="ariaSummary"
    v-bind="attrs"
    @click="emit('click')"
  >
    <span class="va-kpi__label">{{ props.label }}</span>
    <div class="va-kpi__row">
      <strong class="va-kpi__value">{{ display }}</strong>
      <span v-if="trend" class="va-kpi__delta" :data-good="trend.good">
        <span aria-hidden="true">{{ trend.up ? "↑" : "↓" }}</span>{{ trend.text }}
      </span>
    </div>
    <span v-if="props.deltaLabel && trend" class="va-kpi__vs">{{ props.deltaLabel }}</span>

    <svg
      v-if="geo.points.length > 1"
      class="va-kpi__spark"
      :viewBox="`0 0 ${props.width ?? 120} ${props.height ?? 36}`"
      :width="props.width ?? 120"
      :height="props.height ?? 36"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient :id="areaId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.22" />
          <stop offset="100%" :stop-color="color" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path :d="geo.area" :fill="`url(#${areaId})`" />
      <path :d="geo.line" fill="none" :stroke="color" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<style src="./VaKpiChart.css"></style>
