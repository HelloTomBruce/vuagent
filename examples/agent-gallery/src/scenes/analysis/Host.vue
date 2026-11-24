<script setup lang="ts">
import { ArrowDownRight, ArrowUpRight, Calendar, Database, FileBarChart, Table2 } from "lucide-vue-next";
import { VaKpiChart, VaBreakdownChart } from "@vuagent/ui";

const emit = defineEmits<{ (e: "quick", prompt: string): void }>();

const kpis = [
  { label: "季度 GMV（万元）", value: 1842, display: "1,842", delta: 0.23, deltaLabel: "vs Q2", series: [102, 118, 126, 139, 133, 148, 155, 170, 166, 182, 194, 205] },
  { label: "订单量", value: 48620, display: "48,620", delta: 0.15, deltaLabel: "vs Q2", series: [2900, 3050, 3320, 3480, 3410, 3690, 3950, 4100, 4020, 4380, 4450, 4870] },
  { label: "客单价（元）", value: 379, display: "379", delta: 0.07, deltaLabel: "vs Q2", series: [351, 355, 358, 357, 362, 360, 366, 364, 369, 371, 374, 379] },
  { label: "退货率（%）", value: 4.2, display: "4.2", delta: -0.12, invertDelta: true, deltaLabel: "vs Q2 · 越低越好", series: [5.6, 5.4, 5.2, 5.3, 5.0, 4.9, 4.8, 4.7, 4.6, 4.4, 4.3, 4.2] },
];

const channels = {
  total: 1842,
  unit: "万元",
  items: [
    { label: "线上商城", value: 862, color: "#c2410c" },
    { label: "小程序商城", value: 512, color: "#e8925e" },
    { label: "门店 POS", value: 298, color: "#d8b28a" },
    { label: "分销渠道", value: 170, color: "#b9a58c" },
  ],
};

const topSkus = [
  { sku: "SKU-1024 智能保温杯 Pro", gmv: "286", delta: "+41%", refund: "2.1%" },
  { sku: "SKU-2077 无线降噪耳机 X3", gmv: "241", delta: "+66%", refund: "3.8%" },
  { sku: "SKU-3310 儿童学习桌 S2", gmv: "198", delta: "+12%", refund: "5.2%" },
  { sku: "SKU-4096 轻便折叠单车", gmv: "154", delta: "−9%", refund: "7.6%" },
  { sku: "SKU-5120 都市通勤背包", gmv: "133", delta: "+22%", refund: "4.4%" },
];

function runReport() {
  emit("quick", "请依次调用 analysis_plan_create、analysis_execute_plan 和 analysis_run_report 工具，为 2026-Q3 销售复盘制定计划、执行并生成完整报告");
}

function drillSku(row: (typeof topSkus)[number]) {
  emit("quick", `请调用 analysis_drilldown 工具，按 week 维度下钻查看 ${row.sku.split(" ")[0]} 的周粒度销售走势`);
}
</script>

<template>
  <div>
    <!-- 工具栏 -->
    <div class="h-toolbar">
      <span class="h-toolbar__title"><FileBarChart :size="14" style="vertical-align: -2px" /> 营收分析</span>
      <span class="h-pill"><Calendar :size="11" /> 周期 <b>2026-Q3</b></span>
      <span class="h-pill">对比 <b>2026-Q2</b></span>
      <span class="h-pill"><Database :size="11" /> 数据源 <b>shop_prod（12:00 已同步）</b></span>
      <span class="h-spacer" />
      <button class="h-btn" @click="emit('quick', '请调用 analysis_drilldown 工具，按 channel 维度下钻 Q3 销售明细')">按渠道下钻</button>
      <button class="h-btn h-btn--primary" @click="runReport">
        <FileBarChart :size="12" /> 生成分析报告
      </button>
    </div>

    <!-- KPI 总览 -->
    <div class="h-strip">
      <div v-for="k in kpis" :key="k.label" class="h-strip__item">
        <span class="h-strip__label">{{ k.label }}</span>
        <span class="h-strip__val" style="display: flex; align-items: baseline; gap: 6px">
          {{ k.display }}
          <span
            style="font-size: 11px; display: inline-flex; align-items: center; gap: 2px"
            :style="k.invertDelta ? (k.delta < 0 ? 'color:#15803d' : 'color:#dc2626') : k.delta >= 0 ? 'color:#15803d' : 'color:#dc2626'"
          >
            <ArrowUpRight v-if="k.delta >= 0" :size="11" />
            <ArrowDownRight v-else :size="11" />
            {{ (k.delta >= 0 ? "+" : "") + Math.round(k.delta * 100) + "%" }}
          </span>
        </span>
        <VaKpiChart
          :label="k.deltaLabel"
          :value="k.value"
          :series="k.series"
          :invert-delta="k.invertDelta"
          :width="170"
          :height="30"
          :color="k.invertDelta ? '#15803d' : undefined"
        />
      </div>
    </div>

    <div class="h-grid2">
      <!-- 渠道构成 -->
      <div class="h-panel">
        <div class="h-panel__head">
          <span><Table2 :size="12" style="vertical-align: -1px" /> 渠道构成拆解</span>
          <span class="h-panel__count">合计 1,842 万元</span>
        </div>
        <div class="h-panel__body">
          <VaBreakdownChart :items="channels.items" :total="channels.total" :unit="channels.unit" bar-scale="max" />
          <p style="font-size: 11px; color: var(--gv-muted); margin: 10px 0 0; line-height: 1.6">
            小程序渠道增速最快（+38%）且新客占比最高（41%）；门店 POS 为唯一负增长渠道（−7%），与华北区域闭店相关。
          </p>
        </div>
      </div>

      <!-- Top SKU -->
      <div class="h-panel">
        <div class="h-panel__head">
          <span>Top 5 SKU</span>
          <span class="h-panel__count">占季度 GMV 55%</span>
        </div>
        <div style="overflow-x: auto">
          <table class="h-table">
            <thead>
              <tr><th>SKU</th><th>GMV（万）</th><th>环比</th><th>退货率</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="row in topSkus" :key="row.sku" @click="drillSku(row)">
                <td>{{ row.sku }}</td>
                <td>{{ row.gmv }}</td>
                <td :style="row.delta.startsWith('−') ? 'color:#dc2626;font-weight:600' : 'color:#15803d;font-weight:600'">{{ row.delta }}</td>
                <td>{{ row.refund }}</td>
                <td><span style="color: var(--gv-accent); font-weight: 600">周走势 →</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
