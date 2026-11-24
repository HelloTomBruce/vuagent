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
    invertDelta?: boolean;
    series: number[];
  }>;
  breakdown?: {
    total: number;
    unit: string;
    items: Array<{ label: string; value: number; color: string }>;
  };
  anomalies?: Array<{ metric: string; severity: string; message: string; suggestion?: string }>;
}

const props = withDefaults(defineProps<AnalysisReportProps>(), {
  topic: "分析报告",
  period: "",
  kpis: () => [],
  breakdown: undefined,
  anomalies: () => [],
});

/** 卡片内交互回传：下钻按钮直接驱动下一轮 agent 工具调用 */
const emit = defineEmits<{ (e: "quick", prompt: string): void }>();

const formatted = computed(() =>
  (props.kpis || []).map((k) => ({ ...k, display: k.value >= 1000 ? k.value.toLocaleString() : String(k.value) }))
);

const DRILLS = [
  { key: "region", label: "按区域" },
  { key: "sku", label: "按 SKU" },
  { key: "channel", label: "按渠道" },
  { key: "week", label: "按周" },
];
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

    <!-- 异常检测结果 -->
    <div v-if="anomalies?.length" class="report-card__anomalies">
      <div class="report-card__sec-title">异常检测（周环比波动 ±15%）</div>
      <div
        v-for="(a, i) in anomalies"
        :key="i"
        class="report-card__anomaly"
        :class="a.severity === 'high' ? 'anomaly--high' : 'anomaly--medium'"
      >
        <div class="report-card__anomaly-msg">
          <b>{{ a.metric }}</b> {{ a.message }}
        </div>
        <div v-if="a.suggestion" class="report-card__anomaly-sug">💡 {{ a.suggestion }}</div>
      </div>
    </div>

    <!-- 下钻入口：卡片内交互回传 -->
    <div class="report-card__drills">
      <span class="report-card__sec-title">下钻明细：</span>
      <button
        v-for="d in DRILLS"
        :key="d.key"
        type="button"
        class="report-card__drill"
        @click="emit('quick', `请调用 analysis_drilldown 工具，按「${d.key}」维度下钻${topic}的明细数据`)"
      >
        {{ d.label }}
      </button>
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

.report-card__anomalies { display: flex; flex-direction: column; gap: 6px; }
.report-card__anomaly { border-radius: 8px; padding: 7px 10px; font-size: 11px; line-height: 1.55; }
.anomaly--high { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
.anomaly--medium { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
.report-card__anomaly-msg b { margin-right: 4px; }
.report-card__anomaly-sug { margin-top: 3px; opacity: 0.85; }

.report-card__drills { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.report-card__drills .report-card__sec-title { margin: 0 2px 0 0; }
.report-card__drill {
  font-size: 11px; padding: 4px 10px; border: 1px solid var(--gv-border);
  background: #fff; border-radius: 999px; cursor: pointer; color: var(--gv-ink); transition: all 0.15s;
}
.report-card__drill:hover { border-color: var(--gv-accent); color: var(--gv-accent); background: #fff1e7; }
</style>
