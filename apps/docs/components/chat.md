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
