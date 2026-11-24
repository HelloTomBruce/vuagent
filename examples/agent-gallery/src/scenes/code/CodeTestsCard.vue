<script setup lang="ts">
import { CheckCircle2, FlaskConical } from "lucide-vue-next";
import { VaTerminalLog } from "@vuagent/ui";

export interface CodeTestsProps {
  title?: string;
  verdict?: string;
  lines?: string[];
}

withDefaults(defineProps<CodeTestsProps>(), {
  title: "vitest",
  verdict: "",
  lines: () => [],
});
</script>

<template>
  <div class="tests-card">
    <div class="tests-card__head">
      <FlaskConical :size="15" />
      <div class="tests-card__titlebox">
        <div class="tests-card__title">重构验证测试</div>
        <div class="tests-card__meta">失败用例 → 自动修复 → 重跑全绿，全过程日志留痕</div>
      </div>
      <div v-if="verdict" class="tests-card__verdict">
        <CheckCircle2 :size="13" />
        {{ verdict }}
      </div>
    </div>
    <VaTerminalLog :title="title" :lines="(lines || []) as any" :max-lines="200" />
  </div>
</template>

<style scoped>
.tests-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.tests-card__head { display: flex; align-items: center; gap: 8px; }
.tests-card__head > svg { color: var(--gv-accent); }
.tests-card__titlebox { flex: 1; min-width: 0; }
.tests-card__title { font-size: 13px; font-weight: 600; }
.tests-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }
.tests-card__verdict {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 600; padding: 3px 9px;
  border-radius: 999px; background: #dcfce7; color: #15803d;
}
</style>
