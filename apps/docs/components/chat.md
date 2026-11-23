<script setup lang="ts">
import { ref } from "vue";
import {
  VaThinkingLoader,
  VaStreamAnswer,
  VaMessageActions,
  VaComposer,
  VaDock,
  VaQueueDock,
  VaConversationHeader,
  VaEmptyHero,
  VaModelPicker,
  VaSessionManager,
  VaSessionTree,
  VaCommentThread,
  VaUserBubble,
  VaThoughtBox,
  VaAssistantTurn,
  VaTurnList,
  VaMarkdown,
  VaToolCallCard,
} from "@vuagent/ui";
import type {
  TurnItem,
  UserAttachment,
  TurnBlockItem,
  ActionCardItem,
} from "@vuagent/ui";

const sampleAnswer = "Vue 3.5 引入了全新的响应式重构，内存占用降低了 56%，并在大型 SSR 场景下提升了 10% 的水合速度。同时推出了稳定的 useTemplateRef() 与 ReactivePropsDestructure 语法。";

const composerText = ref("");

function handleComposerSend(content: string) {
  alert(`触发发送: ${content}`);
  composerText.value = "";
}

/* ---------- 5. VaDock ---------- */
const dockPanes = ref([
  {
    tabs: [
      { id: "files", label: "文件变更" },
      { id: "terminal", label: "终端" },
      { id: "preview", label: "预览" },
    ],
    activeId: "files",
  },
]);
const dockRatio = ref(0.55);
const dockFullscreen = ref<number | null>(null);

function handleDockSelect(paneIndex: number, tabId: string) {
  const pane = dockPanes.value[paneIndex];
  if (pane) pane.activeId = tabId;
}
function handleDockClose(paneIndex: number, tabId: string) {
  const pane = dockPanes.value[paneIndex];
  if (!pane) return;
  const idx = pane.tabs.findIndex((tab) => tab.id === tabId);
  if (idx === -1) return;
  pane.tabs.splice(idx, 1);
  if (pane.activeId === tabId) {
    pane.activeId = pane.tabs[idx]?.id ?? pane.tabs[idx - 1]?.id ?? "";
  }
}
function handleDockSplit() {
  if (dockPanes.value.length > 1) return;
  dockPanes.value.push({
    tabs: [{ id: "checkpoint", label: "检查点" }],
    activeId: "checkpoint",
  });
  dockRatio.value = 0.55;
}
function handleDockUnsplit() {
  dockPanes.value = dockPanes.value.slice(0, 1);
  dockFullscreen.value = null;
}
function handleDockFullscreen(paneIndex: number | null) {
  dockFullscreen.value = paneIndex;
}
function handleDockResize(ratio: number) {
  dockRatio.value = ratio;
}
function handleDockCollapse() {
  alert("请求折叠整个右侧面板（宿主可在此收起侧栏）");
}

/* ---------- 6. VaQueueDock ---------- */
const queueItems = ref([
  { id: "q-1", text: "补充暗色模式下的对话气泡回归用例" },
  { id: "q-2", text: "把 API 文档中的示例响应更新为 v2 协议格式" },
  { id: "q-3", text: "排查 CI 中 Node 18 的兼容性告警" },
]);

function handleQueueSendNow(index: number) {
  const item = queueItems.value[index];
  if (!item) return;
  queueItems.value.splice(index, 1);
  queueItems.value.unshift(item);
}
function handleQueueRemove(index: number) {
  queueItems.value.splice(index, 1);
}
function handleQueueEdit(index: number, text: string) {
  const item = queueItems.value[index];
  if (item) item.text = text;
}

/* ---------- 7. VaConversationHeader ---------- */
const headerTitle = ref("重构订单导出服务");
const headerActiveView = ref("chat");
const headerViews = [
  { id: "chat", label: "聊天" },
  { id: "trajectory", label: "轨迹" },
];

function handleHeaderRename(title: string) {
  headerTitle.value = title;
}

/* ---------- 8. VaEmptyHero ---------- */
const heroWorkspaces = ref([
  { id: "ws-core", name: "vuagent-core", path: "~/code/vuagent-core" },
  { id: "ws-docs", name: "docs-site", path: "~/code/vuagent-docs" },
  { id: "ws-lab", name: "experiment-lab", path: "~/code/experiment-lab" },
]);

