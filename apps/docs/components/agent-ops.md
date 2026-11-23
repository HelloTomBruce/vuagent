<script setup lang="ts">
import { ref } from "vue";
import {
  VaApprovalCard,
  VaAgentPlan,
  VaToolCallCard,
  VaContextWindow,
  VaCodeDiff,
  VaTerminalLog,
  VaTrajectory,
  VaDecisionInbox,
  VaAgentInbox,
  VaInlineDiff,
  VaMemoryPanel,
  VaFileTree,
  VaCheckpointList,
  VaChangeSummary,
} from "@vuagent/ui";

// 审批卡片状态
const approvalStatus = ref("pending");
const approvalReason = ref("");

function handleApprove() {
  approvalStatus.value = "approved";
  approvalReason.value = "用户已手动确认执行";
}

function handleDeny(reason) {
  approvalStatus.value = "denied";
  approvalReason.value = reason === "timeout" ? "审批超时自动拒绝" : "用户驳回了操作";
}

// 计划步骤数据
const planSteps = ref([
  { id: "1", title: "扫描项目依赖与漏洞", status: "done", duration: 820 },
  { id: "2", title: "升级 package.json 中的核心依赖版本", status: "running", startedAt: Date.now() - 3400 },
  { id: "3", title: "运行全量自动化测试套件 (pnpm test)", status: "pending" },
  { id: "4", title: "生成版本变更日志与 PR 描述", status: "pending" },
]);

// 上下文分段数据
const contextParts = [
  { id: "sys", label: "系统提示词", tokens: 1200, kind: "system" },
  { id: "tools", label: "工具定义 Schema", tokens: 3400, kind: "tools" },
  { id: "hist", label: "历史对话与上下文", tokens: 8600, kind: "history" },
];

// 代码差异
const oldCode = `function calculateTotal(price, count) {
  return price * count;
}`;

const newCode = `function calculateTotal(price, count, discount = 1) {
  if (count <= 0) return 0;
  return Number((price * count * discount).toFixed(2));
}`;

// 终端日志
const terminalLines = [
  { text: "pnpm build", kind: "cmd" },
  { text: "vite v5.4.0 building for production...", kind: "stdout" },
  { text: "transforming (42) src/index.ts", kind: "stdout" },
  { text: "warning: chunk size exceeds 500 kB", kind: "warn" },
  { text: "✓ built in 1.24s", kind: "ok" },
];

// ---------- 7. 轨迹视图 ----------
const trajBase = Date.now() - 14 * 60 * 1000;
const trajEvents = ref([
  { id: "tj-1", at: trajBase, lane: "input", role: "user", title: "订单导出超过 5 万行必超时，帮我排查一下", turn: 1 },
  { id: "tj-2", at: trajBase + 1800, lane: "model", role: "assistant", title: "先看导出服务实现与慢查询日志，定位瓶颈在哪一段。", turn: 1 },
  { id: "tj-3", at: trajBase + 4600, endAt: trajBase + 7100, lane: "tool", role: "tool", title: "read_file", detail: '{ "path": "apps/api/src/export/order-export.service.ts" }', result: "读取成功：逐行同步写 Excel，未做分批。", turn: 1 },
  { id: "tj-4", at: trajBase + 9400, endAt: trajBase + 12100, lane: "tool", role: "tool", title: "grep_search", detail: '{ "pattern": "SELECT * FROM order_item WHERE ..." }', result: "命中 3 处，export.service.ts:187 存在全表扫描。", turn: 1 },
  { id: "tj-5", at: trajBase + 58000, lane: "input", role: "user", title: "确认了，按游标分批 + 流式写入的思路改吧", turn: 2 },
  { id: "tj-6", at: trajBase + 59900, lane: "model", role: "assistant", title: "方案：游标分页每批 2000 行，流式写出避免整表驻留内存。", turn: 2 },
  { id: "tj-7", at: trajBase + 63200, endAt: trajBase + 68900, lane: "tool", role: "tool", title: "edit_file", detail: '{ "path": "order-export.service.ts", "mode": "rewrite" }', result: "已重写主循环：新增游标分页与批量写出。", turn: 2 },
  { id: "tj-8", at: trajBase + 71300, endAt: trajBase + 149800, lane: "tool", role: "tool", title: "run_tests", detail: '{ "cmd": "pnpm test export", "timeout": 120000 }', result: "18 个用例全部通过（含 5 万行大数据集）。", turn: 2 },
]);
const trajSelected = ref(null);

