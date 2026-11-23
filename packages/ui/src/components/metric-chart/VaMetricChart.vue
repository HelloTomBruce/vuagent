<script setup lang="ts">
import { computed } from "vue";
import type { MetricChartProps } from "./types";

const props = withDefaults(defineProps<MetricChartProps>(), {
  chartType: "bar",
  unit: "",
  series: () => [],
});

const maxVal = computed(() => {
  if (props.series.length === 0) return 1;
  const max = Math.max(...props.series.map((s) => s.value));
  return max > 0 ? max : 1;
});

const latestVal = computed(() => {
  if (props.series.length === 0) return 0;
  return props.series[props.series.length - 1].value;
});

// 折线图坐标点计算 (归一化到 300 x 100 viewBox)
const svgPoints = computed(() => {
  const len = props.series.length;
  if (len < 2) return [];

  const width = 300;
  const height = 90;
  const paddingX = 10;
  const paddingY = 8;
  const usableW = width - paddingX * 2;
  const usableH = height - paddingY * 2;

  return props.series.map((item, idx) => {
    const x = paddingX + (idx / (len - 1)) * usableW;
    const y = height - paddingY - (item.value / maxVal.value) * usableH;
    return { x, y, ...item };
  });
});

const polylineStr = computed(() => {
  return svgPoints.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
});

const areaPathStr = computed(() => {
  const pts = svgPoints.value;
  if (pts.length < 2) return "";
  const first = pts[0];
  const last = pts[pts.length - 1];
  return `M ${first.x},90 L ${polylineStr.value} L ${last.x},90 Z`;
});
</script>

<template>
  <div class="va-metric-chart" role="region" :aria-label="title">
    <!-- 头部指标信息 -->
    <header class="va-chart-header">
      <h4 class="va-chart-title">{{ title }}</h4>
      <div class="va-chart-summary">
        <span class="va-chart-max-val">{{ latestVal }}</span>
        <span v-if="unit" class="va-chart-unit">{{ unit }}</span>
      </div>
    </header>

    <!-- 模式 1：柱状图 (bar) -->
    <template v-if="chartType === 'bar'">
      <div class="va-bar-container">
        <div
          v-for="(item, idx) in series"
          :key="idx"
          class="va-bar-col"
        >
          <div class="va-bar-tooltip">{{ item.value }}{{ unit }}</div>
          <div
            class="va-bar-pill"
            :style="{ height: `${Math.max(4, (item.value / maxVal) * 100)}%` }"
          />
        </div>
      </div>
      <div class="va-bar-labels">
        <span
          v-for="(item, idx) in series"
          :key="idx"
          class="va-bar-label"
          :title="item.label"
        >
          {{ item.label }}
        </span>
      </div>
    </template>

    <!-- 模式 2：SVG 平滑折线图 (line) -->
    <template v-else-if="chartType === 'line'">
      <div class="va-line-container">
        <svg
          class="va-line-svg"
          viewBox="0 0 300 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="va-line-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--va-accent, #c2410c)" />
              <stop offset="100%" stop-color="transparent" />
            </linearGradient>
          </defs>

          <!-- 面积阴影 -->
          <path :d="areaPathStr" class="va-line-area" />

          <!-- 折线主体 -->
          <polyline :points="polylineStr" class="va-line-path" />

          <!-- 数据锚点 -->
          <circle
            v-for="(pt, idx) in svgPoints"
            :key="idx"
            :cx="pt.x"
            :cy="pt.y"
            r="3"
            class="va-line-dot"
          >
            <title>{{ pt.label }}: {{ pt.value }}{{ unit }}</title>
          </circle>
        </svg>
      </div>

      <div class="va-bar-labels">
        <span
          v-for="(item, idx) in series"
          :key="idx"
          class="va-bar-label"
          :title="item.label"
        >
          {{ item.label }}
        </span>
      </div>
    </template>
  </div>
</template>

<style src="./VaMetricChart.css"></style>
