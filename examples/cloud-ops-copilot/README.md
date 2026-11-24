# CloudOps Copilot · vuagent 场景实践案例

> **在现有 Vue 3 业务大盘中，通过自定义工具 + Generative UI + 人工审批 (HITL) 打造企业级云原生运维副驾驶。**

---

## 📖 案例背景与设计理念

在这个案例中，我们模拟了一个真实的**企业级微服务治理监控平台 (CloudOps)**。系统核心功能包含服务运行监控、指标展示与故障处理。

通过接入 `@vuagent/ui` 与 `@vuagent/server`，我们在系统右侧无缝嵌入了一个智能运维 Copilot：

1. **调用真实 Server 链路**：完全基于真实 Harness Server、真实 SSE 事件流和真实的大模型 Tool Calling 执行链路。
2. **场景数据解耦**：自定义运维工具（`ops_inspect_cluster`、`ops_scale_replicas`）内部组装高仿真的集群指标与拓扑数据，**无需配置真实的 Kubernetes 集群凭据即可开箱体验**。
3. **Generative UI**：大模型调用工具后，不再吐出枯燥冰冷的 JSON 文本，而是原地分发挂载定制的业务卡片（`ClusterHealthCard.vue` 与 `CanaryDeployCard.vue`）。
4. **安全引擎阻断 (HITL)**：微服务实例扩容属于生产高危写操作，服务端安全引擎自动识别并阻断为 `action_suspended`，在界面呼出 `<VaApprovalCard>` 经由人类工程师点击批准（或驳回）后才继续执行。

---

## 🏗️ 整体架构

本案例由两个进程组成，由根目录的 `pnpm example:ops` 一键同时拉起：

```text
浏览器 (http://localhost:6991)
   │
   │  CloudOps 业务大盘 + 右侧 Copilot 抽屉（Vue 3 + Vite，本目录）
   │  ── 消费 SSE 事件流，动态挂载 Generative UI 卡片
   │
   ▼ /api/* 由 Vite dev server 代理转发
examples/server（Harness Server，http://localhost:6881）
   │  createHarnessServer({ dbPath, customTools, security })
   │  ── 注册 ops_inspect_cluster / ops_scale_replicas 场景工具
   │  ── 复用 Console 的模型配置数据库，开箱即用
   ▼
大模型供应商 API（模型 Profile 在 Console 中配置一次即可）
```

> 服务端进程的详细说明（共享数据库、环境变量、如何新增工具）见 [`examples/server/README.md`](../server/README.md)。

---

## 🚀 1 分钟快速启动

在代码库根目录下执行一条命令即可同时启动 Harness Server 与 Example 前端：

```bash
# 启动云运维 Copilot 实践案例（包含 Harness Server 与前端界面）
pnpm example:ops
```

启动完成后，浏览器访问：**`http://localhost:6991`**。

也可以分别单独启动两个进程：

```bash
pnpm example:server   # 仅启动 Harness Server (http://localhost:6881)
pnpm --filter cloud-ops-copilot dev   # 仅启动前端 (http://localhost:6991)
```

> 前置条件：模型供应商信息（API Key / 端点 / 模型）已在 Playground Console 中配置过一次——Example Server 会直接复用 `packages/server/.vuagent/harness.db` 中的配置；也可通过 `DB_PATH` 环境变量指向自己的数据库。

---

## 🎯 推荐演练场景

打开页面后，右侧会自动呼出 **CloudOps Copilot** 抽屉，你可以通过顶部的场景 Chip 按钮一键体验核心闭环：

### 场景一：只读智能巡检（Generative UI）
1. 点击输入框上方的 **`🔍 巡检订单服务状态`**；
2. 大模型意图识别命中 `ops_inspect_cluster` 工具；
3. 服务端返回仿真集群指标，消息流中原地渲染 **`ClusterHealthCard.vue`**：
   - 直观呈现该微服务的 CPU (78%) 与内存 (94% 警戒高危) 水位；
   - 呈现 2 个 Pod 实例的分布与告警提示；
   - 给出进行水平扩容 (HPA) 的建议。

> 此外，左侧大盘中每个微服务卡片上的 **「调用 Copilot 巡检」** 按钮也会以自然语言驱动同一工具链路。

### 场景二：生产高危写操作与审批阻断（HITL 闭环）
1. 点击输入框上方的 **`⚡ 扩容至 5 副本 (审批)`**；
2. 大模型调用写操作工具 `ops_scale_replicas(serviceName: "order-service", targetReplicas: 5)`；
3. **安全拦截生效**：服务端安全引擎检测到 `requiresApproval: true`，立即挂起任务流；
4. 前端原地弹出 **`<VaApprovalCard>`**，等待人工审核；
5. 点击**【批准】**按钮：
   - 审批决策经 `POST /api/action/:actionId` 回传，唤醒服务端执行链；
   - 消息流中动态分发渲染 **`CanaryDeployCard.vue`**，展示 2 副本平滑扩容到 5 副本的阶段探针健康检查（5/5 Ready）与就绪日志！
