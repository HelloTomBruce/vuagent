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
import { ArrowDown, Bell, ChevronDown, History, PanelRight, Route } from "lucide-vue-next";
import { formatTokens, useStickToBottom, VaCommandMenu, VaCompactBreakdown, VaComposer, VaConfirmHost, VaContextWindow, VaEmptyHero, VaNotificationStack, VaPopover, VaQueueDock, VaSegmentedControl, VaSkeleton, VaThinkingLoader, VaToaster, VaTooltip, VaTrajectory, vaToaster } from "@vuagent/ui";
import type { CommandItem, NotificationItem, QueueItem, ComposerAttachment } from "@vuagent/ui";
import type { ContextPart } from "@vuagent/ui";
import type { Decision } from "@vuagent/ui";
import ConsoleSidebar from "./console/components/ConsoleSidebar.vue";
import ComposerMenu from "./console/components/ComposerMenu.vue";
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
  fetchWorkspaceFiles,
} from "./console/api/client";
import { useApprovals } from "./console/composables/useApprovals";
import { useConsoleToolsConfig } from "./console/composables/useConsoleToolsConfig";
import { useChatStream } from "./console/composables/useChatStream";
import { useModelProfiles } from "./console/composables/useModelProfiles";
import { useSessions } from "./console/composables/useSessions";
import type { SessionsApi } from "./console/composables/useSessions";
import { useWorkspaces } from "./console/composables/useWorkspaces";
import { useTheme, type ThemePreference } from "./console/composables/useTheme";
import { useUsage } from "./console/composables/useUsage";
import { PERMISSION_MODES } from "./console/types";
import type { SessionItem } from "./console/types";

/* ==========================================================================
   纯视图状态
   ========================================================================== */
const isNewChat = ref<boolean>(true);
/** 主区视图 tab（用户反馈）：轨迹从右侧栏迁入消息区宽幅展示，对话为默认视图 */
const mainViewTab = ref<"chat" | "traj">("chat");
// 右侧栏默认收起（用户反馈：切换会话不默认打开）；待审批数在折叠按钮上以徽标提示
const isRightSidebarCollapsed = ref<boolean>(true);
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
  providers,
  selectedProviderId,
  isCreatingProvider,
  currentProvider,
  currentProviderModels,
  providerForm,
  modelDraft,
  isCreatingModel,
  showApiKey,
  isTestingConnection,
  isDiscovering,
  testStatus,
  discoveredModels,
  discoveredItems,
  activeModelObj,
  supportsImageInput,
  fetchModelProfiles,
  resetModelToDefault,
  openModelSettings,
  closeModelSettings,
  selectProvider,
  startCreateProvider,
  onProviderKindChange,
  saveProvider,
  deleteProvider,
  startCreateModel,
  editModel,
  cancelModelEdit,
  saveModel,
  deleteModel,
  discoverModels,
  applyDetected,
  testModelConnection,
  toggleModality,
  toggleReasoning,
  toggleToolUse,
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
  sessionsLoading,
  activeSessionId,
  fetchSessions,
  createSessionForPrompt,
  selectSession,
  renameSession,
  toggleArchiveSession,
  togglePinSession,
  askDeleteSession,
} = sessionsApi;

// 成本用量数据域（TASK-075）：右栏用量 tab 与消息区迷你占比条共享单实例
const usage = useUsage();

/* ==========================================================================
   全局命令面板与通知堆叠（TASK-076 F3）
   ========================================================================== */
const theme = useTheme();
const cmdOpen = ref(false);

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    cmdOpen.value = !cmdOpen.value;
  }
}

