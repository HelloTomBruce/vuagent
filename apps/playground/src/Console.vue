<script setup lang="ts">
/**
 * Agent Harness 控制台（编排层）
 * 视图层已组件化至 ./console/components/，数据层在 ./console/composables/：
 *   ConsoleSidebar / ConsoleComposer(SeatDropdown) / TurnList(AssistantTurn/CardRenderer)
 *   DockedPlanBar / ModelSettingsModal；样式集中于 console/styles/console.css
 * 本文件只保留：组合式装配、欢迎页 hero 文案与用户动作编排。
 */
import { nextTick, onMounted, ref, useTemplateRef } from "vue";
import { Folder, Sparkles } from "lucide-vue-next";
import { VaToaster, vaToaster } from "@vuagent/ui";
import ConsoleSidebar from "./console/components/ConsoleSidebar.vue";
import ConsoleComposer from "./console/components/ConsoleComposer.vue";
import DockedPlanBar from "./console/components/DockedPlanBar.vue";
import ModelSettingsModal from "./console/components/ModelSettingsModal.vue";
import TurnList from "./console/components/TurnList.vue";
import { useApprovals } from "./console/composables/useApprovals";
import { useChatStream } from "./console/composables/useChatStream";
import { useModelProfiles } from "./console/composables/useModelProfiles";
import { useSessions } from "./console/composables/useSessions";
import type { SessionsApi } from "./console/composables/useSessions";
import { useWorkspaces } from "./console/composables/useWorkspaces";
import { PERMISSION_MODES } from "./console/types";

/* ==========================================================================
   纯视图状态
   ========================================================================== */
const isNewChat = ref<boolean>(true);
const composerText = ref<string>("");
const activePermission = ref<string>("review");
const permissionModes = PERMISSION_MODES;

const chatScrollRef = useTemplateRef<HTMLElement>("chatScrollRef");
const composerRef = useTemplateRef<{ focus: () => void }>("composerRef");

function scrollToBottom() {
  nextTick(() => {
    if (chatScrollRef.value) {
      chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight;
    }
  });
}

/* ==========================================================================
   组合式装配（数据层）
   ========================================================================== */
const ws = useWorkspaces({
  refreshSessions: () => sessionsApi.fetchSessions(),
  onWorkspaceActivated: () => startNewChat(),
});

const models = useModelProfiles();

let sessionsApi!: SessionsApi;
const chat = useChatStream({
  getActiveSessionId: () => sessionsApi.activeSessionId.value,
  refreshSessions: () => sessionsApi.fetchSessions(),
  scrollToBottom,
});

sessionsApi = useSessions({
  chat,
  isNewChat,
  activeWorkspaceId: ws.activeWorkspaceId,
  getWorkspaceRootPath: () => ws.currentWorkspace.value?.rootPath || "",
  scrollToBottom,
  onActiveDeleted: () => startNewChat(),
});

const { submitApproval } = useApprovals({
  chatTurns: chat.chatTurns,
  sessionTurnsCache: chat.sessionTurnsCache,
});

const {
  workspaces,
  activeWorkspaceId,
  expandedWorkspaces,
  currentWorkspace,
  confirmDeleteWorkspaceId,
  fetchWorkspaces,
  pickAndCreateWorkspace,
  toggleWorkspaceExpand,
  selectWorkspace,
  askDeleteWorkspace,
  ensureActiveWorkspace,
} = ws;

const {
  availableModels,
  activeModel,
  isModelSettingsOpen,
  modelProfiles,
  selectedProfileId,
  isCreatingNewModel,
  showApiKey,
  isTestingConnection,
  testStatus,
  modelForm,
  activeModelObj,
  fetchModelProfiles,
  openModelSettings,
  closeModelSettings,
  selectProfileForEdit,
  createNewProfile,
  onProviderChange,
  saveModelProfile,
  deleteModelProfile,
  testModelConnection,
} = models;

const {
  sessions,
  activeSessionId,
  activeSessions,
  archivedSessions,
  editingSessionId,
  renameDraft,
  confirmDeleteSessionId,
  fetchSessions,
  createSessionForPrompt,
  selectSession,
  startRenameSession,
  saveRenameSession,
  cancelRenameSession,
  toggleArchiveSession,
  askDeleteSession,
} = sessionsApi;

const {
  chatTurns,
  planSteps,
  isPlanVisible,
  isPlanExpanded,
  completedStepsCount,
  currentRunningStep,
  isRunning,
  sessionRunningMap,
  contextUsed,
  contextLimit,
  resetTurns,
  sendPrompt,
  stopExecution,
} = chat;

/* ==========================================================================
   生命周期
   ========================================================================== */
