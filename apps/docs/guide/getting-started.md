# 快速开始

## 安装

```bash
npm i @vuagent/ui
```

## 引入

```ts
// main.ts
import { createApp } from "vue";
import "@vuagent/ui/tokens.css"; // 设计令牌（亮暗双主题）
import App from "./App.vue";

createApp(App).mount("#app");
```

```vue
<script setup lang="ts">
import { VaButton, VaToolCallCard } from "@vuagent/ui";
</script>

<template>
  <VaButton>开始任务</VaButton>
  <VaToolCallCard name="search_web" status="success" :args="{ query: 'vue3' }" :duration="830" />
</template>
```

## 单文件拷贝（shadcn-vue registry）

在宿主项目 `components.json` 注册 registry 后按名安装，文件落到 `components/ui/<name>/`：

```json
{
  "registries": {
    "@vuagent": "https://your-registry-host/{name}.json"
  }
}
```

```bash
npx shadcn-vue add @vuagent/approval-card
```

## 给 AI 编码工具

把 `llms.txt` / `llms-full.txt` 挂到站点根路径，Claude Code / Cursor 即可自主检索并安装组件；也可接入 MCP server（规划中）。