const commands = computed<CommandItem[]>(() => {
  const list: CommandItem[] = [];
  list.push({ id: "new-chat", label: "新建会话", group: "会话" });
  for (const sess of sessions.value.filter((x) => !x.archived && x.status !== "archived").slice(0, 8)) {
    list.push({ id: `session:${sess.id}`, label: `打开会话：${sess.title}`, group: "会话", keywords: sess.title });
  }
  for (const w of workspaces.value) {
    list.push({ id: `ws:${w.id}`, label: `切换工作区：${w.name}`, group: "工作区", keywords: w.name });
  }
  for (const p of permissionModes) {
    list.push({ id: `perm:${p.id}`, label: `权限档：${p.label}`, group: "权限", keywords: p.id });
  }
  const themes: Array<[ThemePreference, string]> = [["light", "亮色"], ["dark", "暗色"], ["system", "跟随系统"]];
  for (const [v, label] of themes) {
    list.push({ id: `theme:${v}`, label: `主题：${label}`, group: "外观" });
  }
  list.push({ id: "open-settings", label: "打开设置", group: "操作" });
  list.push({ id: "usage-panel", label: "展开右侧用量面板", group: "操作" });
  list.push({ id: "compact", label: "压缩当前会话上下文", group: "操作", disabled: isNewChat.value || isRunning.value });
  list.push({ id: "stop", label: "中止当前运行", group: "操作", danger: true, disabled: !isRunning.value });
  return list;
});

function onCommandSelect(item: CommandItem) {
  const id = item.id;
  if (id === "new-chat") {
    startNewChat();
  } else if (id.startsWith("session:")) {
    const sess = sessions.value.find((x) => x.id === id.slice(8));
    if (sess) selectSession(sess);
  } else if (id.startsWith("ws:")) {
    startNewChat(id.slice(3));
  } else if (id.startsWith("perm:")) {
    void onSelectPermission(id.slice(5));
  } else if (id.startsWith("theme:")) {
    theme.setPreference(id.slice(6) as ThemePreference);
  } else if (id === "open-settings") {
    isModelSettingsOpen.value = true;
  } else if (id === "usage-panel") {
    isRightSidebarCollapsed.value = false;
  } else if (id === "compact") {
    void onCompactSession();
  } else if (id === "stop") {
    stopExecution();
  }
  cmdOpen.value = false;
}

/** 通知堆叠：需关注事件（审批到达 / 后台任务结束）为主，toast 留给即时反馈 */
const notifications = ref<NotificationItem[]>([]);
const notifOpen = ref(false);
const unreadCount = computed(() => notifications.value.filter((n) => n.unread).length);

function pushNotification(item: NotificationItem) {
  notifications.value.unshift(item);
  if (notifications.value.length > 20) notifications.value.length = 20;
}

/** 新审批到达：右上角自动弹出通知（可点击跳转右栏审批） */
const seenApprovalIds = new Set<string>();
watch(
  pendingDecisions,
  (list) => {
    for (const d of list) {
      const aid = String(d.id);
      if (!aid || seenApprovalIds.has(aid)) continue;
      seenApprovalIds.add(aid);
      pushNotification({
        id: `approval-${aid}`,
        title: "待审批决策",
        body: d.detail || d.title || "有操作等待你的批准",
        kind: "warning",
        createdAt: Date.now(),
        unread: true,
      });
      notifOpen.value = true;
    }
  },
  { deep: true }
);

/** 后台会话运行结束（含用户未注视的会话）：成功态通知，点击跳转会话 */
const prevRunningMap = new Map<string, boolean>();
watch(
  () => [...chat.sessionRunningMap.entries()],
  (entries) => {
    for (const [sid, running] of entries) {
      const prev = prevRunningMap.get(sid);
      prevRunningMap.set(sid, running);
      if (prev === true && running === false && sid !== activeSessionId.value) {
        const sess = sessions.value.find((x) => x.id === sid);
        pushNotification({
          id: `done-${sid}`,
          title: "任务已结束",
          body: `会话「${sess?.title ?? sid}」运行完成，点击查看`,
          kind: "success",
          createdAt: Date.now(),
          unread: true,
        });
      }
    }
  }
);

function onNotificationOpen(item: NotificationItem) {
  item.unread = false;
  if (item.id.startsWith("approval-")) {
    isRightSidebarCollapsed.value = false;
  } else if (item.id.startsWith("done-")) {
    const sess = sessions.value.find((x) => x.id === item.id.slice(5));
    if (sess) selectSession(sess);
  }
}
function onNotifRead(id: string) {
  const n = notifications.value.find((x) => x.id === id);
  if (n) n.unread = false;
}
function onNotifAllRead() {
  for (const n of notifications.value) n.unread = false;
}

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
  sessionTokensUsed,
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

