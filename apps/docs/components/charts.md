<script setup lang="ts">
import {
  VaKpiChart,
  VaMetricChart,
  VaSmartRecommendation,
} from "@vuagent/ui";

const kpiSeries = [12, 18, 15, 24, 32, 28, 45, 52];

const metricSeries = [
  { label: "10:00", value: 420 },
  { label: "10:15", value: 680 },
  { label: "10:30", value: 950 },
  { label: "10:45", value: 720 },
  { label: "11:00", value: 1280 },
];

function handleAction(id: string) {
  alert(`触发建议操作: ${id}`);
}
</script>

# 反馈与数据可视化组件

> 提供零重型图表库依赖（纯手写轻量 SVG）、针对 AI Agent 业务指标分析与建议反馈的高性能展示组件。

---

## 1. VaKpiChart — 迷你趋势指标卡片

零外部图表依赖，使用纯 SVG 绘制平滑的 Sparkline 走势图，支持自动环比涨跌计算。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">核心 KPI 指标卡效果</div>
  <div class="demo-row">
    <div style="width: 280px;">
      <VaKpiChart
        label="今日 Agent 任务执行"
        :value="1428"
        :delta="0.24"
        delta-label="较昨日同期"
        :series="kpiSeries"
      />
    </div>
    <div style="width: 280px;">
      <VaKpiChart
        label="Token 平均单耗"
        :value="3200"
        :delta="-0.12"
        delta-label="较上周环比"
        :series="[4500, 4200, 3900, 3600, 3200]"
        invert-delta
      />
    </div>
  </div>
</div>

---

## 2. VaMetricChart — 时序折线/柱状指标图

用于大模型主动调用 `ui_metric_chart` 工具或业务端展示多时间维度的性能与业务数据走势。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">时序折线走势图</div>
  <VaMetricChart
    title="Agent 每分钟 Token 吞吐速率 (TPM)"
    unit="TPM"
    chart-type="line"
    :series="metricSeries"
  />
</div>

---

## 3. VaSmartRecommendation — 智能建议卡片

结合 Agent 分析结论，向用户提出优化建议，支持标注预期收益与一键采纳操作。

### 交互效果预览

<div class="demo-preview">
  <div class="demo-title">AI 智能建议卡片</div>
  <VaSmartRecommendation
    title="检测到历史会话存在大量冗余工具返回"
    description="启用上下文滑动折叠与 Prompt Cache 可显著缩短下轮响应时间。"
    impact="预计降低 35% Token 成本"
    :actions="[
      { id: 'compress', label: '立即压缩会话', primary: true },
      { id: 'ignore', label: '暂不处理' }
    ]"
    @action="handleAction"
  />
</div>
