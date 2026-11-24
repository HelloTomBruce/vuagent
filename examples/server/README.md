# @examples/server · vuagent 案例共享 Harness Server

> **所有 Example 前端案例共享的 Harness Server 进程：注册场景自定义工具、复用 Console 模型配置，一条命令开箱即用。**

---

## 📖 定位

这是 `examples/` 目录下所有前端案例（如 [`agent-gallery`](../agent-gallery/) 场景画廊）共用的**执行引擎进程**：

- 基于 `@vuagent/server` 的 `createHarnessServer` 启动一个完整的 Agent Harness（ReAct 循环、SSE 事件流、HITL 审批挂起、会话检查点）；
- 通过 `customTools` 注册各案例所需的**场景自定义工具**（Custom Tools），并展示如何用 `HarnessTool` + TypeBox 声明工具契约；
- 复用 Playground Console 的配置数据库，模型 Profile 与 API Key **配置一次，案例全通用**。

---

## 🚀 启动方式

```bash
# 方式一：仅启动 Example Server（http://localhost:6881）
pnpm example:server

# 方式二：随案例一键启动（Server + agent-gallery 前端，含全部场景）
pnpm example:gallery
```

其它脚本：

```bash
pnpm --filter @examples/server start       # 无 watch 直接启动
pnpm --filter @examples/server typecheck   # 类型检查
```

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `6881` | HTTP 服务监听端口 |
| `DB_PATH` | `packages/server/.vuagent/harness.db` | 会话 / 配置数据库路径 |

### 共享模型配置数据库（开箱即用）

默认情况下，Example Server 会定位并复用 **Console 服务端**的数据库：

```ts
const defaultSharedDbPath = fileURLToPath(
  new URL("../../../packages/server/.vuagent/harness.db", import.meta.url)
);
const dbPath = process.env.DB_PATH || defaultSharedDbPath;
```

这意味着你在 Playground Console（`pnpm console`）里配置好的**模型 Profile、API Key、供应商与模型分层**，在 Example 中全部直接生效，无需重新配置。若想使用独立配置，通过 `DB_PATH` 指向新路径即可。

### 安全配置

```ts
const { app } = createHarnessServer({
  dbPath,
  customTools: exampleSceneTools,
  security: {
    // 允许前端覆盖或自备模型 (BYO Provider)
    allowByoProvider: true,
    // 放行 Example 前端的跨源请求
    extraOrigins: [
      "http://localhost:6991", "http://127.0.0.1:6991",
      "http://localhost:6995", "http://127.0.0.1:6995",
    ],
  },
});
```

---

## 🛠️ 场景自定义工具

所有案例工具集中在 `src/tools/` 下，由 `src/index.ts` 统一收集注册。每个工具用 `@sinclair/typebox` 声明参数 Schema（与 `@vuagent/protocol` 契约层对齐），同一份 Schema 充当**模型 Tool Calling 参数、前端 Props 类型与运行时校验**三重角色。

### 1. `ops_inspect_cluster` — 集群健康巡检（只读）

| 属性 | 值 |
|---|---|
| `riskLevel` | `low` |
| `requiresApproval` | `false` |

返回高仿真集群指标（CPU / 内存水位、Pod 拓扑、告警建议），并以 `rendered: true, component: "ui_cluster_health", props: {...}` 声明 Generative UI 挂载目标，前端原地渲染 `ClusterHealthCard.vue`。

### 2. `ops_scale_replicas` — 微服务副本扩容（高危写操作）

| 属性 | 值 |
|---|---|
| `riskLevel` | `high` |
| `requiresApproval` | `true` |

`requiresApproval: true` 是 HITL 的关键开关：模型调用该工具时，服务端安全引擎会**挂起任务流**（`action_suspended` 事件），等待人类通过 `POST /api/action/:actionId` 回传批准 / 驳回决策后才继续执行。执行成功后返回扩容指标与探针检查时间线，声明 `component: "ui_canary_deploy"` 由前端渲染 `CanaryDeployCard.vue`。

### 工具骨架示例

```ts
import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "@vuagent/server";

export const MyExampleTool: HarnessTool = {
  name: "my_example_tool",
  description: "工具的自然语言描述（供大模型做意图识别）",
  parameters: Type.Object({
    target: Type.String({ description: "参数说明" }),
  }),
  riskLevel: "low",              // low | medium | high
  requiresApproval: false,       // true 时触发安全引擎 HITL 审批挂起
  writesWorkspace: false,
  execute: async (ctx) => {
    // ctx.args 已经过 Schema 校验
    return {
      // 普通结构化结果：模型可见，前端可展示
      // 或声明 Generative UI：
      rendered: true,
      component: "ui_your_component",
      props: { /* 与前端注册的卡片 Props 对齐 */ },
    };
  },
};
```

### 新增案例工具的步骤

1. 在 `src/tools/` 下新建文件，按上述骨架实现工具并导出；
2. 在 `src/index.ts` 的 `exampleSceneTools` 数组中追加：
   ```ts
   const exampleSceneTools = [
     ...opsTools,
     ...yourNewTools, // ← 在这里继续扩展
   ];
   ```
3. 如需 Generative UI，在前端案例中调用 `registerCardComponent("ui_your_component", YourCard)` 完成卡片注册。

---

## 📁 目录结构

```text
examples/server/
├── package.json                # @examples/server，tsx 启动
├── tsconfig.json
└── src/
    ├── index.ts                # createHarnessServer 装配：共享 DB / 安全配置 / 工具注册
    └── tools/
        └── ops-tools.ts        # 云运维场景工具（巡检 + 扩容审批）
```