/** 成本迷你占比段（TASK-075）：按模型 token 份额降序取前 4，其余不展示（面板内看全量） */
const usageCompactSegments = computed(() =>
  usage.byModelTokens.value.filter((seg) => seg.value > 0).slice(0, 4)
);

/** 流式间隙：已发车（running + assistant turn streaming）但首段内容/卡片未到 */
const awaitingFirstContent = computed(() => {
  if (!isRunning.value) return false;
  const last = chatTurns.value[chatTurns.value.length - 1];
  return (
    !!last &&
    last.role === "assistant" &&
    last.isStreaming === true &&
    !last.content &&
    !(last.cards && last.cards.length > 0)
  );
});

/* ---------- 运行中入队（TASK-076 F2：VaQueueDock；composer busy 不拦截 send，宿主自排队） ---------- */
const messageQueue = ref<QueueItem[]>([]);

function enqueueMessage(text: string) {
  messageQueue.value.push({ id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text });
  vaToaster.add({ title: "已加入队列", description: "当前会话运行中，结束后自动发送", kind: "info" });
}

function onQueueRemove(index: number) {
  messageQueue.value.splice(index, 1);
}

/** 插队：移动到队首；会话空闲则立即下发 */
function onQueueSendNow(index: number) {
  const [item] = messageQueue.value.splice(index, 1);
  if (!item) return;
  if (!isRunning.value) {
    void handleSend(item.text);
    return;
  }
  messageQueue.value.unshift(item);
}

function onQueueEdit(index: number, text: string) {
  if (messageQueue.value[index]) messageQueue.value[index].text = text;
}

/** 运行结束沿：按队列顺序自动下发（每轮 handleSend 内部仍受 isRunning 保护） */
watch(isRunning, (running, prev) => {
  if (prev === true && running === false && messageQueue.value.length > 0 && !isNewChat.value) {
    const next = messageQueue.value.shift();
    if (next) setTimeout(() => void handleSend(next.text), 400);
  }
});

/* ---------- @提及 文件引用（TASK-076 重构：弹窗 → 输入框上方浮层，不打断输入） ----------
 * 交互契约：输入框文本末尾匹配 /(?:^|\s)@([^\s@]*)$/ 时打开浮层，继续输入即过滤；
 * ↑↓ 导航、Enter/Tab 选中、Esc 关闭（window capture 拦截，先于 composer 的 Enter=发送）；
 * 选中后以 @<path> 内联令牌插入，发送时在 handleSend 展开为 [@引用文件] 块
 */
const mentionOpen = ref(false);
const mentionQuery = ref("");
const mentionFiles = ref<string[]>([]);
const mentionFilesLoading = ref(false);
const mentionActiveIdx = ref(0);
/** 已插入的引用路径集合（发送时展开；按文本中是否仍存在自清洁） */
const referencedFiles = new Set<string>();
let mentionFetchedForWs = "";

const mentionOptions = computed(() => {
  const q = mentionQuery.value.toLowerCase();
  const list = q ? mentionFiles.value.filter((f) => f.toLowerCase().includes(q)) : mentionFiles.value;
  return list.slice(0, 50);
});

/** 可见 composer 元素作为外部锚点（hero / chat 两场景同一时刻仅一个可见） */
/** 提及浮层锚点：打开时测量可见 composer（两场景共享一个浮层实例） */
const mentionAnchor = computed<HTMLElement | null>(() =>
  mentionOpen.value ? findVisibleComposerEl() : null
);

function findVisibleComposerEl(): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(".va-console__main .va-cmp"))) {
    if (el.offsetParent !== null) return el;
  }
  return null;
}