function handleTrajSelect(id) {
  trajSelected.value = id;
}

// ---------- 8. 业务决策收件箱 ----------
const decisionItems = ref([
  { id: "dz-1", title: "order-export v2.3.0 是否立即发布生产？", detail: "预发灰度 4 小时，错误率 0.02%，低于 0.1% 阈值。", primary: "立即发布", secondary: "再观察 2 小时" },
  { id: "dz-2", title: "大促前是否把导出服务扩容一倍？", detail: "流量预估 3 倍，当前实例峰值 QPS 已达容量红线 82%。", primary: "扩容 8 → 16 台", secondary: "维持现状", collapsed: true },
  { id: "dz-3", title: "旧版同步导出通道是否下线？", detail: "新通道已承接 97% 流量，旧通道近 7 天仅 41 次调用。", primary: "立即下线", secondary: "保留一个版本周期", collapsed: true },
]);
const decisionLog = ref("");

function handleDecide(decision, answer) {
  decisionLog.value = `${decision.title} → ${answer === "primary" ? decision.primary : decision.secondary}`;
}

// ---------- 9. 后台任务收件箱 ----------
const inboxTasks = ref([
  { id: "ak-1", title: "全量回归测试（订单域 328 例）", agent: "qa-runner", status: "running", startedAt: Date.now() - 4 * 60 * 1000, steps: ["已拉起 3 个并行测试容器", "核心链路 214/328 用例通过"] },
  { id: "ak-2", title: "升级 pnpm 依赖并生成变更日志", agent: "deps-bot", status: "waiting", startedAt: Date.now() - 26 * 60 * 1000, steps: ["lockfile 已更新", "2 个 breaking change 等待人工确认"] },
  { id: "ak-3", title: "生成研发周报草稿", agent: "scribe", status: "done", startedAt: Date.now() - 3 * 60 * 60 * 1000, duration: 96000, steps: ["聚合 5 个仓库本周 commit", "草稿已写入文档空间"] },
  { id: "ak-4", title: "同步 Notion 需求看板", agent: "sync-bot", status: "error", error: "Notion API 429 限流，连续 3 次重试失败", steps: ["第 1 次重试", "第 2 次重试", "第 3 次重试"] },
  { id: "ak-5", title: "清理 CI 构建缓存", agent: "janitor", status: "queued" },
]);
const inboxLog = ref("");

function handleInboxOpen(task) {
  inboxLog.value = `打开任务详情：${task.title}`;
}

function handleInboxRetry(task) {
  inboxLog.value = `已请求重试：${task.title}`;
}

function handleInboxCancel(task) {
  inboxLog.value = `已请求取消：${task.title}`;
}

// ---------- 10. 行内差异 ----------
const copyOriginal = "本功能支持一键导出报表，数据实时更新，操作简单方便。";
const copyRevised = "本功能支持一键导出 Excel 报表，数据每 5 分钟自动刷新，三步即可完成导出。";
const appliedText = ref("");

function handleApply(result) {
  appliedText.value = result;
}

// ---------- 11. 记忆面板 ----------
const memoryEnabled = ref(true);
const memoryItems = ref([
  { id: "mm-1", text: "发布一律走灰度：先 10% 流量观察 30 分钟", category: "工作流" },
  { id: "mm-2", text: "commit message 与代码注释使用中文", category: "偏好" },
  { id: "mm-3", text: "主仓库在 ~/code/vuagent，pnpm monorepo 结构", category: "项目" },
  { id: "mm-4", text: "回复先给结论，细节放附录", category: "偏好" },
  { id: "mm-5", text: "每周四 10:00 周例会，勿安排发版窗口", category: "工作流", paused: true },
]);
const memoryLog = ref("");

function handleMemoryEdit(id, text) {
  memoryLog.value = `编辑记忆 ${id}：${text}`;
}

function handleMemoryPause(id, paused) {
  memoryLog.value = `${paused ? "暂停" : "恢复"}记忆 ${id}`;
}

