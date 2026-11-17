这是一份面向 **Web 应用**、基于 **Pi (`@mariozechner/pi-agent-core`)** 打造自研 **Agent UI 组件库** 的完整工程实施方案。

为了兼顾前后端全链路类型安全与前端架构解耦，方案采用 **Monorepo（pnpm workspace）** 结构，以 **Node.js (Hono/Fastify) + SSE** 作为 Pi 的 Web 宿主服务端，前端以 **Vue 3 + TypeScript + Vite** 为例实现声明式组件渲染引擎（React 同理可无缝替换）。

---

## 一、 整体架构与目录规划

### 1. 系统拓扑链路

```text
[浏览器 Web 前端 (Vue 3)]
  ├── AgentUIRenderer (动态组件分发器)
  ├── ComponentRegistry (业务 UI 组件库 + 骨架屏)
  └── usePiAgent (SSE 流式接收 + HITL 交互回调)
         ▲                         │
         │ (1) SSE 事件流           │ (2) POST /api/chat & /api/action
         ▼                         ▼
[Node.js BFF 宿主服务]
  ├── Pi Agent Instance (@mariozechner/pi-agent-core)
  ├── UI Tool Definitions (共享 TypeBox Schema)
  └── PendingActionManager (Human-in-the-Loop 挂起队列)

```

### 2. Monorepo 目录结构

```text
my-agent-ui-workspace/
├── packages/
│   ├── protocol/               # 共享契约层：UI Tool Schema、SSE 事件类型定义
│   │   └── src/
│   │       ├── events.ts       # 归一化后的前端 UI 事件协议
│   │       └── tools.ts        # TypeBox 定义的 UI 组件 Props 契约
│   ├── server/                 # Node.js BFF 宿主：运行 Pi Agent 并暴露 HTTP/SSE 接口
│   │   └── src/
│   │       ├── agent.ts        # Pi Agent 初始化与 Extension 注册
│   │       ├── action-hub.ts   # 交互式组件挂起/唤醒管理器
│   │       └── index.ts        # Hono/Express SSE 路由服务
│   └── ui-kit/                 # 核心产出：独立的 Agent UI 组件库
│       └── src/
│           ├── components/     # 具体业务组件（图表、审批单、代码Diff、表单等）
│           ├── skeletons/      # 对应的流式加载骨架屏
│           ├── registry.ts     # 组件注册表
│           ├── renderer.vue    # 核心动态渲染器 <AgentMessageBlock />
│           └── theme.css       # Design Tokens (CSS 变量隔离)
└── apps/
    └── web-playground/         # 用于调试与预览组件库的 Web 宿主应用

```

---

## 二、 阶段一：定义前后端共享契约 (`packages/protocol`)

核心原则：**用 TypeBox 同时充当大模型的 Tool 参数约束和前端组件的 TypeScript `Props` 类型**，消除前后端字段不一致。

### 1. 定义 UI 组件 Tool 契约 (`src/tools.ts`)

```typescript
import { Type, Static } from "@sinclair/typebox";

// 组件 1：展示类组件 - 指标图表卡片
export const MetricChartSchema = Type.Object({
  title: Type.String({ description: "图表标题" }),
  chartType: Type.Union([Type.Literal("line"), Type.Literal("bar")]),
  unit: Type.Optional(Type.String({ description: "数值单位，如 元、%" })),
  series: Type.Array(
    Type.Object({
      label: Type.String(),
      value: Type.Number(),
    }),
  ),
});
export type MetricChartProps = Static<typeof MetricChartSchema>;

// 组件 2：交互类组件 (HITL) - 确认审批表单
export const ApprovalFormSchema = Type.Object({
  actionTitle: Type.String({ description: "待审批的操作名称" }),
  riskLevel: Type.Union([
    Type.Literal("low"),
    Type.Literal("medium"),
    Type.Literal("high"),
  ]),
  fields: Type.Array(
    Type.Object({
      key: Type.String(),
      label: Type.String(),
      defaultValue: Type.String(),
    }),
  ),
});
export type ApprovalFormProps = Static<typeof ApprovalFormSchema>;
```

