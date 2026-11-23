<script setup lang="ts">
import { ref } from "vue";
import {
  VaApprovalCard,
  VaAgentPlan,
  VaToolCallCard,
  VaContextWindow,
  VaCodeDiff,
  VaTerminalLog,
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
  { text: "$ pnpm build", kind: "cmd" },
  { text: "vite v5.4.0 building for production...", kind: "stdout" },
  { text: "transforming (42) src/index.ts", kind: "stdout" },
  { text: "warning: chunk size exceeds 500 kB", kind: "warn" },
  { text: "✓ built in 1.24s", kind: "ok" },
];
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
