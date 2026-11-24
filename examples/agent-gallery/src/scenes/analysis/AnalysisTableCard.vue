<script setup lang="ts">
import { Table2 } from "lucide-vue-next";

export interface AnalysisTableProps {
  topic?: string;
  dimension?: string;
  columns?: string[];
  rows?: string[][];
  footnote?: string;
}

const DIM_LABEL: Record<string, string> = {
  sku: "SKU 明细",
  region: "区域明细",
  channel: "渠道明细",
  week: "周粒度明细",
};

withDefaults(defineProps<AnalysisTableProps>(), {
  topic: "",
  dimension: "region",
  columns: () => [],
  rows: () => [],
  footnote: "",
});
</script>

<template>
  <div class="tbl-card">
    <div class="tbl-card__head">
      <Table2 :size="15" />
      <div>
        <div class="tbl-card__title">{{ DIM_LABEL[dimension] ?? "下钻明细" }}<span v-if="topic" class="tbl-card__topic">{{ topic }}</span></div>
        <div class="tbl-card__meta">由报告卡下钻按钮驱动 · 全部行来自结构化查询结果</div>
      </div>
    </div>

    <div class="tbl-card__scroll">
      <table class="tbl">
        <thead>
          <tr><th v-for="c in columns" :key="c">{{ c }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="i">
            <td v-for="(cell, j) in row" :key="j" :class="{ 'tbl__neg': String(cell).startsWith('−'), 'tbl__pos': String(cell).startsWith('+') }">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="footnote" class="tbl-card__foot">💡 {{ footnote }}</p>
  </div>
</template>

<style scoped>
.tbl-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.tbl-card__head { display: flex; align-items: flex-start; gap: 8px; }
.tbl-card__head svg { color: var(--gv-accent); margin-top: 2px; }
.tbl-card__title { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.tbl-card__topic { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: #fff1e7; color: var(--gv-accent); }
.tbl-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }

.tbl-card__scroll { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.tbl th {
  text-align: left; padding: 6px 10px; background: var(--va-bg-subtle, #faf9f7);
  color: var(--gv-muted); font-weight: 600; border-bottom: 1px solid var(--gv-border);
  white-space: nowrap;
}
.tbl td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-family: var(--va-font-mono, monospace); white-space: nowrap; }
.tbl td:first-child { font-family: inherit; font-weight: 500; }
.tbl__neg { color: #dc2626; }
.tbl__pos { color: #16a34a; }

.tbl-card__foot { font-size: 11px; color: var(--gv-muted); background: var(--va-bg-subtle, #faf9f7); border-radius: 8px; padding: 8px 12px; margin: 0; line-height: 1.6; }
</style>