### 2. 定义归一化的前端流式事件 (`src/events.ts`)

将 Pi 底层细碎的 `AgentEvent` 清洗为前端 UI 渲染层直接消费的精简协议：

```typescript
export type UIStreamEvent =
  | { type: "text_delta"; messageId: string; delta: string }
  | {
      type: "component_start";
      messageId: string;
      toolCallId: string;
      componentName: string;
    }
  | {
      type: "component_args_delta";
      toolCallId: string;
      partialArgs: Record<string, any>;
    }
  | {
      type: "component_executing";
      toolCallId: string;
      args: Record<string, any>;
    }
  | {
      type: "component_ready";
      toolCallId: string;
      status: "done" | "error";
      data: any;
    }
  | { type: "turn_end" };
```

---

## 三、 阶段二：搭建 Pi 宿主服务端 (`packages/server`)

Web 环境下，模型 API Key 必须留在服务端。我们在 Node.js 端实例化 Pi Agent，并将事件通过 SSE 推向浏览器。

### 1. 实现 Human-in-the-Loop 挂起管理器 (`src/action-hub.ts`)

解决“前端弹窗/卡片等待用户点击提交后，Agent 再继续往下跑”的问题：

```typescript
type PendingResolver = {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
};

class ActionHub {
  private pendingMap = new Map<string, PendingResolver>();

  // 挂起当前 Tool 的 execute，等待前端 HTTP 回调
  waitForUserAction<T = any>(
    toolCallId: string,
    timeoutMs = 300_000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingMap.delete(toolCallId);
        reject(new Error("用户交互超时"));
      }, timeoutMs);

      this.pendingMap.set(toolCallId, {
        resolve: (val) => {
          clearTimeout(timer);
          this.pendingMap.delete(toolCallId);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pendingMap.delete(toolCallId);
          reject(err);
        },
      });
    });
  }

  // 前端点击按钮时触发此方法唤醒 Agent
  submitUserAction(toolCallId: string, payload: any): boolean {
    const handler = this.pendingMap.get(toolCallId);
    if (!handler) return false;
    handler.resolve(payload);
    return true;
  }
}

export const actionHub = new ActionHub();
```

### 2. 注册 UI Tools 与 Pi Agent 实例 (`src/agent.ts`)

```typescript
import { Agent, AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { MetricChartSchema, ApprovalFormSchema } from "@workspace/protocol";
import { actionHub } from "./action-hub";

// 1.  纯展示型 UI Tool
const renderMetricChartTool: AgentTool<typeof MetricChartSchema> = {
  name: "ui_metric_chart",
  label: "数据指标图表",
  description: "当需要向用户展示趋势或对比数据时调用，前端将渲染可视化图表卡片",
  parameters: MetricChartSchema,
  execute: async (_id, params) => {
    // 展示型组件无需后端复杂计算，直接透传参数供前端最终锁定渲染
    return {
      content: [{ type: "text", text: `已在界面渲染图表：${params.title}` }],
      details: { props: params },
    };
  },
};

// 2. 交互挂起型 UI Tool
const requestApprovalTool: AgentTool<typeof ApprovalFormSchema> = {
  name: "ui_approval_form",
  label: "人工审批表单",
  description:
    "涉及高风险操作或需要用户确认修改参数时调用，将阻塞直到用户在界面提交",
  parameters: ApprovalFormSchema,
  execute: async (toolCallId, params) => {
    // 阻塞等待前端交互回传
    const userResult = await actionHub.waitForUserAction(toolCallId);
    return {
      content: [
        {
          type: "text",
          text: `用户已完成审批，决策：${userResult.approved ? "通过" : "拒绝"}，提交数据：${JSON.stringify(userResult.formData)}`,
        },
      ],
      details: { props: params, userResult },
    };
  },
};

export function createWebAgent(systemContext?: string) {
  return new Agent({
    initialState: {
      systemPrompt: `你是一个配备了可视化 UI 组件库的智能助手。
当回复包含结构化数据、图表或需要用户确认表单时，优先调用对应的 ui_* 工具渲染交互卡片，而不是用纯文本罗列。
${systemContext || ""}`,
      model: getModel("anthropic", "claude-sonnet-4-5"), // 可按需替换为任意兼容模型
      tools: [renderMetricChartTool, requestApprovalTool],
    },
  });
}
```

