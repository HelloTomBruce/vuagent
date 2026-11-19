<script setup lang="ts">
/**
 * 左侧边栏（TASK-045 dogfooding）：工作区分组/会话列表/归档分区/重命名/删除
 * 全部交给库组件 VaSessionTree；console 只保留 footer 设置入口与删除的 vaConfirm 路由
 * （confirm-mode="none"：树直接发 remove/removeWorkspace，宿主走 TASK-038 的模态确认）。
 */
import { computed } from "vue";
import { Settings } from "lucide-vue-next";
import { VaButton, VaSessionTree } from "@vuagent/ui";
import type { SessionItem, WorkspaceItem } from "../types";

const props = defineProps<{
  workspaces: WorkspaceItem[];
  /** 全量会话（组件按 archived/status 分区为活跃列表与归档区） */
  sessions: SessionItem[];
  activeWorkspaceId: string;
  activeSessionId: string;
  isNewChat: boolean;
  sessionRunningMap: Map<string, boolean>;
}>();

const emit = defineEmits<{
  (e: "start-new-chat", wsId?: string): void;
  (e: "select-session", session: SessionItem): void;
  (e: "pick-workspace"): void;
  (e: "delete-workspace", id: string): void;
  (e: "rename-session", id: string, title: string): void;
  (e: "toggle-archive", id: string, archived: boolean): void;
  (e: "toggle-pin", id: string): void;
  (e: "delete-session", id: string): void;
  (e: "open-settings"): void;
}>();

const activeSessions = computed(() => {
  const list = props.sessions.filter((s) => !s.archived && s.status !== "archived");
  // 置顶会话浮到最前；稳定排序保证未置顶会话保持原有相对顺序（组件内分组不重排）
  return [...list].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
});
const archivedSessions = computed(() =>
  props.sessions.filter((s) => s.archived || s.status === "archived"),
);

/** SessionItem → TreeSession 映射（归组/时间戳/运行中脉冲点） */
const treeSessions = computed(() =>
  activeSessions.value.map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    archived: false,
    workspaceId: s.workspaceId,
    running: props.sessionRunningMap.get(s.id) || s.isRunning,
    pinned: s.pinned,
  })),
);
const treeArchived = computed(() =>
  archivedSessions.value.map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    archived: true,
    workspaceId: s.workspaceId,
    pinned: s.pinned,
  })),
);
/** rootPath 作为分组描述（树的 title 悬停可见） */
const treeWorkspaces = computed(() =>
  props.workspaces.map((w) => ({ id: w.id, name: w.name, description: w.rootPath })),
);

function sessionById(id: string) {
  return props.sessions.find((s) => s.id === id);
}
</script>

<template>
  <aside class="va-console__sidebar">
    <VaSessionTree
      class="va-console__stree"
      :workspaces="treeWorkspaces"
      :sessions="treeSessions"
      :archived="treeArchived"
      :current-workspace-id="activeWorkspaceId"
      :current-session-id="isNewChat ? '' : activeSessionId"
      new-session
      searchable
      collapsible
      hover-ops
      workspace-create-mode="picker"
      confirm-mode="none"
      @create-workspace-pick="emit('pick-workspace')"
      @create-session="(wsId: string) => emit('start-new-chat', wsId)"
      @select-session="(id: string) => { const s = sessionById(id); if (s) emit('select-session', s); }"
      @remove-workspace="(id: string) => emit('delete-workspace', id)"
      @rename="(id: string, title: string) => emit('rename-session', id, title)"
      @archive="(id: string, archived: boolean) => emit('toggle-archive', id, archived)"
      @toggle-pin="(id: string) => emit('toggle-pin', id)"
      @remove="(id: string) => emit('delete-session', id)"
    >
      <template #footer>
        <VaButton variant="ghost" size="sm" block @click="emit('open-settings')">
          <template #icon>
            <Settings :size="15" />
          </template>
          设置
        </VaButton>
      </template>
    </VaSessionTree>
  </aside>
</template>
