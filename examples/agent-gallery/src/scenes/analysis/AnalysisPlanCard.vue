<script setup lang="ts">
import { ClipboardList } from "lucide-vue-next";
import { VaAgentPlan } from "@vuagent/ui";

export interface AnalysisPlanProps {
  topic?: string;
  steps?: Array<{
    id: string;
    title: string;
    detail?: string;
    status?: string;
    duration?: number;
  }>;
}

withDefaults(defineProps<AnalysisPlanProps>(), {
  topic: "分析主题",
  steps: () => [],
});
</script>

<template>
  <div class="plan-card">
    <div class="plan-card__head">
      <ClipboardList :size="15" />
      <div>
        <div class="plan-card__title">分析计划 · {{ topic }}</div>
        <div class="plan-card__meta">只读审阅模式——agent 执行路径先亮出来，可核对再放行</div>
      </div>
    </div>
    <VaAgentPlan :steps="(steps || []) as any" :editable="false" />
  </div>
</template>

<style scoped>
.plan-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.plan-card__head { display: flex; align-items: flex-start; gap: 8px; }
.plan-card__head svg { color: var(--gv-accent); margin-top: 2px; }
.plan-card__title { font-size: 13px; font-weight: 600; }
.plan-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }
</style>