### 3. 暴露 SSE 对话与交互回调接口 (`src/index.ts`)

使用 `Hono`（轻量、原生支持 Web Streams API）搭建路由：

```typescript
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { parsePartialJson } from "@mariozechner/pi-ai"; // 利用内置容错解析流式半截 JSON
import { createWebAgent } from "./agent";
import { actionHub } from "./action-hub";
import { UIStreamEvent } from "@workspace/protocol";

const app = new Hono();

// 接口 1：发起对话并建立 SSE 事件流
app.post("/api/chat", async (c) => {
  const { prompt, themeMode } = await c.req.json();
  const agent = createWebAgent(`当前前端主题模式：${themeMode || "light"}`);

  return streamSSE(c, async (stream) => {
    const emit = async (event: UIStreamEvent) => {
      await stream.writeSSE({ data: JSON.stringify(event) });
    };

    const currentMsgId = crypto.randomUUID();
    let rawJsonBuffer = "";

    // 订阅 Pi 底层事件并桥接为前端 UI 协议
    const unsubscribe = agent.subscribe(async (event) => {
      if (event.type === "message_update") {
        const sub = event.assistantMessageEvent;
        if (sub.type === "text_delta") {
          await emit({
            type: "text_delta",
            messageId: currentMsgId,
            delta: sub.delta,
          });
        } else if (sub.type === "toolcall_start") {
          rawJsonBuffer = "";
          await emit({
            type: "component_start",
            messageId: currentMsgId,
            toolCallId: sub.partial.id,
            componentName: sub.partial.name,
          });
        } else if (sub.type === "toolcall_delta") {
          rawJsonBuffer += sub.delta;
          // 关键：对半截 JSON 做容错修复，实现组件 Props 流式渐进渲染
          const safePartial = parsePartialJson(rawJsonBuffer);
          if (safePartial && typeof safePartial === "object") {
            await emit({
              type: "component_args_delta",
              toolCallId: sub.partial.id,
              partialArgs: safePartial,
            });
          }
        }
      } else if (event.type === "tool_execution_start") {
        await emit({
          type: "component_executing",
          toolCallId: event.toolCallId,
          args: event.args,
        });
      } else if (event.type === "tool_execution_end") {
        await emit({
          type: "component_ready",
          toolCallId: event.toolCallId,
          status: event.isError ? "error" : "done",
          data: event.result?.details,
        });
      } else if (event.type === "agent_end") {
        await emit({ type: "turn_end" });
      }
    });

    try {
      await agent.prompt(prompt);
    } finally {
      unsubscribe();
    }
  });
});

// 接口 2：接收前端 UI 组件的交互操作（如点击审批通过）
app.post("/api/action/:toolCallId", async (c) => {
  const toolCallId = c.req.param("toolCallId");
  const payload = await c.req.json();
  const ok = actionHub.submitUserAction(toolCallId, payload);
  return c.json({ success: ok }, ok ? 200 : 404);
});

export default app;
```

---

## 四、 阶段三：构建前端 Agent UI 组件库 (`packages/ui-kit`)

组件库内部必须做到**状态自包含、样式隔离、支持流式降级**。

### 1. 设计组件统一接口规范

每个接入组件库的 Vue 组件都接收一套标准化的注入 Props：

```typescript
export interface AgentComponentBaseProps<TProps = any> {
  toolCallId: string;
  /** 组件生命周期状态：streaming(参数生成中) -> executing(等待交互/执行) -> done(完成) -> error */
  status: "streaming" | "executing" | "done" | "error";
  /** 大模型生成的业务参数（streaming 阶段可能为不完整对象） */
  args: Partial<TProps>;
  /** 执行完成后的最终结果或用户历史提交记录 */
  result?: any;
  /** 交互类组件调用此方法向后端回传数据 */
  onSubmitAction: (payload: any) => Promise<void>;
}
```

### 2. 组件注册表 (`src/registry.ts`)

