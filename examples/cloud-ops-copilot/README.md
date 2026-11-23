# CloudOps Copilot · vuagent 场景实践案例

> **在现有 Vue 3 业务大盘中，通过自定义工具 + Generative UI + 人工审批 (HITL) 打造企业级云原生运维副驾驶。**

---

## 📖 案例背景与设计理念

在这个案例中，我们模拟了一个真实的**企业级微服务治理监控平台 (CloudOps)**。系统核心功能包含服务运行监控、指标展示与故障处理。

通过接入 `@vuagent/ui` 与 `@vuagent/server`，我们在系统右侧无缝嵌入了一个智能运维 Copilot：
1. **调用真实 Server 链路**：完全基于真实 Harness Server、真实 SSE 事件流和真实的大模型 Tool Calling 执行链路。
2. **场景数据解耦**：自定义运维工具（`ops_inspect_cluster`、`ops_scale_replicas`）内部组装高仿真的集群指标与拓扑数据，**无需配置真实的 Kubernetes 集群凭据即可开箱体验**。
3. **Generative UI**：大模型调用工具后，不再吐出枯燥冰冷的 JSON 文本，而是原地分发挂载定制的业务卡片（`ClusterHealthCard.vue` 与 `CanaryDeployCard.vue`）。
4. **安全引擎阻断 (HITL)**：微服务实例扩容属于生产高危写操作，服务端安全引擎自动识别并阻断为 `action_suspended`，在界面呼出 `<VaApprovalCard>` 经由人类工程师点击批准后才真正落地。

---

## 🚀 1 分钟快速启动

在代码库根目录下执行一条命令即可同时启动 Harness Server 与 Example 前端：

```bash
# 启动云运维 Copilot 实践案例（包含 Harness Server 与前端界面）
pnpm example:ops
```

启动完成后，浏览器访问：**`http://localhost:6991`**。

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

### 场景二：生产高危写操作与审批阻断（HITL 闭环）
1. 点击输入框上方的 **`⚡ 扩容至 5 副本 (审批)`**；
2. 大模型调用写操作工具 `ops_scale_replicas(serviceName: "order-service", targetReplicas: 5)`；
3. **安全拦截生效**：服务端安全引擎检测到 `requiresApproval: true`，立即挂起任务流；
4. 前端原地弹出 **`<VaApprovalCard>`**，等待人工审核；
5. 点击**【批准】**按钮：
   - 唤醒服务端执行链；
   - 消息流中动态分发渲染 **`CanaryDeployCard.vue`**，展示 2 副本平滑扩容到 5 副本的阶段探针健康检查（5/5 Ready）与就绪日志！

---

## 🛠️ 关键实现代码速查

### 1. 注册业务场景组件 (`src/main.ts`)
```ts
import { registerCardComponent } from "@vuagent/ui";
import ClusterHealthCard from "./cards/ClusterHealthCard.vue";
import CanaryDeployCard from "./cards/CanaryDeployCard.vue";

// 告诉 vuagent：当模型输出 ui_cluster_health 时，动态挂载 ClusterHealthCard
registerCardComponent("ui_cluster_health", ClusterHealthCard);
registerCardComponent("ui_canary_deploy", CanaryDeployCard);
```

### 2. 嵌入 Copilot 对话与审批 (`src/App.vue`)
```vue
<template>
  <aside class="copilot-drawer">
    <!-- 消息流与动态组件渲染 -->
    <div class="copilot-messages">
      <div v-for="turn in turns" :key="turn.id">
        <!-- 文本回复 -->
        <p v-if="turn.text">{{ turn.text }}</p>
        
        <!-- 业务卡片渲染 -->
        <component
          :is="getCardComponent(card.component)"
          v-for="card in turn.cards"
          :key="card.id"
          v-bind="card.props"
        />

        <!-- 审批阻断拦截卡片 -->
        <VaApprovalCard
          v-if="turn.approval"
          :title="turn.approval.title"
          :detail="turn.approval.detail"
          risk="high"
          @approve="handleApprove(turn)"
        />
      </div>
    </div>

    <!-- 输入区 -->
    <VaComposer v-model:text="prompt" @send="handleSend" />
  </aside>
</template>
```