6. 点击**【驳回】**：同样回传决策，任务流按拒绝语义终止，不留悬挂中的高危操作。

---

## 🛠️ 关键实现代码速查

### 1. 注册业务场景组件 (`src/main.ts`)
```ts
import { createApp } from "vue";
import "@vuagent/ui/tokens.css";
import "./styles/app.css";
import App from "./App.vue";
import { registerCardComponent } from "@vuagent/ui";
import ClusterHealthCard from "./cards/ClusterHealthCard.vue";
import CanaryDeployCard from "./cards/CanaryDeployCard.vue";

// 告诉 vuagent：当模型调用工具返回 ui_cluster_health / ui_canary_deploy 时，
// 消息流动态挂载对应业务卡片
registerCardComponent("ui_cluster_health", ClusterHealthCard);
registerCardComponent("ui_canary_deploy", CanaryDeployCard);

createApp(App).mount("#app");
```

### 2. 嵌入 Copilot 对话与审批 (`src/App.vue`)
```vue
<script setup lang="ts">
import {
  VaComposer,
  VaApprovalCard,
  VaUserBubble,
  VaAssistantTurn,
  useStickToBottom,
  getCardComponent,
} from "@vuagent/ui";

const turns = ref<ChatTurn[]>([]);
const chatScrollRef = useTemplateRef<HTMLElement>("chatScrollRef");
const { scrollToBottom } = useStickToBottom(chatScrollRef);

// 发送 Prompt 驱动真实 Harness Server（permission: "review" 开启敏感操作阻断审批）
async function handleSend(customPrompt?: string) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, sessionId, permission: "review" }),
  });
  // 逐块读取 SSE 流，按事件类型增量更新 turn（text_delta / tool_call_result / suspended ...）
  await consumeSSEStream(res.body!, assistantTurn);
}

// 提交审批决策：唤醒挂起的服务端执行链（或按拒绝语义终止）
async function handleApproval(turn: ChatTurn, approved: boolean, reason?: string) {
  await fetch(`/api/action/${turn.approval!.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, reason, note: reason }),
  });
}
</script>

<template>
  <aside class="copilot-drawer">
    <!-- 消息流：用户气泡 + 助手时序轮次 -->
    <div ref="chatScrollRef" class="copilot-messages">
      <template v-for="turn in turns" :key="turn.id">
        <VaUserBubble v-if="turn.role === 'user'" :content="turn.text" avatar="你" />

        <VaAssistantTurn v-else :content="turn.text" :thought="turn.thought" :streaming="...">
          <!-- 业务卡片动态渲染 (Generative UI) -->
          <component
            :is="getCardComponent(card.component)"
            v-for="card in turn.cards"
            :key="card.id"
            v-bind="card.props"
          />

          <!-- 高危操作审批拦截卡片 (HITL)：支持批准与驳回 -->
          <VaApprovalCard
            v-if="turn.approval"
            :title="turn.approval.title"
            :detail="turn.approval.detail"
            :risk="turn.approval.risk"
            @approve="() => handleApproval(turn, true)"
            @deny="(reason) => handleApproval(turn, false, reason)"
          />
        </VaAssistantTurn>
      </template>
    </div>

    <!-- 输入区 -->
    <VaComposer v-model:text="composerText" :disabled="isStreaming" @send="() => handleSend()" />
  </aside>
</template>
```

### 3. 消费 SSE 事件流 (`src/App.vue`)
前端按事件类型增量收敛渲染状态，核心分支：

| 事件 | 处理方式 |
|---|---|
| `text_delta` / `thought_delta` | 追加正文 / 思考链文本，实现流式打字效果 |
| `tool_call_result` | 结果带 `rendered: true, component, props` 时，推入 `turn.cards` 触发动态卡片挂载 |
| `suspended` / `action_suspended` | 高危操作被安全引擎挂起，弹出 `<VaApprovalCard>` 等待人工决策 |
| `resumed` / `action_resumed` | 审批通过后执行链唤醒，标记审批状态并继续消费后续事件 |
| `error` / `turn_finish` | 错误信息落盘展示 / 结束流式状态 |

---

## 📁 目录结构

```text
examples/cloud-ops-copilot/
├── index.html                        # Vite 入口
├── vite.config.ts                    # dev 端口 6991，/api 代理到 localhost:6881
├── package.json
└── src/
    ├── main.ts                       # 注册 Generative UI 场景卡片
    ├── App.vue                       # 业务大盘 + Copilot 抽屉（SSE 消费 / HITL 审批）
    ├── cards/
    │   ├── ClusterHealthCard.vue     # 集群健康巡检卡片 (ui_cluster_health)
    │   └── CanaryDeployCard.vue      # 扩容部署进度卡片 (ui_canary_deploy)
    └── styles/app.css                # 宿主业务样式
```
