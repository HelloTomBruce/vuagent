<script setup lang="ts">
import { computed, ref } from "vue";
import { FileCode2 } from "lucide-vue-next";
import { VaFileTree, VaCodeDiff, VaChangeSummary } from "@vuagent/ui";

export interface CodeChangeProps {
  target?: string;
  summary?: {
    duration?: number;
    toolCalls?: number;
    files: Array<{ path: string; status: string; additions: number; deletions: number }>;
  };
  tree?: Array<any>;
  diffs?: Array<{ fileName: string; oldText: string; newText: string }>;
}

const props = withDefaults(defineProps<CodeChangeProps>(), {
  target: "",
  summary: () => ({ files: [] }),
  tree: () => [],
  diffs: () => [],
});

const selected = ref(props.diffs[0]?.fileName ?? "");
const currentDiff = computed(() => props.diffs.find((d) => d.fileName === selected.value) ?? props.diffs[0]);
</script>

<template>
  <div class="code-card">
    <div class="code-card__head">
      <FileCode2 :size="15" />
      <div>
        <div class="code-card__title">重构预览 · {{ target }}</div>
        <div class="code-card__meta">只读预览，尚未写入仓库——确认后可用「应用重构」触发审批落地</div>
      </div>
    </div>

    <VaChangeSummary
      v-if="summary?.files?.length"
      :files="summary.files as any"
      :duration="summary.duration ?? 0"
      :tool-calls="summary.toolCalls ?? 0"
      @open-file="(p: string) => (selected = p)"
    />

    <div class="code-card__body">
      <div class="code-card__tree">
        <VaFileTree :tree="tree as any" v-model:selected="selected" :default-expand-depth="2" />
      </div>
      <div class="code-card__diff">
        <VaCodeDiff
          v-if="currentDiff"
          :key="currentDiff.fileName"
          :file-name="currentDiff.fileName"
          :old-text="currentDiff.oldText"
          :new-text="currentDiff.newText"
          :context="2"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-card {
  border: 1px solid var(--gv-border);
  background: var(--va-card, #ffffff);
  border-radius: var(--va-radius-lg, 12px);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0;
}
.code-card__head { display: flex; align-items: flex-start; gap: 8px; }
.code-card__head svg { color: var(--gv-accent); margin-top: 2px; }
.code-card__title { font-size: 13px; font-weight: 600; }
.code-card__meta { font-size: 11px; color: var(--gv-muted); margin-top: 2px; }

.code-card__body {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 10px;
  align-items: start;
}
.code-card__tree {
  border: 1px solid var(--gv-border);
  border-radius: 8px;
  padding: 6px;
  max-height: 260px;
  overflow: auto;
  font-size: 11px;
}
.code-card__diff { min-width: 0; }

@media (max-width: 860px) {
  .code-card__body { grid-template-columns: 1fr; }
}
</style>