function handleMemoryForget(id) {
  memoryLog.value = `遗忘记忆 ${id}（可在托盘撤销）`;
}

function handleMemoryRestore(items) {
  memoryLog.value = `撤销遗忘，恢复 ${items.length} 条记忆`;
}

// ---------- 12. 文件树 ----------
const repoTree = ref([
  {
    path: "apps/api",
    type: "dir",
    children: [
      { path: "apps/api/src/export/order-export.service.ts", status: "modified" },
      { path: "apps/api/src/export/export-cursor.ts", status: "added" },
      { path: "apps/api/src/export/legacy-sync-writer.ts", status: "deleted" },
    ],
  },
  {
    path: "apps/web",
    type: "dir",
    children: [
      { path: "apps/web/src/views/OrderExport.vue", status: "modified" },
      { path: "apps/web/src/composables/useExportPolling.ts", status: "added" },
    ],
  },
  { path: "docs/export-guide.md", status: "modified" },
  { path: "scripts/bench-export.mjs", status: "untracked" },
]);
const selectedPath = ref("apps/api/src/export/order-export.service.ts");

function handleTreeSelected(path) {
  if (path) selectedPath.value = path;
}

function handleTreeOpen(node) {
  if (node.type !== "dir") selectedPath.value = node.path;
}

// ---------- 13. 检查点列表 ----------
const cpBase = Date.now();
const checkpoints = ref([
  { id: "cp-4", label: "重构完成：导出主循环改为流式分批", createdAt: cpBase - 6 * 60 * 1000, summary: "4 个文件 · +186 −92", current: true },
  { id: "cp-3", label: "补充 5 万行大数据集回归用例", createdAt: cpBase - 18 * 60 * 1000, files: 2, additions: 64, deletions: 3 },
  { id: "cp-2", label: "初版游标分页落地", createdAt: cpBase - 32 * 60 * 1000, files: 3, additions: 52, deletions: 18 },
  { id: "cp-1", label: "定位根因：order_item 全表扫描", createdAt: cpBase - 51 * 60 * 1000, files: 1, additions: 12, deletions: 4 },
]);
const restoringId = ref("");
const previewedId = ref("");

function handleCheckpointRestore(id) {
  restoringId.value = id;
}

function handleCheckpointPreview(id) {
  previewedId.value = id;
}

// ---------- 14. 变更摘要 ----------
const summaryFiles = ref([
  { path: "apps/api/src/export/order-export.service.ts", status: "modified", additions: 86, deletions: 72 },
  { path: "apps/api/src/export/export-cursor.ts", status: "added", additions: 64, deletions: 0 },
  { path: "apps/api/src/export/legacy-sync-writer.ts", status: "deleted", additions: 0, deletions: 58 },
  { path: "apps/web/src/views/OrderExport.vue", status: "modified", additions: 22, deletions: 9 },
  { path: "apps/web/src/composables/useExportPolling.ts", status: "added", additions: 41, deletions: 0 },
  { path: "docs/export-guide.md", status: "modified", additions: 15, deletions: 6 },
]);
const openedFile = ref("");
const summaryFinishedAt = Date.now() - 2 * 60 * 1000;

function handleOpenSummaryFile(file) {
  openedFile.value = file.path;
}

function handleSummaryToggleAll() {
  // 展开/收起长列表，折叠态由组件内部维护
}
</script>

# Agent-Ops 旗舰操作组件

> Agent Ops 组件是 Vuagent 的核心灵魂。它们为大模型的自主运行过程赋予了清晰的可视化掌控力：计划追踪、风险审批门、工具调用链、代码差异与上下文水位。

---

## 1. VaApprovalCard — 人机协同审批门

当 Agent 触发高风险工具（如执行 Shell、写文件、线上退款）时，通过挂起协程向前端下发审批卡片。支持倒计时熔断、风险等级标识、快捷键提示与审批结果回执。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">实时交互预览（点击【批准】或【拒绝】查看效果）</div>
  <VaApprovalCard
    title="Agent 申请执行系统级 Shell 命令"
    detail="检测到潜在高危操作：准备清理 /tmp 缓存并重启守护进程。"
    preview="rm -rf /tmp/cache/* && systemctl restart app-worker"
    risk="high"
    :countdown="120"
    shortcuts
    :status="approvalStatus"
    :reason="approvalReason"
    @approve="handleApprove"
    @deny="handleDeny"
  />