function handleHeroCreateSession(workspaceId: string) {
  const ws = heroWorkspaces.value.find((w) => w.id === workspaceId);
  alert(`将在工作区「${ws?.name ?? workspaceId}」下创建新会话`);
}
function handleHeroCreateWorkspace() {
  alert("触发新建工作区（宿主可弹原生目录选择框）");
}

/* ---------- 9. VaModelPicker ---------- */
const pickerModels = [
  { id: "deepseek-chat", name: "DeepSeek Chat", tag: "推荐", provider: "DeepSeek", model: "deepseek-chat" },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner", tag: "深度思考", provider: "DeepSeek", model: "deepseek-reasoner" },
  { id: "gpt-4o", name: "GPT-4o", tag: "通用", provider: "OpenAI", model: "gpt-4o" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic", model: "claude-sonnet-4" },
];
const pickerSelected = ref("deepseek-chat");

/* ---------- 10. VaSessionManager ---------- */
const smNow = Date.now();
const smSessions = ref([
  { id: "s-101", title: "重构订单导出服务", createdAt: smNow - 86_400_000 * 2, updatedAt: smNow - 300_000, archived: false },
  { id: "s-102", title: "排查 SSR 水合告警", createdAt: smNow - 86_400_000, updatedAt: smNow - 7_200_000, archived: false },
  { id: "s-103", title: "", createdAt: smNow - 3_600_000, updatedAt: smNow - 1_800_000, archived: false },
  { id: "s-104", title: "旧版首页性能优化", createdAt: smNow - 86_400_000 * 9, updatedAt: smNow - 86_400_000 * 8, archived: true },
]);
const smActiveId = ref("s-101");

function handleSmSelect(id: string) {
  smActiveId.value = id;
}
function handleSmCreate() {
  const id = `s-${Date.now()}`;
  smSessions.value.unshift({ id, title: "", createdAt: Date.now(), updatedAt: Date.now(), archived: false });
  smActiveId.value = id;
}
function handleSmRename(id: string, title: string) {
  const target = smSessions.value.find((item) => item.id === id);
  if (target) {
    target.title = title;
    target.updatedAt = Date.now();
  }
}
function handleSmArchive(id: string, archived: boolean) {
  const target = smSessions.value.find((item) => item.id === id);
  if (target) {
    target.archived = archived;
    target.updatedAt = Date.now();
  }
}
function handleSmRemove(id: string) {
  smSessions.value = smSessions.value.filter((item) => item.id !== id);
}

/* ---------- 11. VaSessionTree ---------- */
const treeNow = Date.now();
const treeWorkspaces = ref([
  { id: "ws-core", name: "vuagent-core", description: "核心运行时" },
  { id: "ws-docs", name: "docs-site", description: "文档与官网" },
]);
const treeSessions = ref([
  { id: "st-1", title: "重构订单导出服务", workspaceId: "ws-core", createdAt: treeNow - 3_600_000, updatedAt: treeNow - 300_000, archived: false, running: true, waitingApproval: false, pinned: true },
  { id: "st-2", title: "审批流接入 vaConfirm", workspaceId: "ws-core", createdAt: treeNow - 7_200_000, updatedAt: treeNow - 1_800_000, archived: false, running: false, waitingApproval: true, pinned: false },
  { id: "st-3", title: "暗色主题回归测试", workspaceId: "ws-core", createdAt: treeNow - 86_400_000, updatedAt: treeNow - 3_600_000, archived: false, running: false, waitingApproval: false, pinned: false },
  { id: "st-4", title: "组件文档迁移 VitePress", workspaceId: "ws-docs", createdAt: treeNow - 86_400_000 * 2, updatedAt: treeNow - 86_400_000, archived: false, running: false, waitingApproval: false, pinned: false },
]);
const treeArchived = ref([
  { id: "st-9", title: "旧版首页性能优化", workspaceId: "ws-core", createdAt: treeNow - 86_400_000 * 9, updatedAt: treeNow - 86_400_000 * 8, archived: true, running: false, waitingApproval: false, pinned: false },
]);
const treeCurrentWorkspaceId = ref("ws-core");
const treeCurrentSessionId = ref("st-1");

function handleTreeSelectSession(id: string) {
  treeCurrentSessionId.value = id;
}
function handleTreeCreateSession(workspaceId: string) {
  const id = `st-${Date.now()}`;
  treeSessions.value.push({
    id,
    title: "",
    workspaceId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
    running: false,
    waitingApproval: false,
    pinned: false,
  });
  treeCurrentSessionId.value = id;
  treeCurrentWorkspaceId.value = workspaceId;
}
function handleTreeCreateWorkspace(name: string) {
  const id = `ws-${Date.now()}`;
  treeWorkspaces.value.push({ id, name });
}
function handleTreeRemoveWorkspace(id: string) {
  treeWorkspaces.value = treeWorkspaces.value.filter((ws) => ws.id !== id);
}
function handleTreeTogglePin(id: string) {
  const target = treeSessions.value.find((item) => item.id === id);
  if (target) target.pinned = !target.pinned;
}
function handleTreeRename(id: string, title: string) {
  const target =
    treeSessions.value.find((item) => item.id === id) ??
    treeArchived.value.find((item) => item.id === id);
  if (target) {
    target.title = title;
    target.updatedAt = Date.now();
  }
}
function handleTreeArchive(id: string, archived: boolean) {
  if (archived) {
    const idx = treeSessions.value.findIndex((item) => item.id === id);
    if (idx !== -1) {
      const [moved] = treeSessions.value.splice(idx, 1);
      if (moved) {
        moved.archived = true;
        treeArchived.value.push(moved);
      }
    }
  } else {
    const idx = treeArchived.value.findIndex((item) => item.id === id);
    if (idx !== -1) {
      const [moved] = treeArchived.value.splice(idx, 1);
      if (moved) {
        moved.archived = false;
        treeSessions.value.push(moved);
      }
    }
  }
}
function handleTreeRemove(id: string) {
  treeSessions.value = treeSessions.value.filter((item) => item.id !== id);
  treeArchived.value = treeArchived.value.filter((item) => item.id !== id);
}

/* ---------- 12. VaCommentThread ---------- */
const threadBase = Date.now();
const threadComments = ref([
  { id: "cm-1", author: "Vuagent", role: "Agent", initials: "V", text: "我起草了一版发布说明草稿，重点放在排队消息与停靠分屏体验上，请审阅。", createdAt: threadBase - 26 * 60_000, pending: true },
  { id: "cm-2", author: "张北", role: "工程师", initials: "北", text: "排队消息的插队动效很顺滑，发布说明里补一句「运行中也可继续入队」吧。", createdAt: threadBase - 12 * 60_000, pending: false },
  { id: "cm-3", author: "李晴", role: "评审", initials: "晴", text: "分屏比例的拖动范围记得写清楚是 20%–80%。", createdAt: threadBase - 5 * 60_000, pending: false },
]);

function handleThreadSubmit(text: string) {
  threadComments.value.push({
    id: `cm-${Date.now()}`,
    author: "张北",
    role: "工程师",
    initials: "北",
    text,
    createdAt: Date.now(),
    pending: false,
  });
}
function handleThreadAdopt(id: string) {
  const target = threadComments.value.find((item) => item.id === id);
  if (target) {
    target.pending = false;
    target.role = "已采纳";
  }
}
function handleThreadRewrite(id: string) {
  alert(`已请求 agent 重写草稿：${id}`);
}
function handleThreadDiscard(id: string) {
  threadComments.value = threadComments.value.filter((item) => item.id !== id);
}

/* ---------- 13. VaUserBubble ---------- */
const ubTrendSvg =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='100%25' height='100%25' fill='%23eef2ff'/%3E%3Crect x='36' y='96' width='40' height='56' rx='6' fill='%23a5b4fc'/%3E%3Crect x='96' y='64' width='40' height='88' rx='6' fill='%23818cf8'/%3E%3Crect x='156' y='84' width='40' height='68' rx='6' fill='%236366f1'/%3E%3Crect x='216' y='40' width='40' height='112' rx='6' fill='%234f46e5'/%3E%3C/svg%3E";
const ubAttachments = ref<UserAttachment[]>([
  { kind: "image", name: "上周订单量趋势.png", size: 86_400, dataUrl: ubTrendSvg },
  { kind: "file", name: "订单导出接口-v1.pdf", size: 1_862_415 },
]);

/* ---------- 14. VaThoughtBox ---------- */
const tbThoughtText =
  "用户想优化订单导出的内存峰值：先确认当前实现是一次性拼接完整 CSV 字符串（50 万行约 400MB），再核对依赖里是否已有流式写出能力，最后决定按「分批刷写 + 背压监听」重构导出链路。";
const tbLiveExpanded = ref(true);
const tbDoneExpanded = ref(false);
const tbSummaryOn = ref(true);

/* ---------- 15. VaAssistantTurn ---------- */
const atThoughtExpanded = ref(true);
const atProcessCollapsed = ref(false);
const atContent =
  "改造结论：导出接口改为流式响应，单批 5,000 行刷写一次缓冲区，峰值内存预计从约 400MB 降至 30MB 以内。";
const atCards: ActionCardItem[] = [
  {
    id: "tc-search",
    type: "tool_call",
    data: {
      name: "search_web",
      summary: "检索流式 CSV 导出的成熟方案",
      status: "success",
      args: { query: "nodejs http chunked csv export", limit: 5 },
      result: { pattern: "res.write(chunk) + backpressure", refs: 5 },
      duration: 842,
    },
  },
];
const atBlocks: TurnBlockItem[] = [
  { kind: "text", content: "看完现有实现了：接口把整个 CSV 拼成一个大字符串再返回，这正是内存峰值的元凶。检索到的社区方案与改造步骤如下：" },
  { kind: "card", cardId: "tc-search" },
  { kind: "text", content: "## 改造方案\n\n- 导出接口改为 **chunked 流式响应**，边生成边推送\n- 单批 `5,000` 行刷写一次缓冲区，峰值内存从约 400MB 降到 30MB 以内\n- 前端通过 ReadableStream 分块接收，边下边存并触发浏览器保存" },
];
const atLastAction = ref("（尚未触发操作，试试复制 / 重新生成 / 点赞点踩）");

function handleAtRegenerate() {
  atLastAction.value = "已请求重新生成这一轮回答";
}
function handleAtCopy(text: string) {
  atLastAction.value = `已复制正文（${text.length} 字符）`;
}
function handleAtFeedback(kind: "up" | "down" | null, reason?: string) {
  atLastAction.value =
    kind === "up"
      ? "已点赞本条回答"
      : kind === "down"
        ? `已点踩${reason ? `（原因：${reason}）` : ""}`
        : "已取消反馈";
}

/* ---------- 16. VaTurnList ---------- */
const tlTurns = ref<TurnItem[]>([
  {
    id: "turn-1",
    role: "user",
    content: "帮我把订单导出改成流式下载，单次要撑住 50 万行，接口文档附在下面。",
    attachments: [{ kind: "file", name: "订单导出接口-v1.pdf", size: 1_862_415 }],
    avatar: "北",
  },
  {
    id: "turn-2",
    role: "assistant",
    thought: "先看接口文档确认响应结构，再调研 Node 流式写出的成熟方案，最后评估前端分块下载的兼容性。",
    thoughtDuration: 2.4,
    thoughtExpanded: true,
    processCollapsed: false,
    toolCount: 2,
    avatar: "bot",
    blocks: [
      { kind: "text", content: "看完文档了：当前接口把整个 CSV 拼成一个大字符串再返回，这正是内存峰值的元凶。改造方向如下：" },
      { kind: "card", cardId: "tc-stream" },
      { kind: "text", content: "接口改为 `Transfer-Encoding: chunked` 的流式响应，前端用 fetch 的 ReadableStream 边收边存，预计峰值内存下降 90% 以上。" },
    ],
    cards: [
      {
        id: "tc-stream",
        type: "tool_call",
        data: {
          name: "search_web",
          summary: "检索 Node 流式 CSV 导出方案",
          status: "success",
          args: { query: "nodejs http chunked csv export", limit: 5 },
          result: { pattern: "res.write(chunk) + backpressure", refs: 5 },
          duration: 690,
        },
      },
    ],
  },
  {
    id: "turn-3",
    role: "user",
    content: "进度条能边下载边更新吗？用户最好能实时看到已导出行数。",
    avatar: "北",
  },
  {
    id: "turn-4",
    role: "assistant",
    content: "可以。流式响应拿不到总行数，所以用自定义响应头 `X-Exported-Rows` 每批刷新已导出行数，前端监听并更新进度条，完成后自动触发浏览器保存。",
    thought: "进度条的关键是总行数未知场景下的展示策略：改为展示「已导出 N 行」而非百分比，避免服务端预扫描全表。",
    thoughtDuration: 1.6,
    thoughtExpanded: false,
    processCollapsed: true,
    toolCount: 4,
    avatar: "bot",
  },
]);
const tlStatus = ref("（点击回答的操作条、思考详情或摘要条试试）");

function handleTlRegenerate(turnId: string) {
  tlStatus.value = `已对轮次 ${turnId} 触发重新生成`;
}
function handleTlCopy(text: string, turnId: string) {
  tlStatus.value = `已复制轮次 ${turnId} 正文（${text.length} 字符）`;
}
function handleTlFeedback(turnId: string, kind: "up" | "down" | null, reason?: string) {
  const label =
    kind === "up"
      ? "点赞"
      : kind === "down"
        ? `点踩${reason ? `（原因：${reason}）` : ""}`
        : "取消反馈";
  tlStatus.value = `轮次 ${turnId} 收到反馈：${label}`;
}
function handleTlThoughtExpanded(turnId: string, expanded: boolean) {
  const target = tlTurns.value.find((item) => item.id === turnId);
  if (target) target.thoughtExpanded = expanded;
  tlStatus.value = `轮次 ${turnId} 思考详情${expanded ? "已展开" : "已收起"}`;
}
function handleTlProcessCollapsed(turnId: string, collapsed: boolean) {
  const target = tlTurns.value.find((item) => item.id === turnId);
  if (target) target.processCollapsed = collapsed;
  tlStatus.value = `轮次 ${turnId} 过程${collapsed ? "已收拢为摘要条" : "已展开完整过程"}`;
}

/* ---------- 17. VaMarkdown ---------- */
const mdRichContent = [
  "## 订单导出改造评审结论",
  "",
  "整体方案可行，落地前重点关注以下三点：",
  "",
  "- **流式写出**：服务端逐批 `write()`，避免一次性拼接大字符串",
  "- **背压处理**：监听 `drain` 事件，防止内存缓冲反弹",
  "- **断点续传**：支持 `Range` 请求，弱网重试不从头再来",
  "",
  "> 评审提醒：灰度期间先放量 5% 观察 P99 耗时，稳定后再全量切换。",
  "",
  "```ts",
  "export function createExportStream(rows: OrderRow[]) {",
  "  const stream = new TransformStream<OrderRow, Uint8Array>();",
  "  // 每批 5000 行刷写一次，控制峰值内存",
  "  return stream.readable.pipeThrough(batch(rows, 5000));",
  "}",
  "```",
  "",
  "| 指标 | 改造前 | 改造后 |",
  "| --- | --- | --- |",
  "| 峰值内存 | ~400 MB | < 30 MB |",
  "| 首字节时间 | 8.2s | 0.4s |",
  "| 单次上限 | 5 万行 | 50 万行 |",
  "",
  "详细协议见 https://vuagent.example.com/docs/export-stream",
].join("\n");
const mdStreamingContent = "正在生成评审结论：核心改造点已确认，正在计算改造前后的指标对比……";
</script>

# Chat 对话交互组件

> 专为现代 AI 对话界面量身定制的交互组件：从推理阶段的思考链动效、渐进流式打字渲染，到消息操作栏与多功能输入框。

---

## 1. VaThinkingLoader — 思考阶段轮播加载器

模型处于思考（Reasoning / Thinking）阶段时展示阶段性状态轮播与微动效，缓解用户的等待焦虑。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">思考中状态预览</div>
  <VaThinkingLoader
    :phases="['正在分析用户意图...', '检索相关知识库与 Schema...', '规划工具执行链路...']"
    :interval="2000"
    loop
  />
</div>

### 代码示例

```vue
<template>
  <VaThinkingLoader
    :phases="['正在分析意图...', '检索相关文档...', '生成最终方案...']"
    :interval="2000"
    loop
  />
</template>
```

---

## 2. VaStreamAnswer — 流式打字机效果

按照指定节奏将长文本以流式逐字输出，自带平滑的打字机光标动效。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">流式文本渲染预览</div>
  <VaStreamAnswer
    :source="sampleAnswer"
    :interval="40"
    auto-play
  />
</div>

### 代码示例

```vue
<template>
  <VaStreamAnswer
    :source="fullText"
    :interval="40"
    auto-play
  />
</template>
```

---

## 3. VaMessageActions — 消息操作栏

提供复制正文、重新生成回答、多版本切换以及点赞/点踩质量反馈。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">消息反馈操作条</div>
  <div style="padding: 12px; background: var(--va-color-surface-soft, #f8fafc); border-radius: 8px;">
    <p style="margin: 0 0 12px 0;">这是助手的一条回复内容示例...</p>
    <VaMessageActions
      text="这是助手的一条回复内容示例..."
      :versions="2"
      @copy="() => alert('已复制到剪贴板')"
      @regenerate="() => alert('触发重新生成')"
    />
  </div>
</div>

---

## 4. VaComposer — 富交互对话输入框

集成输入、快捷指令、发送按钮及状态联动的对话输入组件。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">输入框效果预览</div>
  <VaComposer
    v-model="composerText"
    placeholder="输入您的业务需求，按 Enter 发送..."
    @send="handleComposerSend"
  />
</div>

---

## 5. VaDock — 停靠面板

右侧面板停靠容器：胶囊式 Tab 条 + 最多两路分屏（分隔条可拖动 20%–80%）+ 全屏与折叠，面板内容由宿主通过 `#pane` 作用域插槽注入。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">右侧停靠面板：Tab 切换、分屏与全屏</div>
  <div style="height: 320px; border: 1px solid var(--va-color-border, #e5e7eb); border-radius: 10px; overflow: hidden;">
    <VaDock
      :panes="dockPanes"
      :ratio="dockRatio"
      :fullscreen-pane="dockFullscreen"
      @select="handleDockSelect"
      @close="handleDockClose"
      @split="handleDockSplit"
      @unsplit="handleDockUnsplit"
      @fullscreen="handleDockFullscreen"
      @resize="handleDockResize"
      @collapse="handleDockCollapse"
    >
      <template #pane="{ paneIndex, tabId }">
        <div style="padding: 14px 16px; font-size: 13px; line-height: 1.9;">
          <template v-if="tabId === 'files'">
            <p style="margin: 0;">apps/chat/src/QueueDock.vue <span style="color: #16a34a;">+36</span> <span style="color: #dc2626;">−4</span></p>
            <p style="margin: 0;">packages/ui/src/components/dock/VaDock.vue <span style="color: #16a34a;">+12</span> <span style="color: #dc2626;">−9</span></p>
          </template>
          <p v-else-if="tabId === 'terminal'" style="margin: 0;">$ pnpm test --filter chat<br />✓ 42 passed (3.1s)</p>
          <p v-else-if="tabId === 'preview'" style="margin: 0;">预览服务已启动：http://localhost:4173/chat</p>
          <p v-else-if="tabId === 'checkpoint'" style="margin: 0;">cp-07 · 拆分审批状态机（3 分钟前）</p>
          <p v-else style="margin: 0;">面板 {{ paneIndex + 1 }} · {{ tabId ? `Tab「${tabId}」` : "空面板（点击「＋」添加）" }}</p>
        </div>
      </template>
    </VaDock>
  </div>
</div>

---

## 6. VaQueueDock — 任务队列停靠栏

Agent 运行期间继续接收新任务的排队消息停靠栏：支持插队置顶、行内编辑与移除，让「下一轮要做什么」一目了然。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">排队消息：插队、行内编辑与移除</div>
  <div style="padding: 12px; background: var(--va-color-surface-soft, #f8fafc); border-radius: 8px;">
    <VaQueueDock
      :items="queueItems"
      @send-now="handleQueueSendNow"
      @edit="handleQueueEdit"
      @remove="handleQueueRemove"
    />
    <p v-if="queueItems.length === 0" style="margin: 10px 0 0; font-size: 13px;">队列已清空，本轮运行结束后不再有待发消息。</p>
  </div>
</div>

---

## 7. VaConversationHeader — 会话头部

中央会话区头部：标题支持行内重命名，视图 Tab 可切换聊天/轨迹，并带有运行中计时徽标与待审批红标。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">会话头部：运行徽标、待审批与视图切换</div>
  <div style="padding: 10px 12px; border: 1px solid var(--va-color-border, #e5e7eb); border-radius: 10px;">
    <VaConversationHeader
      v-model:activeView="headerActiveView"
      :title="headerTitle"
      :views="headerViews"
      :running="true"
      elapsed-label="01:24"
      :waiting-approval="true"
      @rename="handleHeaderRename"
    />
    <p style="margin: 10px 4px 2px; font-size: 12px;">当前视图：{{ headerActiveView }} · 点击标题即可重命名</p>
  </div>
</div>

---

## 8. VaEmptyHero — 空状态首屏

空会话时的引导首屏：点击工作区卡片即在其下创建新会话，虚线卡片触发新建工作区。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">空状态首屏：选择工作区开启会话</div>
  <VaEmptyHero
    :workspaces="heroWorkspaces"
    @create-session="handleHeroCreateSession"
    @create-workspace="handleHeroCreateWorkspace"
  />
</div>

---

## 9. VaModelPicker — 模型选择器

模型选择菜单：触发按钮 + 键盘可导航的下拉列表，传入 provider 后自动按供应商分组展示。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">模型选择菜单：按供应商分组</div>
  <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
    <VaModelPicker
      v-model:selected="pickerSelected"
      :models="pickerModels"
      align="left"
    />
    <span style="font-size: 13px;">当前选中：<strong>{{ pickerSelected }}</strong></span>
  </div>
</div>

---

## 10. VaSessionManager — 会话管理

会话管理下拉：活跃/归档分组展示，支持新建、行内重命名、归档恢复与二次确认删除。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">会话管理下拉：活跃/归档分组</div>
  <div style="padding: 12px; background: var(--va-color-surface-soft, #f8fafc); border-radius: 8px;">
    <VaSessionManager
      :sessions="smSessions"
      :active-id="smActiveId"
      @select="handleSmSelect"
      @create="handleSmCreate"
      @rename="handleSmRename"
      @archive="handleSmArchive"
      @remove="handleSmRemove"
    />
  </div>
</div>

---

## 11. VaSessionTree — 会话树

会话侧栏：工作区为平铺分组标题、会话一列排开，行内状态点（运行中脉冲 / 待审批红点）与置顶图钉一目了然，支持搜索、新建与归档分区。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">会话侧栏：工作区分组与状态标记</div>
  <div style="min-height: 400px; border: 1px solid var(--va-color-border, #e5e7eb); border-radius: 10px;">
    <VaSessionTree
      :workspaces="treeWorkspaces"
      :sessions="treeSessions"
      :archived="treeArchived"
      :current-workspace-id="treeCurrentWorkspaceId"
      :current-session-id="treeCurrentSessionId"
      new-session
      searchable
      @select-session="handleTreeSelectSession"
      @create-session="handleTreeCreateSession"
      @create-workspace="handleTreeCreateWorkspace"
      @remove-workspace="handleTreeRemoveWorkspace"
      @toggle-pin="handleTreeTogglePin"
      @rename="handleTreeRename"
      @archive="handleTreeArchive"
      @remove="handleTreeRemove"
    />
  </div>
</div>

---

## 12. VaCommentThread — 评论/批注线程

评审批注线程：agent 起草的待审条目自带采纳/重写/丢弃操作条，人工评论支持 ⌘/Ctrl+Enter 快速发布。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">评论线程：Agent 草稿待审</div>
  <div style="padding: 12px; background: var(--va-color-surface-soft, #f8fafc); border-radius: 8px;">
    <VaCommentThread
      :comments="threadComments"
      :max-height="320"
      placeholder="对这轮改动补充你的意见，⌘/Ctrl+Enter 发布..."
      @submit="handleThreadSubmit"
      @adopt="handleThreadAdopt"
      @rewrite="handleThreadRewrite"
      @discard="handleThreadDiscard"
    />
  </div>
</div>

---

## 13. VaUserBubble — 用户消息气泡

用户提问气泡：右对齐展示提问正文，支持头像（文字 / `icon` / 图片链接）与多模态附件——图片走 `dataUrl`/`url` 即时缩略预览，通用文件以胶囊标签列出，`attachments` 接收 `UserAttachment[]`。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">用户消息气泡：多模态附件预览与头像形态</div>
  <div style="display: flex; flex-direction: column; gap: 18px;">
    <VaUserBubble
      content="帮我把订单导出改成流式下载，单次要撑住 50 万行，趋势图和接口文档都附上了。"
      :attachments="ubAttachments"
      avatar="北"
    />
    <VaUserBubble
      content="对比这两张数据，先出一版灰度放量方案吧。"
      avatar="icon"
    />
  </div>
</div>

---

## 14. VaThoughtBox — 思考过程折叠盒

思考链折叠盒：思考中呈现脉冲动效与「正在深度思考」状态，完成后展示「思考过程 · 耗时 Ns」可展开详情；`summaryMode` 下收拢为单行摘要条（已完成 · 耗时 · 工具调用次数），点击摘要条即可还原完整过程。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">思考过程折叠盒：流式思考 / 已完成详情 / 摘要条三态</div>
  <div style="display: flex; flex-direction: column; gap: 14px;">
    <VaThoughtBox
      v-model:expanded="tbLiveExpanded"
      :thought="tbThoughtText"
      streaming
    />
    <VaThoughtBox
      v-model:expanded="tbDoneExpanded"
      :thought="tbThoughtText"
      :duration="2.4"
      :tool-count="3"
    />
    <VaThoughtBox
      v-model:summary-mode="tbSummaryOn"
      :thought="tbThoughtText"
      :duration="2.4"
      :tool-count="3"
    />
    <p style="margin: 0; font-size: 12px;">
      摘要条形态：{{ tbSummaryOn ? "已收拢（点击摘要条可展开完整过程）" : "已展开完整思考过程" }} · 完成态详情{{ tbDoneExpanded ? "展开中" : "已收起" }}
    </p>
  </div>
</div>

---

## 15. VaAssistantTurn — 助手单轮回复

助手单轮回复复合组件：头像 + 思考盒（可折叠为摘要条）+ Markdown 正文 + 工具卡片时序穿插（`blocks` + `cards`，经 `#card` 作用域插槽透传给 VaToolCallCard 渲染）+ 底部操作条（复制 / 重新生成 / 点赞点踩）。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">助手单轮回复：思考盒 + 卡片穿插正文 + 操作条</div>
  <div style="padding: 12px; background: var(--va-color-surface-soft, #f8fafc); border-radius: 10px;">
    <VaAssistantTurn
      v-model:thought-expanded="atThoughtExpanded"
      v-model:process-collapsed="atProcessCollapsed"
      :content="atContent"
      thought="先确认现有导出实现是一次性拼接完整 CSV，再检索流式写出的成熟方案，最后给出分批落盘与前端分块接收的改造建议。"
      :thought-duration="2.4"
      :tool-count="2"
      can-collapse-process
      avatar="bot"
      :blocks="atBlocks"
      :cards="atCards"
      @regenerate="handleAtRegenerate"
      @copy="handleAtCopy"
      @feedback="handleAtFeedback"
    >
      <template #card="{ card }">
        <VaToolCallCard
          v-if="card"
          :name="card.data.name"
          :summary="card.data.summary"
          :status="card.data.status"
          :args="card.data.args"
          :result="card.data.result"
          :duration="card.data.duration"
          default-open
        />
      </template>
    </VaAssistantTurn>
    <p style="margin: 10px 2px 0; font-size: 12px;">最近操作：{{ atLastAction }}</p>
  </div>
</div>

---

## 16. VaTurnList — 轮次列表

对话轮次瀑布流：按 `role` 自动路由给 VaUserBubble 与 VaAssistantTurn，事件以轮次 `id` 透传（camelCase emit，模板用 kebab 监听）；`#card` 插槽穿透到每一轮的卡片位，这里用 VaToolCallCard 渲染工具调用。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">对话轮次列表：用户气泡 + 思考盒/摘要条 + 卡片穿插</div>
  <div style="padding: 14px; background: var(--va-color-surface-soft, #f8fafc); border-radius: 10px;">
    <VaTurnList
      :turns="tlTurns"
      @regenerate="handleTlRegenerate"
      @copy="handleTlCopy"
      @feedback="handleTlFeedback"
      @update-thought-expanded="handleTlThoughtExpanded"
      @update-process-collapsed="handleTlProcessCollapsed"
    >
      <template #card="{ card }">
        <VaToolCallCard
          v-if="card"
          :name="card.data.name"
          :summary="card.data.summary"
          :status="card.data.status"
          :args="card.data.args"
          :result="card.data.result"
          :duration="card.data.duration"
        />
      </template>
    </VaTurnList>
    <p style="margin: 10px 2px 0; font-size: 12px;">最近交互：{{ tlStatus }}</p>
  </div>
</div>

---

## 17. VaMarkdown — Markdown 渲染器

轻量高质量 Markdown 渲染器（基于 markdown-it）：完整排版标题/列表/代码块/表格/引用，默认开启 `linkify`（URL 自动成链）与 `breaks`（软换行转 `<br>`）；`streaming` 时文末显示呼吸跳动光标。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">Markdown 富文本渲染 + 流式光标形态</div>
  <VaMarkdown :content="mdRichContent" />
  <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--va-color-border, #e5e7eb);">
    <VaMarkdown :content="mdStreamingContent" streaming />
  </div>
</div>
