<script setup lang="ts">
/**
 * 右侧边栏：审批收件箱 + 当前工作区文件树，以 tab 形式切换（TASK-047）
 * - 哪些 tab 存在由交互设置控制（showApprovals / showFileTree，localStorage 持久化）；
 *   活动 tab 被关闭时自动回落到剩余的第一个 tab
 * - 文件树随 activeWorkspaceId 变化拉取（只读、深度 4 层、超限截断提示）
 */
import { computed, ref, watch } from "vue";
import { PanelRight } from "lucide-vue-next";
import { VaDecisionInbox, VaFileTree, VaTooltip } from "@vuagent/ui";
import type { Decision } from "@vuagent/ui";
import { fetchWorkspaceFiles, type WorkspaceFileNode } from "../api/client";
import { useInteractionSettings } from "../composables/useInteractionSettings";

const props = defineProps<{
  /** 跨会话待审批决策 */
  decisions: Decision[];
  /** 当前工作区 id（文件树数据源；空串 = 无工作区，文件 tab 显示引导） */
  workspaceId: string;
}>();

const emit = defineEmits<{
  (e: "collapse"): void;
  (e: "decide", decision: Decision, answer: "primary" | "secondary"): void;
}>();

const { settings } = useInteractionSettings();

type TabKey = "approvals" | "files";

/** 存在的 tab 由交互设置决定（顺序即展示顺序） */
const tabs = computed(() => {
  const list: { key: TabKey; label: string }[] = [];
  if (settings.value.showApprovals) list.push({ key: "approvals", label: "审批" });
  if (settings.value.showFileTree) list.push({ key: "files", label: "文件" });
  return list;
});

const activeTab = ref<TabKey>("approvals");
/** 活动 tab 被设置关闭时，回落到剩余的第一个 tab */
watch(tabs, (list) => {
  if (!list.some((t) => t.key === activeTab.value)) {
    activeTab.value = list[0]?.key ?? "approvals";
  }
});

/* ---------- 文件树数据 ---------- */
const fileTree = ref<WorkspaceFileNode[]>([]);
const filesLoading = ref(false);
const filesTruncated = ref(false);
const filesError = ref("");

async function loadFiles(wsId: string) {
  fileTree.value = [];
  filesTruncated.value = false;
  filesError.value = "";
  if (!wsId) return;
  filesLoading.value = true;
  const data = await fetchWorkspaceFiles(wsId);
  filesLoading.value = false;
  if (!data) {
    filesError.value = "目录读取失败";
    return;
  }
  fileTree.value = data.tree;
  filesTruncated.value = data.truncated;
}

watch(
  () => props.workspaceId,
  (id) => loadFiles(id),
  { immediate: true },
);
</script>

<template>
  <aside class="va-console__right-sidebar">
    <!-- 侧栏头：tab 切换（审批 / 文件） + 收起按钮 -->
    <div class="va-console__rtabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="va-console__rtab"
        :class="{ 'va-console__rtab--active': activeTab === t.key }"
        type="button"
        :aria-selected="activeTab === t.key"
        @click="activeTab = t.key"
      >
        {{ t.label }}
        <span
          v-if="t.key === 'approvals' && decisions.length > 0"
          class="va-console__rtab-badge"
        >{{ decisions.length }}</span>
      </button>
      <VaTooltip content="收起侧栏" placement="bottom">
        <button
          class="va-console__rtab-collapse"
          type="button"
          aria-label="收起侧栏"
          @click="emit('collapse')"
        >
          <PanelRight :size="14" />
        </button>
      </VaTooltip>
    </div>

    <div class="va-console__rtab-body">
      <!-- 审批 tab -->
      <template v-if="activeTab === 'approvals'">
        <VaDecisionInbox
          v-if="decisions.length > 0"
          :decisions="decisions"
          @decide="(d, a) => emit('decide', d, a)"
        />
        <div v-else class="va-console__rtab-empty">
          <PanelRight :size="20" />
          <p>暂无待审批事项</p>
        </div>
      </template>

      <!-- 文件 tab -->
      <template v-else-if="activeTab === 'files'">
        <div v-if="!workspaceId" class="va-console__rtab-empty">
          <p>先选择或创建工作区</p>
        </div>
        <div v-else-if="filesLoading" class="va-console__rtab-empty"><p>正在读取目录…</p></div>
        <div v-else-if="filesError" class="va-console__rtab-empty"><p>{{ filesError }}</p></div>
        <template v-else>
          <p v-if="filesTruncated" class="va-rsb__truncate-note">目录过大，仅展示前 2000 项</p>
          <VaFileTree
            :tree="fileTree"
            :default-expand-depth="1"
            aria-label="当前工作区文件目录"
          />
        </template>
      </template>

      <!-- 两个 tab 都被关闭时的兜底提示 -->
      <div v-if="tabs.length === 0" class="va-console__rtab-empty">
        <PanelRight :size="20" />
        <p>侧栏内容已在「设置 → 交互」中全部隐藏</p>
      </div>
    </div>
  </aside>
</template>

<style>
/* 文件 tab 的超限截断提示 */
.va-rsb__truncate-note {
  margin: 0;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--va-warning, #b45309);
}
</style>
