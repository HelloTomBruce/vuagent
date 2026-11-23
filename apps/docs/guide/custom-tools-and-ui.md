# 接入项目特有工具与自定义 UI

> AI Agent 产品缺的不是又一个聊天对话框，而是真正能**调用业务工具**并在界面上**呈现专属业务 UI** 的能力。

本指南将通过一个实际业务场景，演示如何在现有的 Vue 项目中：
1. 定义专属业务工具（Tool Schema）；
2. 编写专属业务 Vue 卡片组件；
3. 将卡片注册到 `VaAgentRenderer` 动态分发器；
4. 实现用户操作（点击审批/填写表单）回传服务端，闭环驱动业务。

---

## 业务场景示例：智能售后退款

假设你在开发一个电商售后后台。运营人员在 Agent 聊天框中输入：
> *“客户申请将订单 ORD-98231 退款 199 元，请核实并处理。”*

大模型分析后，触发业务专属工具 `ui_order_refund`。此时界面不能只是一行冷冰冰的 JSON，而是要在聊天流中原地弹出**定制的《退款审核卡片》**（展示订单详情、金额、退款原因，并提供【确认退款】和【驳回申请】按钮）。用户点击后，Agent 继续执行后续业务。

---

## 流程全景图

```text
 1. 模型决策调用工具 ui_order_refund (带参数: orderId, amount, reason)
                          │
                          ▼ (下发 SSE: tool_call_start / args_delta)
 2. 前端 VaAgentRenderer 捕获事件，查表命中已注册的 OrderRefundCard.vue
                          │
                          ▼
 3. 原地渲染退款审核卡片，用户在卡片上点击【确认退款】
                          │
                          ▼ (前端触发 actionClient.postAgentAction)
 4. POST /api/action/:toolCallId 唤醒服务端挂起的协程
                          │
                          ▼
 5. 服务端执行实际退款 API，ReAct 循环继续，Agent 回复：“已为您成功完成退款。”
```

---

## 第一步：编写业务特有的 Vue 卡片组件

新建一个标准的 Vue 3 组件，例如 `src/components/agent/OrderRefundCard.vue`。

卡片需要接收模型推导出的参数，并在用户点击时触发 `action` 事件：

```vue
<!-- src/components/agent/OrderRefundCard.vue -->
<script setup lang="ts">
import { computed } from "vue";

export interface OrderRefundProps {
  orderId?: string;
  amount?: number;
  reason?: string;
  state?: "streaming" | "executing" | "complete" | "error";
  readonly?: boolean;
}

const props = withDefaults(defineProps<OrderRefundProps>(), {
  orderId: "未知订单",
  amount: 0,
  reason: "未注明原因",
  state: "complete",
  readonly: false,
});

// 定义向外通知交互结果的 emit
const emit = defineEmits<{
  (e: "action", payload: { approved: boolean; note?: string }): void;
}>();

const formattedAmount = computed(() => `¥${props.amount.toFixed(2)}`);

function handleDecision(approved: boolean) {
  emit("action", {
    approved,
    note: approved ? "运营人员审核通过" : "退款金额或理由不符，驳回",
  });
}
</script>

<template>
  <div class="order-refund-card" :class="state">
    <div class="card-badge">售后业务卡片</div>
    
    <div class="card-header">
      <h4>退款审批确认</h4>
      <span class="order-no">{{ orderId }}</span>
    </div>

    <div class="card-body">
      <div class="data-row">
        <span class="label">申请退款金额：</span>
        <span class="value price">{{ formattedAmount }}</span>
      </div>
      <div class="data-row">
        <span class="label">退款原因：</span>
        <span class="value">{{ reason }}</span>
      </div>
    </div>

    <!-- 操作区：若已被操作过或为只读模式则置灰 -->
    <div v-if="!readonly && state !== 'streaming'" class="card-actions">
      <button class="btn btn-reject" @click="handleDecision(false)">驳回</button>
      <button class="btn btn-approve" @click="handleDecision(true)">确认退款</button>
    </div>
  </div>
</template>

<style scoped>
.order-refund-card {
  border: 1px solid var(--va-color-border, #e2e8f0);
  background: var(--va-color-surface, #ffffff);
  border-radius: 8px;
  padding: 16px;
  margin: 8px 0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.card-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.price {
  color: #ef4444;
  font-weight: 600;
  font-size: 16px;
}
.card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.btn {
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  font-size: 13px;
}
.btn-approve {
  background: #10b981;
  color: #fff;
}
.btn-reject {
  background: #f1f5f9;
  color: #475569;
}
</style>
```

