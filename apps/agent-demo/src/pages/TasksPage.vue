<script setup lang="ts">
import { computed, ref } from "vue";
import {
  VaAgentInbox,
  VaChangeSummary,
  VaCheckpointList,
  VaCodeDiff,
  VaFileTree,
  VaTerminalLog,
  buildFileTree,
  vaToaster,
} from "@vuagent/ui";
import { useAgentEngine } from "../engine/useAgentEngine";

const { state, restoreCheckpoint } = useAgentEngine();

/** Inbox 任务标题 → 剧本名映射（demo 展示文案） */
const tasks = computed(() =>
  state.tasks.map((t) => ({
    ...t,
    title: ({ "weekly-report": "生成周报", "refactor-users": "重构用户列表页", "data-analysis": "分析任务数据", fallback: "杂项问答" })[t.title] ?? t.title,
  })),
);

const tree = computed(() => buildFileTree(state.tree));
const selectedFile = ref<string>();

/** 文件树点选 → 若有 diff 且路径匹配则展示 */
const showDiff = computed(() => state.diff && (!selectedFile.value || selectedFile.value === state.diff.file));
</script>

<template>
  <div class="tasks-page">
    <!-- 空态 -->
    <div v-if="!tasks.length && !state.changeSummary" class="empty">
      <p>还没有任务。去「对话」发一条消息（如「重构用户列表页」）触发剧本。</p>
    </div>

    <div v-else class="grid">
      <section class="col">
        <h3 class="col-title">任务收件箱</h3>
        <VaAgentInbox
          :tasks="tasks"
          @open="(t) => vaToaster.add({ title: `查看任务：${t.title}` })"
          @retry="(t) => vaToaster.add({ title: `重试：${t.title}`, kind: 'info' })"
          @cancel="(t) => vaToaster.add({ title: `已取消：${t.title}`, kind: 'warning' })"
        />

        <template v-if="state.checkpoints.length">
          <h3 class="col-title" style="margin-top: 20px">检查点（可回滚）</h3>
          <VaCheckpointList
            :checkpoints="state.checkpoints"
            @restore="(id) => { restoreCheckpoint(id); vaToaster.add({ title: '已恢复检查点', description: '变更产物已回滚', kind: 'success' }); }"
            @preview="() => vaToaster.add({ title: 'diff 预览见右侧', kind: 'info' })"
          />
        </template>
      </section>

      <section class="col col--wide">
        <template v-if="state.changeSummary">
          <h3 class="col-title">本轮变更</h3>
          <VaChangeSummary
            :files="state.changeSummary.files"
            :duration="state.changeSummary.durationMs"
            :tool-calls="state.changeSummary.toolCalls"
            :max-files="3"
            @open-file="(f) => vaToaster.add({ title: `查看 diff：${f.path}` })"
          />
        </template>

        <template v-if="tree.length">
          <h3 class="col-title" style="margin-top: 20px">变更文件</h3>
          <VaFileTree
            v-model:selected="selectedFile"
            :tree="tree"
            title="agent 变更"
            :max-height="220"
            @select="(n) => selectedFile = n.path"
          />
          <div v-if="showDiff" style="margin-top: 12px">
            <VaCodeDiff
              :file-name="state.diff!.file"
              :old-text="state.diff!.oldText"
              :new-text="state.diff!.newText"
              :max-height="320"
            />
          </div>
        </template>

        <template v-if="state.terminal.length">
          <h3 class="col-title" style="margin-top: 20px">终端输出</h3>
          <VaTerminalLog title="bash" :lines="state.terminal" :max-height="180" show-line-numbers />
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.tasks-page { max-width: 1080px; margin: 0 auto; }
.empty {
  padding: 64px 16px;
  text-align: center;
  color: var(--va-muted);
  font-size: 13.5px;
}
.grid {
  display: grid;
  grid-template-columns: minmax(300px, 5fr) minmax(0, 7fr);
  gap: 20px;
  align-items: start;
}
@media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
.col { display: flex; flex-direction: column; min-width: 0; }
.col-title {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--va-muted);
}
</style>
