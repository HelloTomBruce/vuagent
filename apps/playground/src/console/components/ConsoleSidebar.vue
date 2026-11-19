<script setup lang="ts">
/**
 * 左侧边栏：新建会话 / 工作区折叠树 / 会话列表（重命名、归档、删除）/ 归档抽屉 / 底部设置入口
 * 归档抽屉展开态为纯视图状态，组件内自管理
 */
import { ref } from "vue";
import { VaTooltip } from "@vuagent/ui";
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MessageSquare,
  Pen,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-vue-next";
import type { SessionItem, WorkspaceItem } from "../types";

defineProps<{
  workspaces: WorkspaceItem[];
  activeWorkspaceId: string;
  expandedWorkspaces: Set<string>;
  activeSessions: SessionItem[];
  archivedSessions: SessionItem[];
  activeSessionId: string;
  isNewChat: boolean;
  sessionRunningMap: Map<string, boolean>;
  editingSessionId: string | null;
  renameDraft: string;
}>();

defineEmits<{
  (e: "start-new-chat", wsId?: string): void;
  (e: "select-session", session: SessionItem): void;
  (e: "toggle-expand", wsId: string): void;
  (e: "pick-workspace"): void;
  (e: "ask-delete-workspace", wsId: string, event: Event): void;
  (e: "start-rename", session: SessionItem, event: Event): void;
  (e: "save-rename"): void;
  (e: "cancel-rename"): void;
  (e: "toggle-archive", session: SessionItem, event: Event): void;
  (e: "ask-delete-session", sessionId: string, event: Event): void;
  (e: "open-settings"): void;
  (e: "update:renameDraft", value: string): void;
}>();

const archivedExpanded = ref(false);
</script>