```typescript
import { defineAsyncComponent, Component } from "vue";

export interface RegisteredUIComponent {
  component: Component;
  skeleton?: Component;
  /** 是否允许在参数流式生成阶段（还未完整输出时）就提前渲染主组件 */
  progressive?: boolean;
}

export const AgentUIRegistry = new Map<string, RegisteredUIComponent>([
  [
    "ui_metric_chart",
    {
      component: defineAsyncComponent(
        () => import("./components/MetricChartCard.vue"),
      ),
      skeleton: defineAsyncComponent(
        () => import("./skeletons/ChartSkeleton.vue"),
      ),
      progressive: false, // 图表等数据完整后再渲染，流式阶段展示骨架屏
    },
  ],
  [
    "ui_approval_form",
    {
      component: defineAsyncComponent(
        () => import("./components/ApprovalFormCard.vue"),
      ),
      progressive: true, // 表单字段可以随着大模型输出逐行渐进出现
    },
  ],
]);
```

### 3. 核心动态渲染分发器 (`src/renderer.vue`)

```vue
<script setup lang="ts">
import { computed } from "vue";
import { AgentUIRegistry } from "./registry";

const props = defineProps<{
  toolCallId: string;
  componentName: string;
  status: "streaming" | "executing" | "done" | "error";
  args: Record<string, any>;
  result?: any;
  apiBaseUrl?: string;
}>();

const entry = computed(() => AgentUIRegistry.get(props.componentName));

// 决定当前渲染骨架屏还是实体组件
const activeComponent = computed(() => {
  if (!entry.value) return null;
  if (
    props.status === "streaming" &&
    !entry.value.progressive &&
    entry.value.skeleton
  ) {
    return entry.value.skeleton;
  }
  return entry.value.component;
});

// 统一封装交互回传方法，透传给具体业务组件
const handleActionSubmit = async (payload: any) => {
  const baseUrl = props.apiBaseUrl || "";
  await fetch(`${baseUrl}/api/action/${props.toolCallId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
};
</script>

