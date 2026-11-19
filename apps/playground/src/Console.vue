<script setup lang="ts">
/**
 * Agent Harness 控制台（编排层）
 * 视图层已组件化至 ./console/components/，数据层在 ./console/composables/：
 *   ConsoleSidebar / VaComposer(座位区 slot) / TurnList(AssistantTurn/CardRenderer)
 *   DockedPlanBar / settings/SettingsModal(+ModelProfilesPanel/InteractionPanel)；
 *   消息区顶部「对话/轨迹」tab（轨迹宽幅视图）；右侧栏仅保留审批收件箱；
 *   样式集中于 console/styles/console.css
 * 本文件只保留：组合式装配、欢迎页 hero 文案与用户动作编排。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from "vue";
import { ArrowDown, ChevronDown, History, PanelRight, Route } from "lucide-vue-next";
import { formatTokens, useStickToBottom, VaComposer, VaConfirmHost, VaContextWindow, VaEmptyHero, VaPopover, VaSegmentedControl, VaToaster, VaTooltip, VaTrajectory, vaToaster } from "@vuagent/ui";
import type { ContextPart } from "@vuagent/ui";
import type { Decision } from "@vuagent/ui";
import ConsoleSidebar from "./console/components/ConsoleSidebar.vue";
import ConsoleRightSidebar from "./console/components/ConsoleRightSidebar.vue";
import DockedPlanBar from "./console/components/DockedPlanBar.vue";
import TextPromptHost from "./console/components/TextPromptHost.vue";
import SettingsModal from "./console/components/settings/SettingsModal.vue";
import ModelProfilesPanel from "./console/components/settings/ModelProfilesPanel.vue";
import InteractionPanel from "./console/components/settings/InteractionPanel.vue";
import ToolsPanel from "./console/components/settings/ToolsPanel.vue";
import ConfigPanel from "./console/components/settings/ConfigPanel.vue";
import type { SettingsTab } from "./console/components/settings/types";
import TurnList from "./console/components/TurnList.vue";
import {
  listSuspendedActions,
  compactSession,
  patchSession,
} from "./console/api/client";
import { useApprovals } from "./console/composables/useApprovals";
import { useConsoleToolsConfig } from "./console/composables/useConsoleToolsConfig";
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
/** 主区视图 tab（用户反馈）：轨迹从右侧栏迁入消息区宽幅展示，对话为默认视图 */
const mainViewTab = ref<"chat" | "traj">("chat");
const isRightSidebarCollapsed = ref<boolean>(false);
const composerText = ref<string>("");
/**
 * 新建会话的缺省权限模式（TASK-026）：初值与「新对话」重置取自配置中心
 * security.defaultPermissionMode（服务端默认 review）；拉取失败回落 review。
 */
const defaultPermission = ref<string>("review");
const activePermission = ref<string>(defaultPermission.value);
const permissionModes = PERMISSION_MODES;

// 工具清单与配置中心数据域（TASK-043 收敛：security.defaultPermissionMode 同步进权限档）
const {
  tools,
  toolsLoading,
  toolsError,
  fetchTools,
  onToggleTool,
  configLoading,
  configError,
  configNs,
  fetchConfig,
  onConfigPatch,
  onConfigReset,
} = useConsoleToolsConfig({ defaultPermission, activePermission, isNewChat });


const chatScrollRef = useTemplateRef<HTMLElement>("chatScrollRef");
const composerRef = useTemplateRef<{ focus: () => void }>("composerRef");

/**
 * 贴底跟随：流式输出仅在用户位于底部时自动跟随；用户上翻后立即解除，
 * 不再每个 SSE 数据块强制 scrollTop = scrollHeight（此前与用户滚轮互相打架导致卡顿）。
 * 发送消息 / 切换会话等显式动作用 { force: true } 强制回底。
 */
const { isPinned: isChatPinned, onScroll: onChatScroll, scrollToBottom } = useStickToBottom(chatScrollRef);

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
  activateWorkspace,
  fetchWorkspaces,
  pickAndCreateWorkspace,
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
  apiKeyPlaceholder,
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

/** 统一设置弹窗当前 tab（TASK-017）：默认打开「模型与 API」，保持原模型配置入口行为 */
const settingsTab = ref<SettingsTab>("models");

/** 打开设置弹窗：可指定落点 tab（缺省「模型与 API」），open/close 状态仍由 useModelProfiles 持有 */
function openSettings(tab: SettingsTab = "models") {
  settingsTab.value = tab;
  openModelSettings();
}

