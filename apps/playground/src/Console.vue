<script setup lang="ts">
/**
 * Agent Harness 控制台（编排层）
 * 视图层已组件化至 ./console/components/，数据层在 ./console/composables/：
 *   ConsoleSidebar / VaComposer(座位区 slot) / TurnList(AssistantTurn/CardRenderer)
 *   DockedPlanBar / ModelSettingsModal；样式集中于 console/styles/console.css
 * 本文件只保留：组合式装配、欢迎页 hero 文案与用户动作编排。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { Check, ChevronDown, Folder, FolderPlus, History, PanelRight, Settings } from "lucide-vue-next";
import { formatTokens, VaComposer, VaContextWindow, VaEmptyHero, VaToaster, vaToaster } from "@vuagent/ui";
import type { ContextPart } from "@vuagent/ui";
import type { Decision } from "@vuagent/ui";
import ConsoleSidebar from "./console/components/ConsoleSidebar.vue";
import SeatDropdown from "./console/components/SeatDropdown.vue";
import ConsoleRightSidebar from "./console/components/ConsoleRightSidebar.vue";
import DockedPlanBar from "./console/components/DockedPlanBar.vue";
import ModelSettingsModal from "./console/components/ModelSettingsModal.vue";
import TurnList from "./console/components/TurnList.vue";
import { listSuspendedActions, patchSession } from "./console/api/client";
import { useApprovals } from "./console/composables/useApprovals";
import { useChatStream } from "./console/composables/useChatStream";
import { useModelProfiles } from "./console/composables/useModelProfiles";
import { useSessions } from "./console/composables/useSessions";
import type { SessionsApi } from "./console/composables/useSessions";
import { useWorkspaces } from "./console/composables/useWorkspaces";
import { PERMISSION_MODES } from "./console/types";
import type { SessionItem } from "./console/types";

/* ==========================================================================
   纯视图状态
   ========================================================================== */
const isNewChat = ref<boolean>(true);
const isRightSidebarCollapsed = ref<boolean>(false);
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
  activePermission,
  getWorkspaceRootPath: () => ws.currentWorkspace.value?.rootPath || "",
  scrollToBottom,
  onActiveDeleted: () => startNewChat(),
});

// 跨会话待审批收件箱（轮询 /api/action/suspended；决策后即时刷新）
const pendingDecisions = ref<Decision[]>([]);
let pendingPollTimer: ReturnType<typeof setInterval> | undefined;

function decisionDetail(args: Record<string, unknown>): string {
  const keys = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  const text = keys.join(", ");
  return text.length > 120 ? `${text.slice(0, 120)}…` : text || "(无参数)";
}

async function refreshPendingActions() {
  try {
    const list = await listSuspendedActions();
    pendingDecisions.value = (list || []).map((a, idx) => ({
      id: a.actionId,
      title: `${a.toolName} 请求执行`,
      detail: decisionDetail(a.args),
      primary: "批准执行",
      secondary: "驳回",
      collapsed: idx !== 0,
    }));
  } catch (e) {
    console.error("拉取待审批列表失败:", e);
  }
}

async function onDecide(decision: Decision, answer: "primary" | "secondary") {
  await submitApproval(decision.id, answer === "primary");
  vaToaster.add({
    title: answer === "primary" ? "已批准执行" : "已驳回操作",
    description: decision.title,
    kind: answer === "primary" ? "success" : "warning",
  });
  await refreshPendingActions();
}

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
  activateWorkspace,
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
  resetModelToDefault,
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

/** 座位区数据：模型 / 权限（VaComposer seats） */
const composerModels = computed(() =>
  availableModels.value.map((m) => ({ id: m.id, label: m.label, meta: m.meta }))
);
const composerPermissions = computed(() =>
  permissionModes.map((p) => ({ id: p.id, label: p.label, desc: p.desc }))
);

/** 上下文窗口仪表分段：当前总量即真实占用（协议分段估算待后续迭代接入） */
const ctxParts = computed<ContextPart[]>(() => [
  { id: "history", label: "对话历史", tokens: contextUsed.value, kind: "history" },
]);

function onCompactHint() {
  vaToaster.add({ title: "压缩对话功能即将开放", kind: "info" });
}

/** 空态引导的工作区卡片（VaEmptyHero） */
const heroWorkspaces = computed(() =>
  workspaces.value.map((w) => ({ id: w.id, name: w.name, path: w.rootPath }))
);

/** 点击工作区卡 → 激活该工作区并进入新会话（内部触发 startNewChat） */
function onHeroCreateSession(wsId: string) {
  activateWorkspace(wsId);
}