onMounted(async () => {
  await fetchWorkspaces();
  await fetchSessions();
  await fetchModelProfiles();
  // 默认展开所有工作区
  workspaces.value.forEach((w) => expandedWorkspaces.value.add(w.id));

  // 页面刷新后自动检测是否有正在执行中的会话，若有直接进入并重新连入输出流
  const runningSession = sessions.value.find((s) => s.isRunning);
  if (runningSession) {
    await selectSession(runningSession);
  }
});

/* ==========================================================================
   消息操作（TASK-004）
   ========================================================================== */
function onFeedback(kind: "up" | "down" | null, reason?: string) {
  if (kind === null) return;
  vaToaster.add({
    title: kind === "up" ? "感谢认可！" : "已记录反馈",
    description: reason,
    kind: "success",
  });
}

/** 重发：取该助手回复之前最近一条用户输入，原参数重新发起 */
function regenerateTurn(turnId: string) {
  if (isRunning.value) return;
  const idx = chatTurns.value.findIndex((t) => t.id === turnId);
  if (idx < 0) return;
  let prompt = "";
  for (let i = idx - 1; i >= 0; i--) {
    if (chatTurns.value[i].role === "user") {
      prompt = chatTurns.value[i].content;
      break;
    }
  }
  if (!prompt || !activeSessionId.value) return;
  void sendPrompt(prompt, {
    sessionId: activeSessionId.value,
    workspaceId: activeWorkspaceId.value,
    modelProfileId: activeModel.value,
    permission: activePermission.value,
  });
}

/* ==========================================================================
   用户动作编排
   ========================================================================== */
function startNewChat(targetWorkspaceId?: string) {
  if (targetWorkspaceId) {
    activeWorkspaceId.value = targetWorkspaceId;
  }
  activeSessionId.value = "";
  isNewChat.value = true;
  resetTurns();
  composerText.value = "";
  nextTick(() => composerRef.value?.focus());
}

async function handleSend() {
  const prompt = composerText.value.trim();
  if (!prompt || isRunning.value) return;

  // 确保存在可用工作区（无则引导系统选目录/手动创建）
  if (!(await ensureActiveWorkspace())) return;

  // 新会话首条消息：先创建服务端会话记录
  let currentSessionId = activeSessionId.value;
  if (isNewChat.value || !currentSessionId) {
    const newSess = await createSessionForPrompt({
      workspaceId: activeWorkspaceId.value,
      title: prompt.slice(0, 24),
      activeModelProfileId: activeModel.value,
    });
    if (newSess) {
      currentSessionId = newSess.id;
      isNewChat.value = false;
    }
  }

  composerText.value = "";
  await sendPrompt(prompt, {
    sessionId: currentSessionId,
    workspaceId: activeWorkspaceId.value,
    modelProfileId: activeModel.value,
    permission: activePermission.value,
  });
}

function quickFillPrompt(text: string) {
  composerText.value = text;
  handleSend();
}

function handleComposerKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}
</script>

