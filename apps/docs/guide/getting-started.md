# 快速接入现有 Vue 项目

> 本文将指导你如何在现有的 Vue 3 业务系统（后台管理系统、SaaS 平台、业务门户等）中，快速增加一个智能 Agent 聊天与交互界面。

Vuagent 的界面层设计遵循 **轻量、无侵入、强类型** 的原则，peer 依赖仅需要 `vue ^3.5`。它不会污染你现有的全局样式，并且可以和 Element Plus、Ant Design Vue、Tailwind CSS 等主流前端生态无缝共存。

---

## 1. 安装与全局样式引入

提供两种安装分发方式，根据团队工程规范选择：

::: code-group

```bash [方式 A：npm 整包安装 (推荐)]
# 安装界面层核心包
npm i @vuagent/ui
# 或使用 pnpm
pnpm add @vuagent/ui
```

```bash [方式 B：shadcn-vue 单文件源码拷贝]
# 在项目的 components.json 中配置 @vuagent registry
# 文件将直接生成到 components/ui/<name>/，你可以自由修改源码
npx shadcn-vue add @vuagent/agent-chat
```

:::

### 引入全局设计令牌与组件样式

在现有项目的入口文件（如 `main.ts`）中引入样式：

```ts
// main.ts
import { createApp } from "vue";
import App from "./App.vue";

// 1. 引入设计令牌（包含亮暗双主题变量）
import "@vuagent/ui/tokens.css";
// 2. 引入组件全局样式（若采用 shadcn 源码拷贝则无需此行）
import "@vuagent/ui/styles.css";

const app = createApp(App);
app.mount("#app");
```

> [!TIP] 主题切换
> 设计令牌默认跟随 `:root`。若现有项目支持暗黑模式，只需在 `<html>` 或容器节点加上 `class="dark"` 或 `data-theme="dark"`，所有 Vuagent 组件将自动平滑换肤。

---

## 2. 嵌入 Agent 界面（两种形态）

你可以根据业务布局需要，选择「**全页面级嵌入**」或「**侧边抽屉/弹窗嵌入**」。

### 形态 A：使用开箱即用的 `VaAgentChat`（页面级）

如果需要在现有系统中增加一个独立的 Agent 页面（例如 `/agent-workbench`）：

```vue
<!-- views/AgentView.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { VaAgentChat } from "@vuagent/ui";

// 连接的后端 Harness 服务地址（官方 server 或自定义后端）
const apiBaseUrl = "http://localhost:3001";
const currentSessionId = ref("session_demo_01");

function handleMessageSent(content: string) {
  console.log("用户发送消息:", content);
}
</script>

<template>
  <div class="agent-page-container">
    <VaAgentChat
      :api-base-url="apiBaseUrl"
      :session-id="currentSessionId"
      title="业务智能助手"
      placeholder="输入需求，例如：查询今日待审核退款单..."
      @send="handleMessageSent"
    />
  </div>
</template>

<style scoped>
.agent-page-container {
  height: calc(100vh - 64px); /* 适配现有系统的顶栏高度 */
  display: flex;
  flex-direction: column;
}
</style>
```

---

### 形态 B：底层灵活编排（在抽屉/弹窗中嵌入）

如果你希望将 Agent 作为现有业务界面的**侧边智能助手（Drawer / Copilot）**，可以使用 Vuagent 提供的核心流式状态机 Composable `useAgentChat` 自定义渲染：

```vue
<!-- components/CopilotDrawer.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { useAgentChat, VaAgentRenderer } from "@vuagent/ui";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits(["update:visible"]);

const inputPrompt = ref("");

// 初始化流式状态机
const { messages, isStreaming, sendMessage, currentAssistantMsg } = useAgentChat({
  apiBaseUrl: "http://localhost:3001",
  sessionId: "copilot_drawer_session",
  onError: (err) => {
    console.error("Agent 交互异常:", err);
  },
});

// 发送用户指令
async function handleSend() {
  if (!inputPrompt.value.trim() || isStreaming.value) return;
  const prompt = inputPrompt.value;
  inputPrompt.value = "";

  await sendMessage(prompt, {
    mode: "ask",
    safety: "review", // 敏感操作开启人机审批
  });
}
</script>

<template>
  <div v-if="visible" class="copilot-drawer">
    <div class="drawer-header">
      <h3>AI 业务副驾驶</h3>
      <button @click="emit('update:visible', false)">关闭</button>
    </div>

    <!-- 消息对话列表 -->
    <div class="drawer-body">
      <div v-for="msg in messages" :key="msg.id" :class="['message-row', msg.role]">
        <div class="avatar">{{ msg.role === 'user' ? '👤' : '🤖' }}</div>
        
        <div class="message-content">
          <!-- 1. 文本内容渲染 -->
          <div v-if="msg.content" class="text-bubble">{{ msg.content }}</div>

          <!-- 2. 结构化混排块（计划、审批门、业务卡片） -->
          <div v-if="msg.blocks && msg.blocks.length" class="blocks-container">
            <VaAgentRenderer
              v-for="block in msg.blocks"
              :key="block.id"
              :component-name="block.componentName"
              :tool-call-id="block.toolCallId"
              :args="block.args"
              :state="block.state"
              api-base-url="http://localhost:3001"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 底部输入框 -->
    <div class="drawer-footer">
      <input
        v-model="inputPrompt"
        :disabled="isStreaming"
        placeholder="向 Copilot 提问或指派任务..."
        @keydown.enter="handleSend"
      />
      <button :disabled="isStreaming" @click="handleSend">
        {{ isStreaming ? "执行中..." : "发送" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.copilot-drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 480px;
  background: var(--va-color-surface, #ffffff);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 1000;
}
.drawer-header {
  padding: 16px;
  border-bottom: 1px solid var(--va-color-border, #e5e7eb);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.drawer-footer {
  padding: 16px;
  border-top: 1px solid var(--va-color-border, #e5e7eb);
  display: flex;
  gap: 8px;
}
.drawer-footer input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--va-color-border, #d1d5db);
  border-radius: 6px;
}
</style>
```

---

## 3. 连接后端 Harness

`VaAgentChat` 和 `useAgentChat` 均需要指定 `apiBaseUrl`。你有两个选择：
1. **使用官方成熟的 `@vuagent/server`**：参考 [官方 Harness Server 指南](/server/overview)，本地一键拉起或 Docker 部署；
2. **连接公司既有的 Python / Go / Java 后端**：参考 [对接自定义后端指南](/protocol/custom-backend)，只需后端按照 `@vuagent/protocol` 输出标准 SSE 事件流即可。

---

## 4. 下一步：接入业务特有能力

仅仅展示普通的对话还只是起点。AI Agent 真正的生产力在于**结合业务系统的特定工具与页面**。
请继续阅读：
👉 [接入项目特有工具与自定义 UI](/guide/custom-tools-and-ui)
