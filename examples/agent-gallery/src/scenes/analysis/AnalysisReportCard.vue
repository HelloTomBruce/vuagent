<script setup lang="ts">
import { computed } from "vue";
import { TrendingUp } from "lucide-vue-next";
import { VaKpiChart, VaBreakdownChart } from "@vuagent/ui";

export interface AnalysisReportProps {
  topic?: string;
  period?: string;
  kpis?: Array<{
    label: string;
    value: number;
    delta?: number;
    deltaLabel?: string;
    series: number[];
  }>;
  breakdown?: {
    total: number;
    unit: string;
    items: Array<{ label: string; value: number; color: string }>;
  };
}

const props = withDefaults(defineProps<AnalysisReportProps>(), {
  topic: "分析报告",
  period: "",
  kpis: () => [],
  breakdown: undefined,
});

const formatted = computed(() =>
  (props.kpis || []).map((k) => ({ ...k, display: k.value >= 1000 ? k.value.toLocaleString() : String(k.value) }))
);
</script>

<template>
  <div class="report-card">
    <div class="report-card__head">
      <TrendingUp :size="15" />
      <div>
        <div class="report-card__title">{{ topic }}<span v-if="period" class="report-card__period">{{ period }}</span></div>
        <div class="report-card__meta">以下指标全部来自结构化工具结果渲染，可回溯到 SQL 聚合口径</div>
      </div>
    </div>

    <div class="report-card__kpis">
      <div v-for="k in formatted" :key="k.label" class="report-card__kpi">
        <VaKpiChart
          :label="k.label"
          :value="k.value"
          :delta="k.delta"
          :delta-label="k.deltaLabel"
          :series="k.series"
          :width="200"
          :height="44"
        />
      </div>
    </div>

    <div v-if="breakdown" class="report-card__breakdown">
      <div class="report-card__sec-title">渠道构成拆解</div>
      <VaBreakdownChart
        :items="breakdown.items"
        :total="breakdown.total"
        :unit="breakdown.unit"
        bar-scale="max"
      />
    </div>
  </div>
</template>

<style scoped>
.report-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 6px 0;
}
.report-card__head { display: flex; align-items: flex-start; gap: 8px; }
.report-card__head svg { color: var(--gv-accent); margin-top: 2px; }
.report-card__title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.report-card__period { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #fff1e7; color: var(--gv-accent); }
.report-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }

.report-card__kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 10px;
}
.report-card__kpi {
  border: 1px solid var(--gv-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--va-bg-subtle, #faf9f7);
}
.report-card__sec-title { font-size: 11px; font-weight: 600; color: var(--gv-muted); margin-bottom: 6px; }
</style>
