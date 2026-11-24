<script setup lang="ts">
import { Lightbulb, Sparkles } from "lucide-vue-next";
import { VaInlineDiff } from "@vuagent/ui";

export interface CopyPolishProps {
  original?: string;
  revised?: string;
  style?: string;
  notes?: string[];
}

withDefaults(defineProps<CopyPolishProps>(), {
  original: "",
  revised: "",
  style: "冲击力",
  notes: () => [],
});
</script>

<template>
  <div class="polish-card">
    <div class="polish-card__head">
      <Sparkles :size="15" />
      <div>
        <div class="polish-card__title">文案精修 · {{ style }}风格</div>
        <div class="polish-card__meta">逐词点选「采纳 / 保留」，全部决断后自动合成定稿</div>
      </div>
    </div>

    <VaInlineDiff :original="original" :revised="revised" />

    <div v-if="notes?.length" class="polish-card__notes">
      <div class="polish-card__sec"><Lightbulb :size="12" /> 改写说明</div>
      <ul>
        <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.polish-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 6px 0;
}
.polish-card__head { display: flex; align-items: flex-start; gap: 8px; }
.polish-card__head svg { color: var(--gv-accent); margin-top: 2px; }
.polish-card__title { font-size: 13px; font-weight: 600; }
.polish-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }

.polish-card__notes { background: var(--va-bg-subtle, #faf9f7); border-radius: 8px; padding: 10px 12px; }
.polish-card__sec { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: var(--gv-muted); margin-bottom: 6px; }
.polish-card__notes ul { margin: 0; padding-left: 16px; }
.polish-card__notes li { font-size: 11px; color: var(--gv-ink); line-height: 1.7; }
</style>