</div>

### 代码示例

```vue
<script setup lang="ts">
import { ref } from "vue";
import { VaApprovalCard } from "@vuagent/ui";

const status = ref<"pending" | "approved" | "denied">("pending");

function onApprove() {
  status.value = "approved";
  // 提交 POST /api/action/:id 唤醒服务端
}

function onDeny(reason?: string) {
  status.value = "denied";
}
</script>

<template>
  <VaApprovalCard
    title="Agent 申请执行系统级 Shell 命令"
    detail="检测到潜在高危操作：准备清理 /tmp 缓存并重启守护进程。"
    preview="rm -rf /tmp/cache/* && systemctl restart app-worker"
    risk="high"
    :countdown="120"
    :status="status"
    @approve="onApprove"
    @deny="onDeny"
  />
</template>
```

---

## 2. VaAgentPlan — 任务执行计划卡片

展示多步骤任务的拆解执行状态，各步骤支持 `pending`（等待）、`running`（进行中实时计时）、`done`（完成耗时）与 `error`（失败）。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">实时执行中效果预览</div>
  <VaAgentPlan
    title="依赖升级与自动化发版流水线"
    :steps="planSteps"
  />
</div>

### 代码示例

```vue
<script setup lang="ts">
import { ref } from "vue";
import { VaAgentPlan } from "@vuagent/ui";

const steps = ref([
  { id: "1", title: "扫描项目依赖与漏洞", status: "done", duration: 820 },
  { id: "2", title: "升级 package.json 中的核心依赖版本", status: "running", startedAt: Date.now() - 3400 },
  { id: "3", title: "运行全量自动化测试套件 (pnpm test)", status: "pending" },
]);
</script>

<template>
  <VaAgentPlan title="发版计划" :steps="steps" />
</template>
```

---

## 3. VaToolCallCard — 工具调用卡片

展示工具调用的参数与返回结果，支持成功、错误、执行中三种状态，自带折叠展开与计时测量。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">工具调用执行成功卡片</div>
  <VaToolCallCard
    name="search_web"
    summary="查询 Vue 3.5 响应式系统更新日志"
    status="success"
    :args="{ query: 'Vue 3.5 changelog reactive memory optimization', maxResults: 5 }"
    :result="{ matched: 12, topUrl: 'https://blog.vuejs.org/posts/vue-3-5' }"
    :duration="760"
    default-open
  />
</div>

### 代码示例

```vue
<template>
  <VaToolCallCard
    name="search_web"
    summary="查询 Vue 3.5 响应式更新"
    status="success"
    :args="{ query: 'Vue 3.5' }"
    :duration="760"
    default-open
  />
</template>
```

---

## 4. VaContextWindow — 上下文仪表

实时呈现当前 Agent 的 Token 上下文水位，支持按系统提示、历史会话、工具定义三段彩色分段展示。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">Token 水位进度仪表</div>
  <VaContextWindow
    :prompt-tokens="13200"
    :completion-tokens="1800"
    :context-window="32768"
    :parts="contextParts"
  />
</div>

---

## 5. VaCodeDiff — 代码差异比对

大模型生成代码修改建议时，以红绿两色直观呈现修改前后的对比差异。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">代码 Diff 差异高亮效果</div>
  <VaCodeDiff
    file-name="src/utils/calculator.ts"
    :old-text="oldCode"
    :new-text="newCode"
  />
</div>

---

## 6. VaTerminalLog — 终端控制台日志

展示 Agent 执行 Shell 命令或构建过程中的标准输出流，支持命令高亮、错误染色与成功标识。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">终端命令行日志效果</div>
  <VaTerminalLog
    title="pnpm build 执行日志"
    :lines="terminalLines"
  />
</div>

---

## 7. VaTrajectory — 轨迹视图

对齐 dsh 形态的轨迹视图：输入 / 模型 / 工具三泳道时间线，外加扁平事件台账。`splitDetail` 开启主从模式，点击台账行即可在右侧详情区查看完整参数与结果。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">两轮排查修复会话：点击台账行查看右侧完整详情</div>
  <VaTrajectory
    :events="trajEvents"
    :ledger-max-height="300"
    split-detail
    @select="handleTrajSelect"
  />
