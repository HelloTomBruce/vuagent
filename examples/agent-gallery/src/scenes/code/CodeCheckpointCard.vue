<script setup lang="ts">
import { History } from "lucide-vue-next";
import { VaCheckpointList } from "@vuagent/ui";

export interface CodeCheckpointProps {
  target?: string;
  checkpoints?: Array<{
    id: string;
    label: string;
    createdAt: number;
    summary?: string;
    current?: boolean;
  }>;
}

withDefaults(defineProps<CodeCheckpointProps>(), {
  target: "",
  checkpoints: () => [],
});
</script>

<template>
  <div class="ck-card">
    <div class="ck-card__head">
      <History :size="15" />
      <div>
        <div class="ck-card__title">重构已应用 · 检查点就绪</div>
        <div class="ck-card__meta">写操作已落盘并生成检查点——出问题可一键回滚到重构前快照</div>
      </div>
    </div>
    <VaCheckpointList :checkpoints="(checkpoints || []) as any" />
  </div>
</template>

<style scoped>
.ck-card {
  border: 1px solid #bbf7d0;
  background: linear-gradient(180deg, #f0fdf4 0%, var(--va-card, #ffffff) 100%);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.ck-card__head { display: flex; align-items: flex-start; gap: 8px; }
.ck-card__head svg { color: #16a34a; margin-top: 2px; }
.ck-card__title { font-size: 13px; font-weight: 600; }
.ck-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }
</style>
