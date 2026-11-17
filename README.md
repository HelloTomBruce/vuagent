# Vuagent

[![npm](https://img.shields.io/npm/v/@vuagent/ui)](https://www.npmjs.com/package/@vuagent/ui)
[![docs](https://img.shields.io/badge/docs-hellotombruce.github.io%2Fvuagent-c2410c)](https://hellotombruce.github.io/vuagent/)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

> Vue 生态第一个 Agent Ops 组件库：为 AI agent 产品的运行时操作界面（计划 / 审批 / 工具调用 / 上下文 / 收件箱）而生的 Vue 3 组件库。

## 定位

AI agent 产品的前端缺的不是通用 UI 库，而是**运行时操作界面**：agent 的执行计划怎么展示？危险操作谁来审批？工具调用链、上下文水位、后台任务收件箱长什么样？Vuagent 把这一层沉淀为 43+ 个强类型 Vue 3 组件（68 个 registry 条目）：

- **薄模板 + 独立样式 + 强类型 + composable 逻辑**——每个组件一个目录，可整包安装也可单文件拷贝；
- **零运行时依赖**——peer 仅 `vue ^3.5`，图标已随构建内联，装完即用；
- **亮暗双主题**——`:root` 上的 `--va-*` 设计令牌一键换肤，跟随 `[data-theme="dark"]` / `.dark`；
- **动效尊重系统**——全部动效尊重 `prefers-reduced-motion`。

## 组件速览

| 分类 | 一句话 | 代表组件 |
|---|---|---|
| [Agent-Ops](https://hellotombruce.github.io/vuagent/components/trajectory) | 轨迹 / 计划 / 审批 / 上下文 / 收件箱 / 代码变更 | VaTrajectory · VaAgentPlan · VaApprovalCard · VaContextWindow · VaCodeDiff · VaTerminalLog |
| [Chat](https://hellotombruce.github.io/vuagent/components/agent-chat) | 对话页骨架 / 输入 / 会话管理 / 流式回答 | VaAgentChat · VaComposer · VaSessionTree · VaStreamAnswer |
| [基础](https://hellotombruce.github.io/vuagent/components/button) | 按钮 / 分段控件 / 全局通知 / 骨架 / 命令面板 | VaButton · VaSegmentedControl · VaToaster · VaCommandMenu |
| [动效](https://hellotombruce.github.io/vuagent/components/text-reveal) | 入场 / 背景 / 3D 倾斜 / 模糊过渡 | VaTextReveal · VaGridBackground · VaTiltCard |
| [表单](https://hellotombruce.github.io/vuagent/components/stepper-form) | 分步表单 / 引导清单 / 日期范围 / 集成配置 | VaStepperForm · VaSetupGuide · VaDateRangePicker |
| [反馈](https://hellotombruce.github.io/vuagent/components/notification-stack) | 建议卡 / 通知中心 / 反应条 | VaSmartRecommendation · VaNotificationStack |
| [图表](https://hellotombruce.github.io/vuagent/components/kpi-chart) | 零依赖手写 SVG 指标 / 分布 / 实验 / 引用回答 | VaKpiChart · VaBreakdownChart · VaAiAnswer |
| [Screens](https://hellotombruce.github.io/vuagent/components/app-shell) | 页面级骨架：外壳 / 对话页 / 运行页 / 引导页 | VaAppShell · VaAgentRun · VaOnboarding |
| [Blocks](https://hellotombruce.github.io/vuagent/components/task-board) | 组合块：任务看板 / 定价卡 / AI 工作区 | VaTaskBoard · VaPricingPlans |
| [Illustrations](https://hellotombruce.github.io/vuagent/components/illustrations) | 纯装饰插画：语音球 / 团队环 / 模型轮盘 | VaVoiceOrb · VaAgentTeam · VaModelWheel |

全部组件的 props 明细见[文档站](https://hellotombruce.github.io/vuagent/)或 [`llms-full.txt`](https://hellotombruce.github.io/vuagent/llms-full.txt)。

## 安装（三条通道）

### ① npm 整包

```bash
npm i @vuagent/ui
```

```ts
// main.ts
import { createApp } from "vue";
import "@vuagent/ui/tokens.css"; // 设计令牌（亮暗双主题）
import "@vuagent/ui/styles.css"; // 全部组件样式
import App from "./App.vue";

createApp(App).mount("#app");
```

```vue
<script setup lang="ts">
import { VaButton, VaToolCallCard } from "@vuagent/ui";
</script>

<template>
  <VaButton variant="primary" size="md">开始任务</VaButton>
  <VaToolCallCard name="search_web" status="success" :args="{ query: 'vue3' }" :duration="830" />
</template>
```

### ② shadcn-vue registry（单文件拷贝）

不想引入整包？在宿主项目 `components.json` 注册 registry，按名安装后文件直接落到 `components/ui/<name>/`，样式随文件内联、可自由改造：

```json
{
  "registries": {
    "@vuagent": "https://hellotombruce.github.io/vuagent/r/{name}.json"
  }
}
```

```bash
npx shadcn-vue add @vuagent/approval-card
```

每个条目自包含：依赖的共享 composables/utils 已内联进文件，组件间依赖经 `registryDependencies` 自动携带。

### ③ llms.txt（给 AI 编码工具）

把 [llms.txt](https://hellotombruce.github.io/vuagent/llms.txt) / [llms-full.txt](https://hellotombruce.github.io/vuagent/llms-full.txt) 挂在站点根路径，Claude Code / Cursor 等 AI 编码工具即可自主检索组件能力清单并选择安装通道；也可直接把这两个文件喂给任何 agent。

## 本地开发

```bash
pnpm install

pnpm console        # 本地 Agent 控制台（server + playground 双进程）
pnpm registry       # 重新生成 shadcn registry 工件（packages/ui/registry/）
pnpm registry:check # registry 自包含校验（悬空相对引用扫描）
pnpm llms           # 重新生成 llms.txt / llms-full.txt
pnpm docs:dev       # 文档站本地开发
pnpm test           # 全仓测试
pnpm typecheck      # 全仓类型检查
pnpm build          # 构建组件库与 playground
```

架构与设计细节见 [`plan.md`](./plan.md) 与 `apps/docs`（DESIGN.md）。

## License

[MIT](./LICENSE)