async function loadMentionFiles(wsId: string) {
  if (!wsId || mentionFetchedForWs === wsId) return;
  mentionFilesLoading.value = true;
  try {
    const data = await fetchWorkspaceFiles(wsId);
    const out: string[] = [];
    const walk = (nodes: Array<{ path: string; type?: string; children?: unknown[] }>): void => {
      for (const n of nodes ?? []) {
        if (n.type === "dir" && Array.isArray(n.children)) walk(n.children as never);
        else out.push(n.path);
      }
    };
    walk((data?.tree ?? []) as never);
    mentionFiles.value = out;
    mentionFetchedForWs = wsId;
  } finally {
    mentionFilesLoading.value = false;
  }
}

watch(composerText, (text) => {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  if (m && activeWorkspaceId.value) {
    mentionQuery.value = m[1] ?? "";
    if (!mentionOpen.value) {
      mentionOpen.value = true;
      mentionActiveIdx.value = 0;
      void loadMentionFiles(activeWorkspaceId.value);
    }
  } else if (mentionOpen.value) {
    mentionOpen.value = false;
  }
});

function onMentionPick(path: string) {
  // 以 @<path> 内联令牌替换末尾 @query，并补尾随空格
  composerText.value = composerText.value.replace(/(?:^|\s)@([^\s@]*)$/, (full) =>
    full.startsWith("@") ? `@${path} ` : ` @${path} `,
  );
  referencedFiles.add(path);
  mentionOpen.value = false;
  composerRef.value?.focus();
}

/** 三点菜单「引用工作区文件…」直达浮层：清空尾随并插入 @ 触发，聚焦输入 */
function openMentionPanel() {
  const t = composerText.value;
  if (!/@([^\s@]*)$/.test(t)) {
    composerText.value = t && !t.endsWith(" ") && !t.endsWith("\n") ? `${t} @` : `${t}@`;
  } else {
    mentionQuery.value = "";
    mentionOpen.value = true;
  }
  void loadMentionFiles(activeWorkspaceId.value);
  void nextTick(() => composerRef.value?.focus());
}

/** 浮层打开期间的键盘拦截（capture 先于 composer 自身的 Enter=发送） */
function onMentionKeydown(e: KeyboardEvent) {
  if (!mentionOpen.value) return;
  const n = mentionOptions.value.length;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    e.stopImmediatePropagation();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    mentionActiveIdx.value = n > 0 ? (mentionActiveIdx.value + dir + n) % n : 0;
  } else if (e.key === "Enter" || e.key === "Tab") {
    const path = mentionOptions.value[mentionActiveIdx.value];
    if (path) {
      e.preventDefault();
      e.stopImmediatePropagation();
      onMentionPick(path);
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    mentionOpen.value = false;
  }
}

/* ---------- 附件（TASK-076 F2：composer 内建 attachable；文本客户端读取内联，不绕审批链） ---------- */
const attachments = ref<ComposerAttachment[]>([]);
/** 附件文本缓存（filesSelected 时即读；发送时内联进 prompt） */
const attachmentTexts = new Map<string, string>();
const ATTACH_INLINE_CAP = 48 * 1024;

function onFilesSelected(files: File[]) {
  for (const f of files.slice(0, 6)) {
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isImage = f.type.startsWith("image/");

    // 能力联动（P0）：模型未声明支持图片时拒绝图片附件并说明原因，
    // 而不是静默丢弃或等 provider 返回 400。
    if (isImage && !supportsImageInput.value) {
      vaToaster.add({
        title: `当前模型未声明支持图片输入`,
        description: "在「模型设置 → 能力标记」中勾选图片后即可上传",
        kind: "warning",
      });
      continue;
    }

    attachments.value.push({
      id,
      name: f.name,
      size: f.size,
      kind: isImage ? "image" : "file",
      previewUrl: isImage ? URL.createObjectURL(f) : undefined,
    });
    if (isImage) continue; // 图片仅登记名（视觉通道由模型能力决定，不假装内联）
    const reader = new FileReader();
    reader.onload = () => {
      let content = String(reader.result ?? "");
      if (content.length > ATTACH_INLINE_CAP) {
        content = `${content.slice(0, ATTACH_INLINE_CAP)}\n…（超出 48KB 已截断）`;
      }
      attachmentTexts.set(id, content);
    };
    reader.readAsText(f);
  }
}

