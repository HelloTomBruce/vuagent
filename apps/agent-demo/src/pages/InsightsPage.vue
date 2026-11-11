<script setup lang="ts">
import { computed } from "vue";
import {
  VaBreakdownChart,
  VaCompactBreakdown,
  VaContextWindow,
  VaExperimentCard,
  VaKpiChart,
} from "@vuagent/ui";
import { useAgentEngine } from "../engine/useAgentEngine";

const { state } = useAgentEngine();

const kpis = computed(() => [state.kpis.runs, state.kpis.done, state.kpis.fail]);

const contextParts = computed(() => [
  { id: "sys", label: "系统提示", tokens: 1_800, kind: "system" as const },
  { id: "hist", label: "对话历史", tokens: 9_600 + state.messages.length * 420, kind: "history" as const },
  { id: "tools", label: "工具定义", tokens: 3_400, kind: "tools" as const },
]);

const modelMix = computed(() => [
  { label: "Claude", value: 500 + (state.usage.segments[0]?.used ?? 0) / 4000 },
  { label: "GPT", value: 280 },
  { label: "GLM", value: 220 },
]);
</script>

<template>
  <div class="insights-page">
    <div class="kpis">
      <VaKpiChart v-for="k in kpis" :key="k.label" v-bind="k" />
    </div>

    <div class="grid">
      <section class="card">
        <h3 class="card-title">任务类型分布</h3>
        <VaBreakdownChart :items="state.breakdown" unit="次" :max-rows="5" />
      </section>

      <section class="card">
        <h3 class="card-title">模型用量占比</h3>
        <VaCompactBreakdown :segments="modelMix" />
        <h3 class="card-title" style="margin-top: 18px">当前上下文构成</h3>
        <VaContextWindow :parts="contextParts" :capacity="32_000" />
      </section>

      <section v-if="state.experiment" class="card card--wide">
        <h3 class="card-title">实验结论</h3>
        <VaExperimentCard
          :title="state.experiment.title"
          metric="任务完成率"
          status="success"
          :confidence="state.experiment.confidence"
          :variants="[
            { id: 'a', name: 'v1 基线', value: state.experiment.a, format: { style: 'percent' } },
            { id: 'b', name: 'v2 改写', value: state.experiment.b, delta: state.experiment.bDelta, format: { style: 'percent' } },
          ]"
        />
      </section>

      <section v-else class="card card--wide card--empty">
        <p>发一条「分析任务数据」到对话，这里会出现实验对比结论。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.insights-page { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; align-items: start; }
.card {
  background: var(--va-card);
  border: 1px solid var(--va-edge);
  border-radius: 14px;
  padding: 16px;
  min-width: 0;
}
.card--wide { grid-column: 1 / -1; }
.card--empty { color: var(--va-muted); font-size: 13px; text-align: center; padding: 28px; }
.card-title {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--va-muted);
}
</style>