<template>
  <aside class="va-console__sidebar" @click.stop>
    <!-- 顶部：新建会话主操作 -->
    <div class="va-console__sidebar-header">
      <button class="va-console__btn-new-chat" type="button" @click="$emit('start-new-chat')">
        <Plus :size="16" aria-hidden="true" />
        <span>新建会话</span>
      </button>
    </div>

    <!-- 中部：工作区与会话折叠树 -->
    <div class="va-console__tree-scroll">
      <div class="va-console__section-title">
        <span>工作区 (WORKSPACES)</span>
        <VaTooltip content="添加本地工作区（调起系统选择框）" placement="bottom">
          <button
            class="va-console__icon-btn"
            type="button"
            aria-label="添加本地工作区"
            @click="$emit('pick-workspace')"
          >
            <FolderPlus :size="15" aria-hidden="true" />
          </button>
        </VaTooltip>
      </div>

      <!-- 工作区列表 -->
      <div v-for="ws in workspaces" :key="ws.id" class="va-console__ws-card">
        <!-- 工作区头部 (可折叠) -->
        <div
          class="va-console__ws-head"
          :class="{ 'va-console__ws-head--active': ws.id === activeWorkspaceId }"
          @click="$emit('toggle-expand', ws.id)"
        >
          <button class="va-console__toggle-arrow" type="button">
            <ChevronDown v-if="expandedWorkspaces.has(ws.id)" :size="14" />
            <ChevronRight v-else :size="14" />
          </button>
          <Folder :size="15" class="va-console__ws-folder-icon" />
          <span class="va-console__ws-name" :title="ws.rootPath">{{ ws.name }}</span>
          <span class="va-console__ws-count">
            {{ activeSessions.filter((s) => s.workspaceId === ws.id).length }}
          </span>

          <!-- 工作区快捷操作 -->
          <div class="va-console__ws-ops" @click.stop>
            <VaTooltip content="在此工作区新建会话" placement="right">
              <button
                class="va-console__icon-btn-xs"
                type="button"
                aria-label="在此工作区新建会话"
                @click="$emit('start-new-chat', ws.id)"
              >
                <Plus :size="13" />
              </button>
            </VaTooltip>
            <VaTooltip content="删除工作区" placement="right">
              <button
                class="va-console__icon-btn-xs"
                type="button"
                aria-label="删除工作区"
                @click="$emit('ask-delete-workspace', ws.id, $event)"
              >
                <Trash2 :size="13" />
              </button>
            </VaTooltip>
          </div>
        </div>

        <!-- 该工作区下的会话列表 (展开时显示) -->
        <div v-if="expandedWorkspaces.has(ws.id)" class="va-console__session-list">
          <div
            v-for="s in activeSessions.filter((x) => x.workspaceId === ws.id)"
            :key="s.id"
            class="va-console__session-item"
            :class="{ 'va-console__session-item--active': s.id === activeSessionId && !isNewChat }"
            @click="$emit('select-session', s)"
          >
            <!-- 重命名输入框 -->
            <template v-if="editingSessionId === s.id">
              <input
                :value="renameDraft"
                class="va-console__rename-input"
                type="text"
                @click.stop
                @input="$emit('update:renameDraft', ($event.target as HTMLInputElement).value)"
                @keydown.enter.prevent="$emit('save-rename')"
                @keydown.escape.prevent="$emit('cancel-rename')"
              />
              <button class="va-console__icon-btn-xs" type="button" @click.stop="$emit('save-rename')">
                <Check :size="13" />
              </button>
              <button class="va-console__icon-btn-xs" type="button" @click.stop="$emit('cancel-rename')">
                <X :size="13" />
              </button>
            </template>

            <!-- 正常展示 -->
            <template v-else>
              <VaTooltip v-if="sessionRunningMap.get(s.id) || s.isRunning" content="任务正在后台持续执行" placement="right">
                <span class="va-console__running-pulse-dot" />
              </VaTooltip>
              <MessageSquare v-else :size="13" class="va-console__session-icon" />
              <span class="va-console__session-title" :title="s.title">{{ s.title || "未命名任务" }}</span>

              <!-- 会话右侧操作栏 -->
              <div class="va-console__session-ops" @click.stop>
                <VaTooltip content="重命名" placement="right">
                  <button
                    class="va-console__icon-btn-xs"
                    type="button"
                    aria-label="重命名会话"
                    @click="$emit('start-rename', s, $event)"
                  >
                    <Pen :size="12" />
                  </button>
                </VaTooltip>
                <VaTooltip content="归档" placement="right">
                  <button
                    class="va-console__icon-btn-xs"
                    type="button"
                    aria-label="归档会话"
                    @click="$emit('toggle-archive', s, $event)"
                  >
                    <Archive :size="12" />
                  </button>
                </VaTooltip>
                <VaTooltip content="删除会话" placement="right">
                  <button
                    class="va-console__icon-btn-xs"
                    type="button"
                    aria-label="删除会话"
                    @click="$emit('ask-delete-session', s.id, $event)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </VaTooltip>
              </div>
            </template>
          </div>

          <!-- 空会话提示 -->
          <div
            v-if="activeSessions.filter((x) => x.workspaceId === ws.id).length === 0"
            class="va-console__empty-tip"
          >
            暂无会话
          </div>
        </div>
      </div>

      <!-- 底部已归档分区 -->
      <div v-if="archivedSessions.length > 0" class="va-console__archived-section">
        <button
          class="va-console__archived-toggle"
          type="button"
          @click="archivedExpanded = !archivedExpanded"
        >
          <ChevronDown v-if="archivedExpanded" :size="14" />
          <ChevronRight v-else :size="14" />
          <span>已归档 ({{ archivedSessions.length }})</span>
        </button>

        <div v-if="archivedExpanded" class="va-console__session-list">
          <div
            v-for="s in archivedSessions"
            :key="s.id"
            class="va-console__session-item va-console__session-item--archived"
          >
            <MessageSquare :size="13" class="va-console__session-icon" />
            <span class="va-console__session-title">{{ s.title }}</span>
            <div class="va-console__session-ops">
              <VaTooltip content="恢复会话" placement="right">
                <button
                  class="va-console__icon-btn-xs"
                  type="button"
                  aria-label="恢复会话"
                  @click="$emit('toggle-archive', s, $event)"
                >
                  <ArchiveRestore :size="12" />
                </button>
              </VaTooltip>
              <VaTooltip content="删除" placement="right">
                <button
                  class="va-console__icon-btn-xs"
                  type="button"
                  aria-label="删除已归档会话"
                  @click="$emit('ask-delete-session', s.id, $event)"
                >
                  <Trash2 :size="12" />
                </button>
              </VaTooltip>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 侧边栏底部：模型设置与全局入口 -->
    <div class="va-console__sidebar-footer">
      <button class="va-console__footer-btn" type="button" @click="$emit('open-settings')">
        <Settings :size="15" />
        <span>设置</span>
      </button>
    </div>
  </aside>
</template>