function buildAttachmentPrefix(): string {
  if (attachments.value.length === 0) return "";
  const parts: string[] = [];
  for (const a of attachments.value) {
    const text = attachmentTexts.get(a.id);
    parts.push(text ? `---\n[${a.name}]\n${text}\n---` : `[附件] ${a.name}（${a.kind === "image" ? "图片" : "文件"}）`);
  }
  return parts.join("\n\n") + "\n\n";
}

function clearAttachments() {
  for (const a of attachments.value) {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    attachmentTexts.delete(a.id);
  }
  attachments.value = [];
}

function onRemoveAttachment(id: string) {
  const a = attachments.value.find((x) => x.id === id);
  if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl);
  attachmentTexts.delete(id);
  attachments.value = attachments.value.filter((x) => x.id !== id);
}


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
  // ⌘K / Ctrl+K 全局命令面板（TASK-076）
  window.addEventListener("keydown", onGlobalKeydown);
  window.addEventListener("keydown", onMentionKeydown, true);
  await refreshPendingActions();
  // 跨会话挂起审批轮询（suspended 事件只在对应会话的流里，收件箱需主动拉取）
  pendingPollTimer = setInterval(() => void refreshPendingActions(), 10_000);

  // 配置中心（TASK-028 面板数据；TASK-026 新建会话缺省权限模式，失败保持 review 兜底）
  await fetchConfig();

  await fetchWorkspaces();
  await fetchSessions();
  await fetchModelProfiles();
  void fetchTools();

  // 成本用量（TASK-075）：首拉窗口汇总与配额生效值；后续随窗口切换在面板内刷新
  void usage.refresh();
  void usage.refreshLimits();

  // 页面刷新后自动检测是否有正在执行中的会话，若有直接进入并重新连入输出流
  const runningSession = sessions.value.find((s) => s.isRunning);
  if (runningSession) {
    await onSelectSession(runningSession);
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown);
  window.removeEventListener("keydown", onMentionKeydown, true);
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
  // 运行中入队（TASK-076 F2）：composer busy 不拦截 send，宿主排队、结束后自动下发
  if (isRunning.value) {
    const queued = (promptOverride ?? composerText.value).trim();
    if (queued) enqueueMessage(queued);
    return;
  }

  // 附件内联（仅直接发送路径；队列 flush 走 promptOverride 直传）
  let prompt = (promptOverride ?? composerText.value).trim();
  // @提及令牌展开：文本中仍存在的已插入引用 → 追加显式块（内联 @path 一并保留可读）
  const mentionBlocks = [...referencedFiles].filter((fp) => prompt.includes(`@${fp}`));
  if (mentionBlocks.length > 0) {
    prompt += mentionBlocks.map((fp) => `\n\n[@引用文件] ${fp}`).join("");
    for (const fp of mentionBlocks) referencedFiles.delete(fp);
  }
  if (!promptOverride && attachments.value.length > 0) {
    const prefix = buildAttachmentPrefix();
    prompt = prompt ? `${prefix}${prompt}` : prefix.trim();
    clearAttachments();
  }
  if (!prompt) return;

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
      :loading="sessionsLoading"
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
      @toggle-pin="togglePinSession"
      @delete-session="askDeleteSession"
      @open-settings="openSettings"
    />

    <!-- 中间交互区域 -->
    <main class="va-console__main">
      <!-- @提及 文件引用浮层（TASK-076 重构）：悬浮在输入框上方，不打断输入 -->
      <VaPopover
        v-model:open="mentionOpen"
        :anchor="mentionAnchor"
        placement="top-start"
        :offset="6"
        :close-on-outside-click="true"
        :close-on-escape="false"
      >
        <div class="va-console__mention" role="listbox" aria-label="引用工作区文件">
          <div v-if="mentionFilesLoading" class="va-console__mention-loading">
            <VaSkeleton v-for="i in 3" :key="i" :height="22" radius="6px" :width="i === 2 ? '84%' : '100%'" />
          </div>
          <template v-else-if="mentionOptions.length > 0">
            <button
              v-for="(fp, i) in mentionOptions"
              :key="fp"
              class="va-console__mention-item"
              :class="{ 'va-console__mention-item--active': i === mentionActiveIdx }"
              type="button"
              role="option"
              :aria-selected="i === mentionActiveIdx"
              @mouseenter="mentionActiveIdx = i"
              @click="onMentionPick(fp)"
            >
              <span class="va-console__mention-path">{{ fp }}</span>
            </button>
          </template>
          <p v-else class="va-console__mention-empty">
            无匹配文件（输入 @路径关键词 过滤工作区文件）
          </p>
        </div>
      </VaPopover>

      <!-- 共享操作行（TASK-076 F3）：⌘K 命令面板 + 通知铃铛（两场景常驻） -->
      <div class="va-console__viewhead">
        <VaCommandMenu
          v-model:open="cmdOpen"
          :commands="commands"
          trigger-label="命令"
          hotkey="⌘K"
          hide-trigger
          @select="onCommandSelect"
        />
        <VaPopover v-model:open="notifOpen" placement="bottom-end" :offset="8">
          <template #trigger>
            <button class="va-console__bell" type="button" aria-label="通知">
              <Bell :size="15" />
              <span v-if="unreadCount > 0" class="va-console__bell-badge">{{ unreadCount > 9 ? "9+" : unreadCount }}</span>
            </button>
          </template>
          <div class="va-console__notif-panel">
            <VaNotificationStack
              :notifications="notifications"
              title="通知"
              relative-time
              empty-label="暂无通知；审批到达与后台任务结束会出现在这里"
              @open="onNotificationOpen"
              @read="onNotifRead"
              @all-read="onNotifAllRead"
            />
          </div>
        </VaPopover>
      </div>
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
              attachable
              :attachments="attachments"
              :mention-paths="mentionFiles"
              @send="(t) => handleSend(t)"
              @update:model="onSelectModel"
              @update:permission="onSelectPermission"
              @files-selected="onFilesSelected"
              @remove-attachment="onRemoveAttachment"
            >
              <template #actions>
                <!-- 上下文窗口仪表（VaContextWindow，点击展开分段面板；VaPopover 托管定位/外部点击/Esc） -->
                <VaPopover placement="top-start" :offset="8">
                  <template #trigger>
                    <button class="va-console__seat-btn" type="button">
                      <History :size="12" />
                      <span class="va-console__seat-text">Context: {{ formatTokens(contextUsed) }} / {{ formatTokens(contextLimit) }}</span>
                      <span class="va-console__seat-text" title="会话累计消耗（计费口径：Σ各步 prompt+completion，含压缩前所有轮次）">· Session: {{ formatTokens(sessionTokensUsed) }}</span>
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
              <template #trailing>
                <ComposerMenu
                  :workspace-id="activeWorkspaceId"
                  @ref-file="openMentionPanel"
                  @clear="composerText = ''"
                  @insert="(text) => (composerText += text)"
                  @open-command-menu="cmdOpen = true"
                />
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
            <!-- 成本迷你占比条（TASK-075）：按模型 token 份额，仅在有数据时渲染 -->
            <VaCompactBreakdown
              v-if="usageCompactSegments.length > 0"
              class="va-console__usage-bar"
              :segments="usageCompactSegments"
              :height="6"
            />
            <TurnList
              :turns="chatTurns"
              @approve="(actionId) => submitApproval(actionId, true)"
              @deny="(actionId, reason) => submitApproval(actionId, false, reason)"
              @regenerate="regenerateTurn"
              @feedback="onFeedback"
            />
            <!-- 流式间隙思考指示（TASK-075）：已发车但首段内容未到 -->
            <VaThinkingLoader
              v-if="awaitingFirstContent"
              class="va-console__thinking"
              size="sm"
              :phases="['连接模型', '读取上下文', '规划步骤']"
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
          <!-- 运行中入队可视化（TASK-076 F2：VaQueueDock） -->
          <VaQueueDock
            v-if="messageQueue.length > 0"
            class="va-console__queuedock"
            :items="messageQueue"
            @remove="onQueueRemove"
            @send-now="onQueueSendNow"
            @edit="onQueueEdit"
          />
          <VaComposer
            ref="composerRef"
            v-model:text="composerText"
            placeholder="继续指令或追问…"
            :busy="isRunning"
            :models="composerModels"
            :model="activeModel"
            :permissions="composerPermissions"
            :permission="activePermission"
            attachable
            :attachments="attachments"
            :mention-paths="mentionFiles"
            @send="(t) => handleSend(t)"
            @stop="stopExecution"
            @update:model="onSelectModel"
            @update:permission="onSelectPermission"
            @files-selected="onFilesSelected"
            @remove-attachment="onRemoveAttachment"
          >
            <template #actions>
              <!-- 上下文窗口仪表（VaContextWindow，点击展开分段面板；VaPopover 托管定位/外部点击/Esc） -->
              <VaPopover placement="top-start" :offset="8">
                <template #trigger>
                  <button class="va-console__seat-btn" type="button">
                    <History :size="12" />
                    <span class="va-console__seat-text">Context: {{ formatTokens(contextUsed) }} / {{ formatTokens(contextLimit) }}</span>
                      <span class="va-console__seat-text" title="会话累计消耗（计费口径：Σ各步 prompt+completion，含压缩前所有轮次）">· Session: {{ formatTokens(sessionTokensUsed) }}</span>
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
            <template #trailing>
              <ComposerMenu
                :workspace-id="activeWorkspaceId"
                @ref-file="openMentionPanel"
                @clear="composerText = ''"
                @insert="(text) => (composerText += text)"
                @open-command-menu="cmdOpen = true"
              />
            </template>
          </VaComposer>
        </div>
      </section>

      <!-- 右侧栏：跨会话 HITL 待审批收件箱（轨迹已迁入主区 tab） -->
      <ConsoleRightSidebar
        v-if="!isRightSidebarCollapsed"
        :decisions="pendingDecisions"
        :workspace-id="activeWorkspaceId"
        :usage="usage"
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
          <span
            v-if="pendingDecisions.length > 0"
            class="va-console__rsb-badge"
            aria-label="待审批数"
          >{{ pendingDecisions.length }}</span>
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
          :providers="providers"
          :selected-provider-id="selectedProviderId"
          :is-creating-provider="isCreatingProvider"
          :current-provider="currentProvider"
          :current-provider-models="currentProviderModels"
          :provider-form="providerForm"
          :model-draft="modelDraft"
          :is-creating-model="isCreatingModel"
          :show-api-key="showApiKey"
          :is-testing-connection="isTestingConnection"
          :is-discovering="isDiscovering"
          :test-status="testStatus"
          :discovered-models="discoveredModels"
          :discovered-items="discoveredItems"
          @close="closeModelSettings"
          @select-provider="selectProvider"
          @create-provider="startCreateProvider"
          @delete-provider="deleteProvider"
          @create-model="startCreateModel"
          @edit-model="editModel"
          @delete-model="deleteModel"
          @cancel-model-edit="cancelModelEdit"
          @save-provider="saveProvider"
          @save-model="saveModel"
          @test="testModelConnection"
          @discover="discoverModels"
          @apply-detected="applyDetected"
          @provider-kind-change="onProviderKindChange"
          @update:show-api-key="showApiKey = $event"
          @toggle-modality="toggleModality"
          @toggle-reasoning="toggleReasoning"
          @toggle-tool-use="toggleToolUse"
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
        <!-- 成本配额（TASK-075）：finops 命名空间此前无 UI 入口，挂到执行 tab（与 429 准入同源） -->
        <ConfigPanel
          :namespace="configNs('finops')"
          :loading="configLoading"
          :load-error="configError"
          @patch="(key, value) => onConfigPatch('finops', key, value)"
          @reset="onConfigReset('finops')"
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