</div>

---

## 8. VaDecisionInbox — 业务决策收件箱

需要人拍板的业务决策列表：每条决策给出主 / 次两个答案，选定后确认并折叠离开列表，`@decide` 回调携带决策对象与所选答案。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">三条待拍板决策：点击「立即发布」或「再观察」查看选定反馈</div>
  <VaDecisionInbox
    :decisions="decisionItems"
    @decide="handleDecide"
  />
</div>

---

## 9. VaAgentInbox — 后台任务收件箱

后台 Agent 任务收件箱：过滤 tab 带计数、进行中任务实时计时、行展开查看最近步骤，失败任务可直接重试，排队任务可取消。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">五种状态并存的任务列表：展开行查看步骤，失败任务可重试</div>
  <VaAgentInbox
    :tasks="inboxTasks"
    @open="handleInboxOpen"
    @retry="handleInboxRetry"
    @cancel="handleInboxCancel"
  />
</div>

---

## 10. VaInlineDiff — 行内差异

AI 文案修改的逐词接受 / 拒绝视图：基于 CJK 逐字分词的零依赖 diff，支持撤销栈，全部决断后通过 `@apply` 回调携带合成后的最终文本。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">AI 润色产品文案：逐词点选接受或拒绝，全部决断后应用</div>
  <VaInlineDiff
    title="营销落地页文案润色建议"
    :original="copyOriginal"
    :revised="copyRevised"
    @apply="handleApply"
  />
</div>

---

## 11. VaMemoryPanel — 记忆面板

助手长期记忆的管理面板：按分类过滤、就地编辑、暂停 / 遗忘（遗忘进入可撤销托盘），`undoMs` 控制撤销窗口时长。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">五条长期记忆：可编辑、暂停或遗忘，遗忘后 6 秒内可撤销</div>
  <VaMemoryPanel
    v-model:enabled="memoryEnabled"
    :memories="memoryItems"
    :undo-ms="6000"
    @edit="handleMemoryEdit"
    @pause="handleMemoryPause"
    @forget="handleMemoryForget"
    @restore="handleMemoryRestore"
  />
</div>

---

## 12. VaFileTree — 文件树

带变更标记的文件树：M / A / D / U 徽章、目录折叠与变更计数、方向键导航。受控 `selected` 配合 `@update:selected` 即可实现 `v-model:selected`。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">本轮导出重构的 6 处变更：点选文件行查看选中反馈</div>
  <VaFileTree
    :tree="repoTree"
    :selected="selectedPath"
    :max-height="300"
    title="本轮变更：6 个文件"
    @update:selected="handleTreeSelected"
    @open="handleTreeOpen"
  />
</div>

---

## 13. VaCheckpointList — 检查点列表

检查点 / 回滚时间线：每步快照的变更摘要与相对时间、当前位标记、diff 预览入口，恢复按钮带二次确认，`restoring` 对应项显示进行态。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">四个回滚检查点：点击「预览」看差异入口，恢复需二次确认</div>
  <VaCheckpointList
    :checkpoints="checkpoints"
    :restoring="restoringId"
    :max-height="300"
    confirm-label="确认回滚到此检查点？"
    @restore="handleCheckpointRestore"
    @preview="handleCheckpointPreview"
  />
</div>

---

## 14. VaChangeSummary — 变更摘要

Agent 一轮工作的变更摘要卡：文件数与增删行数统计、耗时与工具调用次数、逐文件行（状态徽章 + 增删计数），超过 `maxFiles` 的长列表自动折叠。

### 交互效果预览

<div class="demo-preview vp-raw">
  <div class="demo-title">一轮导出重构的收尾摘要：点击文件行联动预览，长列表可展开</div>
  <VaChangeSummary
    title="订单导出接口流式重构"
    :files="summaryFiles"
    :duration="214000"
    :tool-calls="23"
    :finished-at="summaryFinishedAt"
    :max-files="4"
    @open-file="handleOpenSummaryFile"
    @toggle-all="handleSummaryToggleAll"
  />
</div>