<template>
  <div class="agent-ui-sandbox" :data-status="status">
    <component
      :is="activeComponent"
      v-if="activeComponent"
      :tool-call-id="toolCallId"
      :status="status"
      :args="args"
      :result="result"
      :on-submit-action="handleActionSubmit"
    />
    <!-- 兜底：遇到未注册组件时的优雅降级展示 -->
    <div v-else class="agent-ui-fallback">
      <div class="fallback-header">
        未知组件: {{ componentName }} ({{ status }})
      </div>
      <pre>{{ JSON.stringify(args, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.agent-ui-sandbox {
  /* 通过 CSS 变量建立 Design Token 隔离层，方便宿主应用换肤 */
  --aui-bg: var(--el-bg-color, #ffffff);
  --aui-border: var(--el-border-color, #e5e7eb);
  --aui-radius: 10px;
  --aui-primary: #2563eb;

  margin: 12px 0;
  border: 1px solid var(--aui-border);
  border-radius: var(--aui-radius);
  background: var(--aui-bg);
  overflow: hidden;
}
</style>
```

### 4. 编写一个交互式审批组件示例 (`src/components/ApprovalFormCard.vue`)

```vue
<script setup lang="ts">
import { reactive, ref, watchEffect } from "vue";
import type { ApprovalFormProps } from "@workspace/protocol";

const props = defineProps<{
  toolCallId: string;
  status: "streaming" | "executing" | "done" | "error";
  args: Partial<ApprovalFormProps>;
  result?: any;
  onSubmitAction: (payload: any) => Promise<void>;
}>();

const formState = reactive<Record<string, string>>({});
const submitting = ref(false);

// 随着大模型流式输出 fields，自动填充默认值
watchEffect(() => {
  props.args.fields?.forEach((f) => {
    if (!(f.key in formState)) {
      formState[f.key] = f.defaultValue || "";
    }
  });
});

const submit = async (approved: boolean) => {
  submitting.value = true;
  try {
    await props.onSubmitAction({ approved, formData: { ...formState } });
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <div class="approval-card">
    <div class="header">
      <span>{{ args.actionTitle || "正在生成审批单..." }}</span>
      <span v-if="args.riskLevel" :class="['badge', args.riskLevel]">{{
        args.riskLevel
      }}</span>
    </div>

    <div class="fields">
      <div
        v-for="field in args.fields || []"
        :key="field.key"
        class="field-item"
      >
        <label>{{ field.label }}</label>
        <input
          v-model="formState[field.key]"
          :disabled="status !== 'executing' || submitting"
        />
      </div>
    </div>

    <!-- 仅在 executing（挂起等待人工确认）状态下激活操作按钮 -->
    <div v-if="status === 'executing'" class="actions">
      <button :disabled="submitting" @click="submit(false)">驳回</button>
      <button class="primary" :disabled="submitting" @click="submit(true)">
        {{ submitting ? "提交中..." : "确认执行" }}
      </button>
    </div>

    <!-- 完成后锁定为只读回执状态 -->
    <div v-else-if="status === 'done'" class="receipt">
      已处理：{{ result?.userResult?.approved ? "已批准" : "已驳回" }}
    </div>
  </div>
</template>
```

---

## 五、 阶段四：前端状态机与 Web Playground 调试台 (`apps/web-playground`)

为了高效开发和调试组件库，在 `apps/web-playground` 中封装一个 `usePiChat` Composable，并增加一个**组件模拟调试面板（Mock Inspector）**。

### 1. 前端 SSE 流式状态机 (`usePiChat.ts`)

将对话消息建模为“混合内容块列表（`blocks: Array<TextBlock ComponentBlock |>`）”，完美支持大模型“先说一段话 -> 插入一个图表组件 -> 再总结一段话 -> 插入一个审批表单”的任意混排：

```typescript
export type MessageBlock =
  | { kind: "text"; content: string }
  | {
      kind: "component";
      toolCallId: string;
      componentName: string;
      status: "streaming" | "executing" | "done" | "error";
      args: Record<string, any>;
      result?: any;
    };

// 在收到 SSE 事件时按以下规则更新当前 Assistant 消息的 blocks：
// 1. text_delta: 如果最后一个 block 是 text 则追加；否则 push 一个新的 text block
// 2. component_start: push 一个新的 component block (status: 'streaming')
// 3. component_args_delta: 根据 toolCallId 找到对应 block，更新 args
// 4. component_executing: 更新 status = 'executing'，覆盖完整 args
// 5. component_ready: 更新 status = event.status，写入 result
```

### 2. 开发期提效关键：内置“无模型 Mock 模拟器”

在开发 UI 组件库样式和交互时，每次都调大模型既慢又费 Token。建议在 `web-playground` 顶部增加一个开发者工具栏：

- **模式 A（真实 Pi Agent 模式）：** 走 `/api/chat` 联调完整端到端流程。
- **模式 B（组件单测 / 流式回放模式）：** 直接在前端构造伪造的 `UIStreamEvent[]` 序列，用 `setInterval` 模拟 `component_start` ➔ `component_args_delta`（测试半截 JSON 容错）➔ `component_executing`（测试表单提交阻塞）➔ `component_ready` 的完整状态流转，实现毫秒级组件热更新调试。

---

## 六、 生产环境上线注意事项

1. **会话持久化与断线重连：** 上述示例中的 `agent` 实例在单次 HTTP 请求中创建；生产环境多轮对话需将 `agent.state.messages` 存入 Redis/数据库，每次 `/api/chat` 传入 `sessionId` 恢复历史上下文（Pi 原生支持通过 `agent.replaceMessages(...)` 注入历史消息）。
2. **多实例部署下的 ActionHub：** 如果 Node.js 后端部署了多副本，单机内存的 `Map` 会导致前端 `/api/action/:toolCallId` 路由到另一台机器而找不到 Promise 句柄。生产环境需配置网关层的 **Sticky Session（会话粘性）**，或使用 Redis Pub/Sub 跨进程唤醒挂起的 Promise。
3. **样式防污染：** 组件库打包产物导出独立的 `style.css`，所有内部类名加统一前缀（如 `.aui-`）或使用 CSS Modules，确保引入到任何第三方 Web 宿主系统时不会与宿主的全局样式冲突。