// 会话级聚合轨迹（跨 turn；服务端事件自带轮次编号，台账按「第 N 轮」分组）
const sessionTrajEvents = computed(() => chatTurns.value.flatMap((t) => t.trajEvents || []));

// Context 仪表上限跟随当前选中模型档声明的窗口大小
// （与服务端 usage 事件携带的 contextWindow 同源；usage 事件到达时同样会覆盖）
watch(
  () => activeModelObj.value?.contextWindow,
  (w) => {
    if (w) chat.contextLimit.value = w;
  },
  { immediate: true }
);

/* ==========================================================================
   生命周期
   ========================================================================== */
onMounted(async () => {
  await refreshPendingActions();
  // 跨会话挂起审批轮询（suspended 事件只在对应会话的流里，收件箱需主动拉取）
  pendingPollTimer = setInterval(() => void refreshPendingActions(), 10_000);

  await fetchWorkspaces();
  await fetchSessions();
  await fetchModelProfiles();
  // 默认展开所有工作区
  workspaces.value.forEach((w) => expandedWorkspaces.value.add(w.id));

  // 页面刷新后自动检测是否有正在执行中的会话，若有直接进入并重新连入输出流
  const runningSession = sessions.value.find((s) => s.isRunning);
  if (runningSession) {
    await onSelectSession(runningSession);
  }
});

