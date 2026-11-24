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

const props = withDefaults(defineProps<CodeCheckpointProps>(), {
  target: "",
  checkpoints: () => [],
});

/** 卡片内交互回传：检查点 diff 预览 / 回滚都走下一轮 agent 调用 */
const emit = defineEmits<{ (e: "quick", prompt: string): void }>();

function onPreview(id?: string) {
  emit("quick", `请展示检查点 ${id || "ck-2"} 到 ${props.checkpoints.find((c) => c.current)?.id || "ck-3"} 之间的代码变更 diff`);
}

function onRestore(id?: string) {
  emit("quick", `请回滚到检查点 ${id || "ck-2"}（重构前快照），并展示回滚后的仓库状态`);
}
</script>

<template>
  <div class="ck-card">
    <div class="ck-card__head">
      <History :size="15" />
      <div>
        <div class="ck-card__title">重构已应用 · 检查点就绪</div>
        <div class="ck-card__meta">写操作已落盘并生成检查点——点击行上的「diff」预览变更，「恢复」触发回滚流程</div>
      </div>
    </div>
    <VaCheckpointList
      :checkpoints="(checkpoints || []) as any"
      @preview="(id: string) => onPreview(id)"
      @restore="(id: string) => onRestore(id)"
    />
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
