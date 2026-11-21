# @vuagent/protocol

Vuagent 的单一事实契约层：Agent 执行全链路（server → SSE → 前端）共享的事件流协议、工具 Schema 与组件生命周期模型。

## 为什么需要它

Agent 产品的前后端一致性问题是系统性风险：模型流式输出的 JSON 参数、服务端推送的 SSE 事件、前端渲染的组件 Props，三者若各自定义类型，字段漂移只会表现为「前端静默渲染错乱」，排查成本极高。本包用一套 TypeBox Schema 同时充当：

1. **大模型的 Tool 参数约束**（Function Calling 的 `parameters`）；
2. **前端组件的 Props 类型**（`Static<>` 推导，编译期即约束）；
3. **序列化边界的运行时校验器**（`Value.Check`，SSE 边界漏字段/类型错发当场拒绝）。

一份契约，三处消费，互为印证。

## 架构

### 契约域的三张分表

契约按「语义边界」而非「技术层次」划分为三个域，各自独立演进、独立导入：

```
@vuagent/protocol
├── stream         事件流域：HarnessStreamEvent（18 事件判别联合）
│                  谁在用：server（SSE 推送）+ console 前端（流式消费）
│
├── tools          UI 工具域：10 个 ui_* 工具 Schema + AllToolSchemas 聚合
│                  谁在用：server（模型 parameters + 卡片名联合类型）
│
├── system-tools   系统工具域：fs / bash / glob / grep / web_fetch + finish_task 显式终态声明，共 8 个入参 Schema
│                  谁在用：server（ToolRegistry 执行前校验闸门）
│
└── lifecycle      组件生命周期域：四态生命周期 + MessageBlock 混排块
                   谁在用：@vuagent/ui runtime（经 vendored 副本分发）
```

**ui 工具与系统工具刻意分表**：`VuagentToolName` 只收 ui_* 工具名——它是「UI 组件名」的联合类型，被渲染分发器消费。若系统工具名混入同一命名空间，「工具名 = 组件名」的语义就被污染了（fs_write 并不渲染任何卡片）。全量工具聚合另立 `AllToolSchemas` / `VuagentAllToolName`。

### Schema 即唯一事实来源

```
TypeBox Schema（手写，唯一维护点）
   ├── Static<typeof Schema>        → TypeScript 类型（推导，永不手写 interface）
   └── Value.Check(schema, event)   → 运行时校验（序列化边界把守）
```

事件类型不是「手写 interface + 手写 schema」的双事实来源，而是**由 schema 单向推导**。改 schema 一处，类型、校验、文档三者同步生效——漂移在结构上不可能发生。

### 事件全集（18 事件）

按业务阶段分组，构成一次 Agent 轮次的完整叙事线：

| 阶段 | 事件 | 承载的业务语义 |
|---|---|---|
| 轮次生命周期 | `turn_start` / `turn_end` / `aborted` / `error` / `suspended` / `resumed` | 一轮执行的起止、中止、错误；HITL 审批挂起与恢复 |
| 流式增量 | `thought_delta` / `text_delta` | 思考链与正文的逐 token 推送 |
| 工具调用链 | `tool_call_start` / `tool_call_args_delta` / `tool_call_executing` / `tool_call_result` | 参数流式生成 → 容错解析 → 执行中 → 结果收敛，四段渐进 |
| UI 卡片 | `ui_agent_plan` / `ui_code_diff` / `ui_terminal_log` / `ui_metric_chart` | 模型主动发起的结构化渲染（计划/差异/终端/图表） |
| 可观测 | `usage` / `traj` | token 消耗分段（系统提示/历史/工具）与执行轨迹时间线 |

## 核心设计决策

### 非严格校验 = 前向兼容

事件 Schema 不设 `additionalProperties: false`。理由：SSE 是跨进程序列化边界，**服务端新增字段对旧校验器必须无害**（新前端消费新字段、旧前端忽略之）；但漏字段与类型错发是 bug 信号，立即拒绝。宽进严出的分界线画在「未知字段」与「已知字段的形状」之间。

生产热路径（SSE 格式化）不挂校验——零开销；校验供契约回归测试与下游消费方自行把关。

### 传输层字段与协议版本

- `seq`：由 server 的执行枢纽注入的广播序号（1 起递增），是**传输层字段而非业务字段**——增量重连时前端据此去重，只补缺口，不全量重放；
- 协议版本经 SSE 响应头 `x-vuagent-protocol-version` 携带（当前 `1`），为未来破坏性演进预留协商通道。

### 容错半截 JSON 的契约配合

模型流式输出工具参数时 JSON 是逐 token 到达的。`tool_call_args_delta` 事件的载荷约定为「容错修补后的合法部分对象」——修补逻辑在 server 侧完成，前端永远拿到可安全渲染的 `Partial<Props>`，契约保证了这一点。

### vendored 副本与 CI 机械同步

`@vuagent/ui` 以 npm 包分发必须自包含（发布物内零 workspace 依赖），因此 lifecycle 域的类型以副本随包分发。人工同步必然漂移，所以副本的修改权被收走：**改协议 → 改本包 → 跑同步脚本按提示更新副本**。CI 卡口机械对比两侧（类型名集合、生命周期字面量、逐名声明文本三层），任何漂移即失败。

## 变更纪律

1. **事件变更**：改事件注册表（注册表与联合列表两处）→ 更新测试中的事件全集卡口（新增/删除/改名在此必失败）→ server 侧契约回归测试会自动校验真实 emit 与 schema 一致；
2. **工具变更**：改对应域 schema → server 校验闸门自动生效，注意同步更新喂旧参数形状的测试；
3. **一切变更必须携带 changeset**：契约包是整个仓库语义化版本纪律的第一执行者；
4. 消费方一律走子路径导入（`@vuagent/protocol/stream`、`/tools`、`/lifecycle`、`/system-tools`），保持各域可独立演进。

## 测试

```bash
pnpm --filter @vuagent/protocol test        # 事件注册表全集卡口 + 逐事件非法变体 + 工具 schema
pnpm --filter @vuagent/protocol typecheck
```