onUnmounted(() => {
  if (pendingPollTimer !== undefined) clearInterval(pendingPollTimer);
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
  // 新会话回到默认权限模式与默认模型档（各会话的绑定由 session 字段恢复）
  activePermission.value = "review";
  resetModelToDefault();
  resetTurns();
  composerText.value = "";
  nextTick(() => composerRef.value?.focus());
}

/** 选择会话：加载历史后一并恢复会话绑定的权限模式与模型档 */
async function onSelectSession(s: SessionItem) {
  await selectSession(s);
  // 恢复会话绑定的模型档（档位已被删除则保持当前选择）
  const mid = s.activeModelProfileId;
  if (mid && availableModels.value.some((m) => m.id === mid)) {
    activeModel.value = mid;
  }
}

/** 权限模式随会话绑定：更新本地值；会话中则持久化到服务端 */
async function onSelectPermission(id: string) {
  activePermission.value = id;
  const sid = activeSessionId.value;
  if (!sid || isNewChat.value) return;
  try {
    const updated = await patchSession(sid, { permission: id });
    if (updated) {
      const idx = sessions.value.findIndex((s) => s.id === sid);
      if (idx >= 0) sessions.value[idx] = updated;
    }
  } catch (e) {
    console.error("持久化权限模式失败:", e);
  }
}

/** 模型档随会话绑定：更新本地值；会话中则持久化到服务端 */
async function onSelectModel(id: string) {
  activeModel.value = id;
  const sid = activeSessionId.value;
  if (!sid || isNewChat.value) return;
  try {
    const updated = await patchSession(sid, { activeModelProfileId: id });
    if (updated) {
      const idx = sessions.value.findIndex((s) => s.id === sid);
      if (idx >= 0) sessions.value[idx] = updated;
    }
  } catch (e) {
    console.error("持久化模型档失败:", e);
  }
}

async function handleSend(promptOverride?: string) {
  const prompt = (promptOverride ?? composerText.value).trim();
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
      permission: activePermission.value,
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
      @select-session="onSelectSession"
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
      <!-- 场景 A：新建会话 / 欢迎界面（VaEmptyHero 空态引导） -->
      <section v-if="isNewChat" class="va-console__welcome-view">
        <div class="va-console__welcome-hero">
          <VaEmptyHero
            :workspaces="heroWorkspaces"
            title="准备好开启新任务了吗？"
            description="原生驱动自主 ReAct 循环、多工具沙箱执行、文件 Diff 审阅与人机协同 (HITL) 审批"
            @create-session="onHeroCreateSession"
            @create-workspace="pickAndCreateWorkspace"
          />

          <!-- 上移至中间偏上的输入框容器 -->
          <div class="va-console__welcome-composer-box">
            <VaComposer
              ref="composerRef"
              v-model:text="composerText"
              placeholder="给 Agent 一个任务（如：重构认证模块并编写单元测试）…"
              :disabled="isRunning"
              :max-height="180"
              :models="composerModels"
              :model="activeModel"
              :permissions="composerPermissions"
              :permission="activePermission"
              @send="(t) => handleSend(t)"
              @update:model="onSelectModel"
              @update:permission="onSelectPermission"
            >
              <template #actions>
                <!-- 工作区切换（仅新建会话时可选） -->
                <SeatDropdown>
                  <template #trigger>
                    <Folder :size="12" />
                    <span class="va-console__seat-text">{{ currentWorkspace?.name || "选择工作区" }}</span>
                    <ChevronDown :size="11" />
                  </template>
                  <div class="va-console__menu-header">切换工作区</div>
                  <button
                    v-for="w in workspaces"
                    :key="w.id"
                    class="va-console__menu-item"
                    :class="{ 'va-console__menu-item--active': w.id === activeWorkspaceId }"
                    type="button"
                    @click="selectWorkspace(w.id)"
                  >
                    <Folder :size="13" />
                    <span class="va-console__menu-item-name">{{ w.name }}</span>
                    <Check v-if="w.id === activeWorkspaceId" :size="13" />
                  </button>
                  <div class="va-console__menu-divider" />
                  <button
                    class="va-console__menu-item va-console__menu-item--action"
                    type="button"
                    @click="pickAndCreateWorkspace"
                  >
                    <FolderPlus :size="14" />
                    <span>新建工作区 (系统弹窗)…</span>
                  </button>
                </SeatDropdown>

                <!-- 上下文窗口仪表（VaContextWindow，点击展开分段面板） -->
                <SeatDropdown>
                  <template #trigger>
                    <History :size="12" />
                    <span class="va-console__seat-text">Context: {{ formatTokens(contextUsed) }} / {{ formatTokens(contextLimit) }}</span>
                    <ChevronDown :size="11" />
                  </template>
                  <div class="va-console__ctx-panel">
                    <VaContextWindow
                      :parts="ctxParts"
                      :capacity="contextLimit"
                      :removable="false"
                      @compact="onCompactHint"
                    />
                  </div>
                </SeatDropdown>
                <button
                  class="va-console__icon-btn-xs va-console__model-settings-btn"
                  type="button"
                  title="管理与配置模型…"
                  @click="openModelSettings"
                >
                  <Settings :size="13" />
                </button>
              </template>
            </VaComposer>

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

      <!-- 场景 B：聊天与执行流视图（聊天区 + 右侧栏） -->
      <div v-else class="va-console__chat-layout">
      <section class="va-console__chat-view">
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
          <VaComposer
            ref="composerRef"
            v-model:text="composerText"
            placeholder="继续指令或追问…"
            :busy="isRunning"
            :models="composerModels"
            :model="activeModel"
            :permissions="composerPermissions"
            :permission="activePermission"
            @send="(t) => handleSend(t)"
            @stop="stopExecution"
            @update:model="onSelectModel"
            @update:permission="onSelectPermission"
          >
            <template #actions>
              <!-- 工作区只读徽标：会话已绑定，切换请新建会话 -->
              <span
                class="va-console__seat-badge"
                title="会话已绑定该工作区；如需切换工作区请新建会话"
              >
                <Folder :size="12" />
                <span>{{ currentWorkspace?.name || "工作区" }}</span>
              </span>

              <!-- 上下文窗口仪表（VaContextWindow，点击展开分段面板） -->
              <SeatDropdown>
                <template #trigger>
                  <History :size="12" />
                  <span class="va-console__seat-text">Context: {{ formatTokens(contextUsed) }} / {{ formatTokens(contextLimit) }}</span>
                  <ChevronDown :size="11" />
                </template>
                <div class="va-console__ctx-panel">
                  <VaContextWindow
                    :parts="ctxParts"
                    :capacity="contextLimit"
                    :removable="false"
                    @compact="onCompactHint"
                  />
                </div>
              </SeatDropdown>
            <button
              class="va-console__icon-btn-xs va-console__model-settings-btn"
              type="button"
              title="管理与配置模型…"
              @click="openModelSettings"
            >
              <Settings :size="13" />
            </button>
            </template>
          </VaComposer>
        </div>
      </section>

      <!-- 右侧栏：tab 容器（轨迹 / …） -->
      <ConsoleRightSidebar
        v-if="!isRightSidebarCollapsed"
        :traj-events="sessionTrajEvents"
        :decisions="pendingDecisions"
        @decide="onDecide"
        @collapse="isRightSidebarCollapsed = true"
      />
      <button
        v-else
        class="va-console__rsb-reopen"
        type="button"
        title="展开侧栏"
        @click="isRightSidebarCollapsed = false"
      >
        <PanelRight :size="15" />
      </button>
      </div>
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
