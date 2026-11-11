<script setup lang="ts">
import { computed } from "vue";
import type { ExperimentCardEvents, ExperimentCardProps } from "./types";
import { useNow } from "../../composables/useNow";

const props = defineProps<ExperimentCardProps>();

const emit = defineEmits<ExperimentCardEvents>();

const running = computed(() => props.status === "running" || props.status === undefined);
const alive = computed(() => running.value && props.startedAt !== undefined);
const now = useNow(1000, alive);

const fmt = (v: number, f?: Intl.NumberFormatOptions) =>
  v.toLocaleString("en-US", f ?? { maximumFractionDigits: 2 });

/** 胜者：显式标记优先，否则取 value 最大 */
const winnerId = computed(() => {
  const explicit = props.variants.find((v) => v.winner);
  if (explicit) return explicit.id;
  if (running.value || props.variants.length < 2) return undefined;
  return [...props.variants].sort((a, b) => b.value - a.value)[0]!.id;
});

const threshold = computed(() => props.confidenceThreshold ?? 0.95);
const concluded = computed(() => !running.value && props.confidence !== undefined && props.confidence >= threshold.value);

const verdict = computed(() => {
  const w = props.variants.find((v) => v.id === winnerId.value);
  if (!w || running.value) return null;
  if (props.confidence !== undefined && props.confidence < threshold.value) {
    return "差异未达显著，继续观察或加大样本";
  }
  const delta = w.delta !== undefined ? `（+${Math.round(w.delta * 100)}%）` : "";
  return `「${w.name}」胜出${delta}`;
});

const elapsed = computed(() => {
  if (!running.value || props.startedAt === undefined) return null;
  const ms = Math.max(0, now.value - props.startedAt);
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
});
</script>

<template>
  <section class="va-exp" :data-status="props.status ?? 'running'">
    <header class="va-exp__head">
      <span class="va-exp__title">{{ props.title }}</span>
      <span class="va-exp__status" :data-status="props.status ?? 'running'" role="status">
        {{ running ? "进行中" : props.status === "error" ? "已中止" : "已完成" }}
      </span>
      <span v-if="elapsed" class="va-exp__time">已运行 {{ elapsed }}</span>
      <span class="va-exp__spacer" />
      <button
        v-if="running"
        class="va-act va-act--sm va-act--ghost va-exp__op"
        type="button"
        @click="emit('stop')"
      >结束实验</button>
      <button
        v-else
        class="va-act va-act--sm va-act--ghost va-exp__op"
        type="button"
        @click="emit('reopen')"
      >重新开始</button>
    </header>

    <div class="va-exp__grid" role="list" :aria-label="`${props.metric}对比`">
      <div
        v-for="v in props.variants"
        :key="v.id"
        class="va-exp__variant"
        :data-winner="v.id === winnerId"
        role="listitem"
      >
        <span class="va-exp__name">{{ v.name }}<em v-if="v.id === winnerId" class="va-exp__crown" aria-label="胜出">✓</em></span>
        <strong class="va-exp__value">{{ fmt(v.value, v.format) }}</strong>
        <span v-if="v.delta !== undefined" class="va-exp__delta">+{{ Math.round(v.delta * 100) }}%</span>
        <span class="va-exp__metric">{{ props.metric }}</span>
      </div>
    </div>

    <footer v-if="props.confidence !== undefined" class="va-exp__foot">
      <div class="va-exp__conf" aria-hidden="true">
        <span class="va-exp__conf-bar">
          <span class="va-exp__conf-fill" :data-enough="concluded" :style="{ width: `${Math.min(100, props.confidence * 100)}%` }" />
        </span>
        <span class="va-exp__conf-text">置信度 {{ Math.round(props.confidence * 100) }}%（阈值 {{ Math.round(threshold * 100) }}%）</span>
      </div>
      <p v-if="verdict" class="va-exp__verdict" :data-enough="concluded" role="status">{{ verdict }}</p>
    </footer>
  </section>
</template>

<style src="./VaExperimentCard.css"></style>