const {
  sessions,
  activeSessionId,
  fetchSessions,
  createSessionForPrompt,
  selectSession,
  renameSession,
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
  ctxParts: streamCtxParts,
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

/** 上下文窗口仪表分段：优先消费 usage 事件的协议级分段(system/tools/history)；
 *  无分段（旧服务端/沙箱演示流/新会话未运行）时降级为单段「对话历史」 */
const ctxParts = computed<ContextPart[]>(() =>
  streamCtxParts.value.length > 0
    ? streamCtxParts.value
    : [{ id: "history", label: "对话历史", tokens: contextUsed.value, kind: "history" }]
);

/** 压缩中：历史格子微光收缩（VaContextWindow 内置动画），按钮进入禁用态 */
const isCompacting = ref(false);

/** TASK-008 手动压缩：调服务端压缩接口 → 消费返回的新占用(totalTokens/parts)刷新仪表 → toast 释放量 */
async function onCompactSession() {
  if (isCompacting.value) return;
  const sid = activeSessionId.value;
  if (!sid || isNewChat.value) {
    vaToaster.add({ title: "新会话暂无历史可压缩", kind: "info" });
    return;
  }
  if (isRunning.value) {
    vaToaster.add({ title: "会话执行中，请等待本轮结束后再压缩", kind: "warning" });
    return;
  }
  isCompacting.value = true;
  try {
    const result = await compactSession(sid);
    if (!result.compacted) {
      vaToaster.add({
        title: "历史较少，暂无需压缩",
        description: `当前占用 ${formatTokens(result.totalTokens)} tokens`,
        kind: "info",
      });
      return;
    }
    // 压缩完成：直接消费服务端返回的新占用，仪表断崖回落（格子宽度过渡动画自动生效）
    contextUsed.value = result.totalTokens;
    streamCtxParts.value = result.parts?.length
      ? result.parts
      : [{ id: "history", label: "对话历史", tokens: result.totalTokens, kind: "history" }];
    vaToaster.add({
      title: `已压缩，释放 ${formatTokens(result.freed)} tokens`,
      description: `${result.compactedTurnCount} 轮早期历史已折叠为摘要`,
      kind: "success",
    });
  } catch (e) {
    vaToaster.add({
      title: "压缩失败",
      description: e instanceof Error ? e.message : String(e),
      kind: "danger",
    });
  } finally {
    isCompacting.value = false;
  }
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

  // 配置中心（TASK-028 面板数据；TASK-026 新建会话缺省权限模式，失败保持 review 兜底）
  await fetchConfig();

  await fetchWorkspaces();
  await fetchSessions();
  await fetchModelProfiles();
  void fetchTools();

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
  mainViewTab.value = "chat";
  // 新会话回到默认权限模式（配置中心 security.defaultPermissionMode）与默认模型档
  //（各会话的绑定由 session 字段恢复）
  activePermission.value = defaultPermission.value;
  resetModelToDefault();
  resetTurns();
  composerText.value = "";
  nextTick(() => composerRef.value?.focus());
}

/** 选择会话：加载历史后一并恢复会话绑定的权限模式与模型档 */
async function onSelectSession(s: SessionItem) {
  mainViewTab.value = "chat";
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
  // 发送任务：若正停留在轨迹 tab，自动切回对话视图跟随输出
  mainViewTab.value = "chat";
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
    <!-- 左侧边栏（TASK-045 dogfooding）：VaSessionTree 承载树交互，footer 挂设置入口 -->
    <ConsoleSidebar
      :workspaces="workspaces"
      :sessions="sessions"
      :active-workspace-id="activeWorkspaceId"
      :active-session-id="activeSessionId"
      :is-new-chat="isNewChat"
      :session-running-map="sessionRunningMap"
      @start-new-chat="startNewChat"
      @select-session="onSelectSession"
      @pick-workspace="pickAndCreateWorkspace"
      @delete-workspace="askDeleteWorkspace"
      @rename-session="renameSession"
      @toggle-archive="toggleArchiveSession"
      @delete-session="askDeleteSession"
      @open-settings="openSettings"
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
                <!-- 上下文窗口仪表（VaContextWindow，点击展开分段面板；VaPopover 托管定位/外部点击/Esc） -->
                <VaPopover placement="top-start" :offset="8">
                  <template #trigger>
                    <button class="va-console__seat-btn" type="button">
                      <History :size="12" />
                      <span class="va-console__seat-text">Context: {{ formatTokens(contextUsed) }} / {{ formatTokens(contextLimit) }}</span>
                      <ChevronDown :size="11" />
                    </button>
                  </template>
                  <div class="va-console__ctx-panel">
                    <VaContextWindow
                      :parts="ctxParts"
                      :capacity="contextLimit"
                      :removable="false"
                      :compacting="isCompacting"
                      @compact="onCompactSession"
                    />
                  </div>
                </VaPopover>
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
        <!-- 主区视图 tab：对话 / 轨迹（TASK-046 dogfooding：VaSegmentedControl 承载切换） -->
        <VaSegmentedControl
          v-model="mainViewTab"
          :options="[{ value: 'chat', label: '对话' }, { value: 'traj', label: '轨迹' }]"
          aria-label="主区视图"
        />

        <!-- 对话视图：消息瀑布流（滚动区域；wrap 提供「回到底部」按钮的定位锚点） -->
        <div v-show="mainViewTab === 'chat'" class="va-console__stream-wrap">
          <div
            ref="chatScrollRef"
            class="va-console__messages-stream"
            @scroll.passive="onChatScroll"
          >
            <TurnList
              :turns="chatTurns"
              @approve="(actionId) => submitApproval(actionId, true)"
              @deny="(actionId, reason) => submitApproval(actionId, false, reason)"
              @regenerate="regenerateTurn"
              @feedback="onFeedback"
            />
          </div>

          <!-- 上翻解除钉底后出现；点击强制回底并恢复流式跟随 -->
          <button
            v-if="!isChatPinned"
            class="va-console__scroll-bottom"
            type="button"
            @click="scrollToBottom({ force: true })"
          >
            <ArrowDown :size="13" />
            <span>回到底部</span>
          </button>
        </div>

        <!-- 轨迹视图：三泳道台账 + 时间线（宽幅去卡片化 + 主从详情） -->
        <div v-show="mainViewTab === 'traj'" class="va-console__traj-view">
          <VaTrajectory
            v-if="sessionTrajEvents.length > 0"
            :events="sessionTrajEvents"
            :ledger-max-height="undefined"
            :bordered="false"
            split-detail
          />
          <div v-else class="va-console__traj-empty">
            <Route :size="20" />
            <p>本轮会话还没有轨迹</p>
            <small>发送任务后，执行步骤将实时显示在这里</small>
          </div>
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
              <!-- 上下文窗口仪表（VaContextWindow，点击展开分段面板；VaPopover 托管定位/外部点击/Esc） -->
              <VaPopover placement="top-start" :offset="8">
                <template #trigger>
                  <button class="va-console__seat-btn" type="button">
                    <History :size="12" />
                    <span class="va-console__seat-text">Context: {{ formatTokens(contextUsed) }} / {{ formatTokens(contextLimit) }}</span>
                    <ChevronDown :size="11" />
                  </button>
                </template>
                <div class="va-console__ctx-panel">
                  <VaContextWindow
                    :parts="ctxParts"
                    :capacity="contextLimit"
                    :removable="false"
                    :compacting="isCompacting"
                    @compact="onCompactSession"
                  />
                </div>
              </VaPopover>
            </template>
          </VaComposer>
        </div>
      </section>

      <!-- 右侧栏：跨会话 HITL 待审批收件箱（轨迹已迁入主区 tab） -->
      <ConsoleRightSidebar
        v-if="!isRightSidebarCollapsed"
        :decisions="pendingDecisions"
        :workspace-id="activeWorkspaceId"
        @decide="onDecide"
        @collapse="isRightSidebarCollapsed = true"
      />
      <VaTooltip v-else content="展开侧栏" placement="left">
        <button
          class="va-console__rsb-reopen"
          type="button"
          aria-label="展开侧栏"
          @click="isRightSidebarCollapsed = false"
        >
          <PanelRight :size="15" />
        </button>
      </VaTooltip>
      </div>
    </main>

    <!-- 统一设置弹窗（TASK-017/039）：VaDialog 外壳 + 左导航，面板按 tab 插槽分发；open 受控 -->
    <SettingsModal
      :open="isModelSettingsOpen"
      v-model:active-tab="settingsTab"
      @close="closeModelSettings"
    >
      <template #models>
        <ModelProfilesPanel
          :model-profiles="modelProfiles"
          :selected-profile-id="selectedProfileId"
          :is-creating-new-model="isCreatingNewModel"
          :show-api-key="showApiKey"
          :is-testing-connection="isTestingConnection"
          :test-status="testStatus"
          :model-form="modelForm"
          :api-key-placeholder="apiKeyPlaceholder"
          @close="closeModelSettings"
          @create-new="createNewProfile"
          @select-profile="selectProfileForEdit"
          @provider-change="onProviderChange"
          @save="saveModelProfile"
          @delete-profile="deleteModelProfile(modelForm.id)"
          @test="testModelConnection"
          @update:show-api-key="showApiKey = $event"
        />
      </template>
      <template #interaction>
        <InteractionPanel />
      </template>
      <template #tools>
        <ToolsPanel
          :tools="tools"
          :loading="toolsLoading"
          :load-error="toolsError"
          @toggle="onToggleTool"
        />
      </template>
      <template #execution>
        <ConfigPanel
          :namespace="configNs('execution')"
          :loading="configLoading"
          :load-error="configError"
          @patch="(key, value) => onConfigPatch('execution', key, value)"
          @reset="onConfigReset('execution')"
        />
      </template>
      <template #security>
        <ConfigPanel
          :namespace="configNs('security')"
          :loading="configLoading"
          :load-error="configError"
          @patch="(key, value) => onConfigPatch('security', key, value)"
          @reset="onConfigReset('security')"
        />
      </template>
      <template #prompt>
        <ConfigPanel
          :namespace="configNs('prompt')"
          :loading="configLoading"
          :load-error="configError"
          @patch="(key, value) => onConfigPatch('prompt', key, value)"
          @reset="onConfigReset('prompt')"
        />
      </template>
    </SettingsModal>

    <!-- 全局通知宿主（反馈/系统提示） -->
    <VaToaster />
    <!-- vaConfirm 渲染宿主：删除工作区/会话等危险操作的模态确认（alertdialog） -->
    <VaConfirmHost />
    <!-- askText 渲染宿主：系统选目录不可用时的手动路径输入（替代原生 prompt） -->
    <TextPromptHost />
  </div>
</template>

<style src="./console/styles/console.css"></style>
