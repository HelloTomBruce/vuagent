<script setup lang="ts">
import { BarChart3, Database, FileSpreadsheet } from "lucide-vue-next";

const emit = defineEmits<{ (e: "quick", prompt: string): void }>();
</script>

<template>
  <div>
    <div class="host-banner">
      <h1>商业数据分析台（BI Workspace）</h1>
      <p>Agent 先给出分步分析计划（透明可核对），执行后把 KPI 趋势与渠道构成渲染成图表卡片——数据永远来自结构化工具结果，不是模型编的故事。</p>
    </div>

    <div class="src-row">
      <div class="src-card"><Database :size="15" /> orders <span>486,209 行</span></div>
      <div class="src-card"><Database :size="15" /> order_items <span>1,203,447 行</span></div>
      <div class="src-card"><FileSpreadsheet :size="15" /> dim_channels <span>4 渠道</span></div>
    </div>

    <div class="hint-grid">
      <div class="hint-card">
        <BarChart3 :size="14" />
        <div>
          <b>计划先行</b>
          <p>「制定分析计划」会返回带状态步骤的计划卡，执行路径一目了然。</p>
        </div>
      </div>
      <div class="hint-card">
        <BarChart3 :size="14" />
        <div>
          <b>图表即结果</b>
          <p>「跑一遍分析」直接产出 KPI 趋势 + 渠道构成两张卡片。</p>
        </div>
      </div>
    </div>

    <button class="cta" @click="emit('quick', '请调用 analysis_plan_create 工具为 Q3 销售复盘制定分析计划')">
      从「制定分析计划」开始体验
    </button>
  </div>
</template>

<style scoped>
.host-banner { margin-bottom: 14px; }
.host-banner h1 { font-size: 16px; margin: 0 0 4px; }
.host-banner p { font-size: 12px; color: var(--gv-muted); margin: 0; max-width: 640px; line-height: 1.6; }

.src-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.src-card {
  display: inline-flex; align-items: center; gap: 6px;
  background: #ffffff; border: 1px solid var(--gv-border);
  border-radius: 8px; padding: 8px 12px;
  font-family: var(--va-font-mono, monospace); font-size: 12px;
}
.src-card span { color: var(--gv-muted); font-size: 11px; }

.hint-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; margin-bottom: 16px; }
.hint-card {
  display: flex; gap: 10px; align-items: flex-start;
  background: #ffffff; border: 1px solid var(--gv-border);
  border-radius: 10px; padding: 12px 14px;
}
.hint-card svg { color: var(--gv-accent); flex-shrink: 0; margin-top: 2px; }
.hint-card b { font-size: 12px; }
.hint-card p { font-size: 11px; color: var(--gv-muted); margin: 4px 0 0; line-height: 1.5; }

.cta {
  border: 1px solid var(--gv-accent); background: #fff1e7; color: var(--gv-accent);
  font-size: 12px; font-weight: 600; padding: 8px 14px; border-radius: 8px; cursor: pointer;
}
.cta:hover { background: #ffe4d1; }
</style>