<template>
  <div class="va-console">
    <!-- 左侧边栏：工作区树 / 会话列表 / 归档抽屉 / 设置入口 -->
    <ConsoleSidebar
      :workspaces="workspaces"
      :active-workspace-id="activeWorkspaceId"
      :expanded-workspaces="expandedWorkspaces"
      :active-sessions="activeSessions"
      :archived-sessions="archivedSessions"
      :active-session-id="activeSessionId"
      :is-new-chat="isNewChat"
      :session-running-map="sessionRunningMap"
      :editing-session-id="editingSessionId"
      :rename-draft="renameDraft"
      :confirm-delete-workspace-id="confirmDeleteWorkspaceId"
      :confirm-delete-session-id="confirmDeleteSessionId"
      @start-new-chat="startNewChat"
      @select-session="selectSession"
      @toggle-expand="toggleWorkspaceExpand"
      @pick-workspace="pickAndCreateWorkspace"
      @ask-delete-workspace="askDeleteWorkspace"
      @start-rename="startRenameSession"
      @save-rename="saveRenameSession"
      @cancel-rename="cancelRenameSession"
      @toggle-archive="toggleArchiveSession"
      @ask-delete-session="askDeleteSession"
      @open-model-settings="openModelSettings"
      @update:rename-draft="renameDraft = $event"
    />

    <!-- 中间交互区域 -->
    <main class="va-console__main">
      <!-- 场景 A：新建会话 / 欢迎界面 -->
      <section v-if="isNewChat" class="va-console__welcome-view">
        <div class="va-console__welcome-hero">
          <div class="va-console__hero-badge">
            <Sparkles :size="14" />
            <span>Agent Harness 控制台</span>
          </div>
          <h1 class="va-console__hero-title">准备好开启新任务了吗？</h1>
          <p class="va-console__hero-sub">
            原生驱动自主 ReAct 循环、多工具沙箱执行、文件 Diff 审阅与人机协同 (HITL) 审批
          </p>

          <!-- 当前所属工作区提示 -->
          <div class="va-console__ws-target-tag">
            <Folder :size="14" />
            <span>当前工作区：</span>
            <strong>{{ currentWorkspace?.name || "未绑定" }}</strong>
            <small>({{ currentWorkspace?.rootPath || "请先新建或选择工作区" }})</small>
          </div>

          <!-- 上移至中间偏上的输入框容器 -->
          <div class="va-console__welcome-composer-box">
            <ConsoleComposer
              ref="composerRef"
              v-model="composerText"
              variant="welcome"
              :workspaces="workspaces"
              :active-workspace-id="activeWorkspaceId"
              :available-models="availableModels"
              :active-model="activeModel"
              :permission-modes="permissionModes"
              :active-permission="activePermission"
              :workspace-name="currentWorkspace?.name || '选择工作区'"
              :model-name="activeModelObj.label"
              :is-running="isRunning"
              :context-used="contextUsed"
              :context-limit="contextLimit"
              @send="handleSend"
              @select-workspace="selectWorkspace"
              @pick-workspace="pickAndCreateWorkspace"
              @select-model="(id) => (activeModel = id)"
              @open-model-settings="openModelSettings"
              @select-permission="(id) => (activePermission = id)"
              @composer-keydown="handleComposerKeydown"
            />

            <!-- 快捷提示词 Chip 建议 -->
            <div class="va-console__suggestions">
              <span class="va-console__sug-label">试着运行：</span>
              <button
                class="va-console__chip"
                type="button"
                @click="quickFillPrompt('重构 auth 认证模块，抽取 JWT 校验并编写单元测试')"
              >
                重构认证模块并补全测试
              </button>
              <button
                class="va-console__chip"
                type="button"
                @click="quickFillPrompt('分析项目中所有涉及文件修改的代码，做一次安全合规检查')"
              >
                代码安全与依赖审计
              </button>
              <button
                class="va-console__chip"
                type="button"
                @click="quickFillPrompt('创建端到端自动化测试脚本并生成报告')"
              >
                生成自动化测试用例
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 场景 B：聊天与执行流视图 -->
      <section v-else class="va-console__chat-view">
        <!-- 消息瀑布流 (滚动区域) -->
        <div ref="chatScrollRef" class="va-console__messages-stream">
          <TurnList
            :turns="chatTurns"
            @approve="(actionId) => submitApproval(actionId, true)"
            @deny="(actionId, reason) => submitApproval(actionId, false, reason)"
            @regenerate="regenerateTurn"
            @feedback="onFeedback"
          />
        </div>

        <!-- 输入框上方的任务执行计划 -->
        <DockedPlanBar
          v-if="isPlanVisible"
          :steps="planSteps"
          :completed="completedStepsCount"
          :running="currentRunningStep"
          :expanded="isPlanExpanded"
          @toggle="isPlanExpanded = !isPlanExpanded"
        />

        <!-- 底部固定输入框 -->
        <div class="va-console__bottom-composer">
          <ConsoleComposer
            v-model="composerText"
            variant="docked"
            :workspaces="workspaces"
            :active-workspace-id="activeWorkspaceId"
            :available-models="availableModels"
            :active-model="activeModel"
            :permission-modes="permissionModes"
            :active-permission="activePermission"
            :workspace-name="currentWorkspace?.name || '工作区'"
            :model-name="activeModelObj.label"
            :is-running="isRunning"
            :context-used="contextUsed"
            :context-limit="contextLimit"
            @send="handleSend"
            @stop="stopExecution"
            @select-workspace="selectWorkspace"
            @pick-workspace="pickAndCreateWorkspace"
            @select-model="(id) => (activeModel = id)"
            @open-model-settings="openModelSettings"
            @select-permission="(id) => (activePermission = id)"
            @composer-keydown="handleComposerKeydown"
          />
        </div>
      </section>
    </main>

    <!-- 模型设置模态弹窗 -->
    <ModelSettingsModal
      v-if="isModelSettingsOpen"
      :model-profiles="modelProfiles"
      :selected-profile-id="selectedProfileId"
      :is-creating-new-model="isCreatingNewModel"
      :show-api-key="showApiKey"
      :is-testing-connection="isTestingConnection"
      :test-status="testStatus"
      :model-form="modelForm"
      @close="closeModelSettings"
      @create-new="createNewProfile"
      @select-profile="selectProfileForEdit"
      @provider-change="onProviderChange"
      @save="saveModelProfile"
      @delete-profile="deleteModelProfile(modelForm.id)"
      @test="testModelConnection"
      @update:show-api-key="showApiKey = $event"
    />

    <!-- 全局通知宿主（反馈/系统提示） -->
    <VaToaster />
  </div>
</template>

<style src="./console/styles/console.css"></style>
