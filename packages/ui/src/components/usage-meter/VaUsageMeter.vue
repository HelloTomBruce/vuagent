<script setup lang="ts">
import { computed } from "vue";
import type { UsageMeterEvents, UsageMeterProps } from "./types";

const props = defineProps<UsageMeterProps>();

const emit = defineEmits<UsageMeterEvents>();

const PALETTE = ["var(--va-info)", "var(--va-accent)", "var(--va-success)", "var(--va-warning)"];

const total = computed(() => props.segments.reduce((s, x) => s + x.used, 0));
const ratio = computed(() => (props.limit > 0 ? total.value / props.limit : 0));
const warnAt = computed(() => props.warnAt ?? 0.8);
const level = computed(() => {
  if (ratio.value >= 1) return "exceeded";
  if (ratio.value >= warnAt.value) return "warn";
  return "ok";
});

const fmt = (n: number) => n.toLocaleString("en-US");

const segStyle = (i: number, used: number) => ({
  width: props.limit > 0 ? `${Math.min(100, (used / props.limit) * 100)}%` : "0%",
  background: props.segments[i]!.color ?? PALETTE[i % PALETTE.length]!,
});
</script>

<template>
  <div class="va-usage" :data-level="level">
    <header class="va-usage__head">
      <span class="va-usage__amount">
        <strong>{{ fmt(total) }}</strong>
        <span class="va-usage__limit">/ {{ fmt(props.limit) }} {{ props.unit ?? "" }}</span>
      </span>
      <span class="va-usage__period">{{ props.period }}</span>
    </header>

    <div
      class="va-usage__bar"
      role="meter"
      :aria-valuemin="0"
      :aria-valuemax="props.limit"
      :aria-valuenow="total"
      :aria-label="`已用 ${fmt(total)} / ${fmt(props.limit)} ${props.unit ?? ''}`"
      :style="{ height: `${props.barHeight ?? 10}px` }"
    >
      <span
        v-for="(seg, i) in props.segments"
        :key="seg.label"
        class="va-usage__seg"
        :style="segStyle(i, seg.used)"
      />
    </div>

    <p v-if="level !== 'ok'" class="va-usage__alert" role="status">
      <template v-if="level === 'exceeded'">已超出限额，新任务将被限流</template>
      <template v-else>已用 {{ Math.round(ratio * 100) }}%，接近本期限额</template>
      <button class="va-usage__manage" type="button" @click="emit('manage')">管理额度</button>
    </p>

    <ul v-else class="va-usage__legend">
      <li v-for="(seg, i) in props.segments" :key="seg.label" class="va-usage__item">
        <span class="va-usage__swatch" :style="{ background: seg.color ?? PALETTE[i % PALETTE.length]! }" />
        <span class="va-usage__label">{{ seg.label }}</span>
        <span class="va-usage__value">{{ fmt(seg.used) }}</span>
        <span class="va-usage__pct">{{ props.limit > 0 ? Math.round((seg.used / props.limit) * 100) : 0 }}%</span>
      </li>
    </ul>
  </div>
</template>

<style src="./VaUsageMeter.css"></style>
