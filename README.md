# Vuagent

[![npm](https://img.shields.io/npm/v/@vuagent/ui)](https://www.npmjs.com/package/@vuagent/ui)
[![docs](https://img.shields.io/badge/docs-hellotombruce.github.io%2Fvuagent-c2410c)](https://hellotombruce.github.io/vuagent/)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

> Vue 生态第一个 Agent Ops 工具箱：共享契约层 + 自研 Agent Harness 服务端 + 73 个运行时操作组件（计划 / 审批 / 工具调用 / 上下文 / 收件箱）。

## 定位

AI agent 产品缺的不是又一个聊天壳，而是完整的**运行时操作层**：agent 的执行计划怎么展示？危险操作谁来审批？工具调用链、上下文水位、后台任务收件箱长什么样？Vuagent 把这一层沉淀为三个包：**协议契约（@vuagent/protocol）→ 执行引擎（@vuagent/server）→ 操作界面（@vuagent/ui）**，关系见下节。

组件库本身坚持四件事：

- **薄模板 + 独立样式 + 强类型 + composable 逻辑**——每个组件一个目录，可整包安装也可单文件拷贝；
- **零运行时依赖**——peer 仅 `vue ^3.5`，图标已随构建内联，装完即用；
- **亮暗双主题**——`:root` 上的 `--va-*` 设计令牌一键换肤，跟随 `[data-theme="dark"]` / `.dark`；
- **动效尊重系统**——全部动效尊重 `prefers-reduced-motion`。

## 架构：三包一条链路

```text
                    @vuagent/protocol — 单一事实契约层（TypeBox Schema 即唯一来源）
                   /                                            \
      工具 Schema + 18 事件流契约                    组件生命周期模型（vendored 副本随包分发，
      一份 Schema 同时充当模型 parameters、             CI 卡口机械同步，任何漂移即失败）
      前端 Props 类型与序列化运行时校验                              │
                   │                                               ▼
                   ▼                                               │
   @vuagent/server ──────────── SSE 事件流 ───────────────▶ @vuagent/ui
   Agent Harness 服务端                                     Agent Ops 组件库（Vue 3）
   ReAct 循环 · HITL 审批挂起 · 工具沙箱                      73 个强类型组件
   会话检查点 · 断线重连 · 双轨可观测                         useAgentChat 流式状态机
                   ▲                                       注册表 + 动态渲染分发器
                   └────────── POST /api/action/:id ◀─────────┘
                        HITL 审批决策回传（唤醒挂起协程）
```

| 包 | 层 | 一句话 |
|---|---|---|
| [@vuagent/protocol](./packages/protocol/README.md) | 契约层 | TypeBox Schema 单一事实来源：18 事件流、10 个 ui_* 工具 + 8 个系统工具 Schema（含 finish_task 显式终态声明）、组件四态生命周期；schema 单向推导类型，杜绝双事实来源漂移 |
| [@vuagent/server](./packages/server/README.md) | 执行层 | 自研 Agent Harness：执行与 HTTP 连接解耦（断线重连/多端订阅）、权限交集 + deny-wins 审批、token 口径上下文压缩、诚实崩溃恢复、供应商 1:N 模型分层 |
| [@vuagent/ui](./packages/ui/README.md) | 界面层 | 73 个组件 + Agent Runtime 子系统（流式状态机 / 渲染分发器 / 动作回传），npm 整包与 shadcn-vue 单文件拷贝双通道分发 |

**一次对话的数据流**：宿主应用经 ui 的流式状态机发起请求 → server 的 ReAct 循环驱动模型与工具，执行过程以 `HarnessStreamEvent`（18 事件）经 SSE 推送 → ui 的渲染分发器把事件收敛为「文本块 + 组件块」混排流渐进渲染；高风险工具挂起等待审批，用户决策经 `/api/action` 回传唤醒执行链路。链路上的每一个字段都出自 protocol——三端永远对着同一份 Schema 说话。

[`apps/playground`](./apps/playground) 是三包集成的参考宿主：以 ui 组件 + protocol 契约构建，运行时经 HTTP/SSE 与 server 进程通信（本地 `pnpm console` 同时拉起两进程）——「界面与执行解耦」架构的活示例。内置的模型设置面板演示**供应商 1:N 模型分层**：端点与凭证在供应商层配置一次，其下挂载任意多模型；`/models/discover` 从供应商端点拉取模型列表并自动探测能力元数据（上下文窗口 / 输入模态 / 推理档位），附件入口等 UI 行为随能力声明联动。

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

各包的架构、设计与业务逻辑详见对应 README：[protocol](./packages/protocol/README.md) · [server](./packages/server/README.md) · [ui](./packages/ui/README.md)。早期方案推演存档于 [`tasks/plan.md`](./tasks/plan.md)，文档站源码在 `apps/docs`（含 DESIGN.md）。

## License

[MIT](./LICENSE)