---

## 第二步：将卡片注册到全局运行时分发器

在大模型生成流式参数时，入参可能不完整或存在临时空值。Vuagent 提供了 **`propAdapter` 防御机制**，确保大模型输出的任意脏数据在进入组件前被安全过滤收敛。

在项目初始化入口（如 `main.ts` 或专门的 `agent-setup.ts`）中进行注册：

```ts
// src/agent-setup.ts
import { registerAgentComponent } from "@vuagent/ui";
import OrderRefundCard from "./components/agent/OrderRefundCard.vue";

export function setupCustomAgentTools() {
  // 注册组件名（需与服务端 Tool 名或 UI 卡片名保持一致）
  registerAgentComponent("ui_order_refund", {
    component: OrderRefundCard,
    // 是否支持随大模型输出渐进流式渲染（默认 false，等待完整数据后再展示）
    progressive: true,

    // 入参适配与类型防御守卫：避免裸取 args 导致渲染崩溃
    propAdapter: (rawArgs: any) => {
      const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
      return {
        orderId: typeof args.orderId === "string" ? args.orderId : undefined,
        amount: typeof args.amount === "number" ? args.amount : 0,
        reason: typeof args.reason === "string" ? args.reason : undefined,
      };
    },
  });
}
```

在 `main.ts` 中调用：

```ts
// main.ts
import { createApp } from "vue";
import App from "./App.vue";
import { setupCustomAgentTools } from "./agent-setup";

setupCustomAgentTools(); // 注册业务专属组件

createApp(App).mount("#app");
```

---

## 第三步：在服务端声明该业务工具的 Schema

无论你使用的是官方 `@vuagent/server` 还是自定义的 Python/Go 后端，都需要在模型系统提示词或 Function Calling 参数中加入该工具的定义：

::: code-group

```ts [官方 @vuagent/server / TypeScript]
import { Type } from "@sinclair/typebox";

export const OrderRefundSchema = Type.Object({
  orderId: Type.String({ description: "待处理的订单号，如 ORD-98231" }),
  amount: Type.Number({ description: "退款金额（元）" }),
  reason: Type.String({ description: "退款原因说明" }),
});
```

```json [标准 OpenAI Function Calling JSON Schema]
{
  "name": "ui_order_refund",
  "description": "发起售后退款审批卡片，要求用户人工核对并确认",
  "parameters": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "订单号" },
      "amount": { "type": "number", "description": "退款金额" },
      "reason": { "type": "string", "description": "退款原因" }
    },
    "required": ["orderId", "amount", "reason"]
  }
}
```

:::

---

## 第四步：交互闭环与动作回传（Action 回调）

当用户在 `OrderRefundCard.vue` 点击【确认退款】时，组件触发了 `emit("action", { approved: true })`。

### 底层发生了什么？
1. 外层的 **`VaAgentRenderer` 捕获到组件的 `action` 事件**；
2. 内部自动调用 `postAgentAction(apiBaseUrl, toolCallId, payload)`，向服务端发起请求：
   ```http
   POST /api/action/call_98a7sdf876sdf
   Content-Type: application/json

   {
     "approved": true,
     "note": "运营人员审核通过"
   }
   ```
3. 服务端原本处于挂起等待状态的协程被当场唤醒，拿到决策参数继续往下走；
4. 前端卡片自动根据状态流转切换为已处理状态（`readonly`），防止用户重复点击。

---

## 总结

通过上述四步，你现有的 Vue 项目就具备了：
- **AI 理解意图** ➔ **调起业务专属 Tool** ➔ **前端渲染定制业务 Vue 卡片** ➔ **用户在卡片操作并回传** ➔ **后端完成真实业务执行**。

这正是 Vuagent 作为**业务级 Agent Ops 运行时**的核心价值。
