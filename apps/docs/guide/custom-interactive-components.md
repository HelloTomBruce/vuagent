# 自定义交互组件（interaction 契约）

> 前置阅读：[接入项目特有工具与自定义 UI](/guide/custom-tools-and-ui)（注册卡片与 `propAdapter` 基础）、[HITL 动作与审批回调](/protocol/actions)（回传通道与幂等）。
>
> 本指南回答一个更进一步的问题：如何让自定义组件不止能**被渲染**，还能把用户的输入与决策以**契约化信封**回传给模型——让模型收到语义自解释的结果，而不是裸 JSON dump。

---

## 为什么需要 interaction 声明

`registerAgentComponent` 注册的组件缺省是 **L0 纯展示**：渲染没问题，但没有回传通道——`propAdapter` 拿到的 `ctx.onSubmitAction` 是渲染层拦截桩，用户点再多按钮模型也一无所知。

声明了 `interaction` 的组件才会在 `executing` 态获得可用的回传通道。契约面由 `@vuagent/protocol` 的 `UIComponentInteraction` 定义（运行时校验 `assertValidInteraction`，在**注册期**把关——把声明错误拦在定义期而非首次交互时）。

---

## 交互能力分级

| 等级 | 语义 | 回传形态 | 约束 | 现成参考 |
|---|---|---|---|---|
| `L0` | 纯展示（缺省等级） | 无回传通道 | - | `ui_metric_chart` |
| `L1` | 决策型：有限决策集 | submit 信封，枚举型 values | 超时缺省 `deny` | `ui_approval_card` |
| `L2` | 值采集型：结构化表单 | submit/cancel 信封 | **必须声明 `resultSchema` 或 `deriveResultSchema`**；超时缺省 `cancel` | `ui_form`（VaForm） |
| `L3` | 协作型：多次增量编辑 | patch 信封 + 终态 submit/cancel | 同 L2；patch 仅对「声明 L3 且挂起存活」生效（否则 422） | [VaAgentPlan](/components/agent-ops)（`collaborative: true` 协作态） |

---

## 第一步：声明 interaction

```ts
import { registerAgentComponent } from "@vuagent/ui";
import DeploymentForm from "./components/agent/DeploymentForm.vue";

registerAgentComponent("ui_deployment_form", {
  component: DeploymentForm,
  progressive: true,
  interaction: {
    // 1) 分级：决定回传通道是否启用与超时语义
    level: "L2",
    // 2) 回传值 Schema（L2/L3 必填，或与 deriveResultSchema 二选一）
    //    ui 侧传普通 JSON Schema 对象即可（vendored 类型按 Record<string, unknown> 接收；
    //    宿主若已依赖 TypeBox，其产出物本身也是合法 JSON Schema）
    resultSchema: {
      type: "object",
      properties: {
        environment: { type: "string", description: "部署目标环境" },
        replicas: { type: "number", description: "副本数", unit: "个" },
      },
      required: ["environment", "replicas"],
    },
    // 3) 挂起超时的语义归属：deny（视为拒绝）/ cancel（视为放弃）
    //    超时不允许映射为 submit——半成品值不得当作用户意图
    timeoutMeaning: "cancel",
  },
  propAdapter: (rawArgs, ctx) => {
    /* 见第二步 */
  },
});
```

### 三个声明字段的含义

**`resultSchema`**（L2/L3 必填，或与 `deriveResultSchema` 二选一）——一身三任：

1. **服务端边界校验规则**：回传值是不可信输入，服务端按此 Schema 做 TypeBox `Value.Check`，失败返回 422 + 结构化 `fieldErrors`（不唤醒模型）；
2. **模型词汇表**：字段 `description` 进入系统提示词，模型据此生成表单字段与理解回传摘要；
3. **摘要生成模板**：服务端摘要生成器按 `description` / `unit` / 枚举 `label` / `secret` 等关键字生成模型可见文本。

**`deriveResultSchema(args)`**——Schema 由**模型入参**决定时使用（`ui_form` 先例：模型给 `fields`，回传 Schema 按 fields 派生）。关键安全语义：**模型不允许自行声明 resultSchema**（fields 是输入、resultSchema 是推导结果），防止模型通过自定义 Schema 放宽服务端校验。`deriveFormResultSchema`（protocol 提供）就是这一派生逻辑的现成实现。

**`timeoutMeaning`**——挂起超时的语义归属：`deny`（L1 缺省，视为拒绝）/ `cancel`（L2 缺省，视为放弃）。超时的权威裁决在服务端；客户端倒计时触发的操作仅以 `note: "timeout"` 作展示性标记，不构成裁决。

---

## 第二步：propAdapter 绑定 onSubmitAction 产出信封

回传播载荷是 **UIActionEnvelope 判别联合**（`kind: "submit" | "cancel" | "patch"`）：

```ts
propAdapter: (rawArgs, ctx) => {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};
  return {
    title: typeof args.title === "string" ? args.title : "部署表单",
    fields: Array.isArray(args.fields) ? args.fields : [],
    disabled: ctx.status !== "executing", // 非 executing 态整表禁用（双保险视觉位）
    onSubmit: async (values: Record<string, unknown>, editedFields: string[]) => {
      if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
      await ctx.onSubmitAction({
        kind: "submit",
        values,
        meta: { editedFields }, // 用户亲自修改过的字段 key（默认值透传不计入）
      });
    },
    onCancel: () => {
      if (ctx.status !== "executing" || !ctx.onSubmitAction) return;
      void ctx.onSubmitAction({ kind: "cancel" }); // 取消是一等公民而非错误
    },
  };
},
```

### 守卫与校验语义（框架已代劳的部分）

- **渲染层守卫**：`streaming`（参数半截）/ `done` / `error` 态下，`ctx.onSubmitAction` 是 no-op 拦截桩（DEV 下 `console.warn`）——组件侧仍建议自查 `ctx.status`，但不判空（桩恒为函数）。
- **本地预校验**：`useAgentChat.submitAction` 在组件声明了 `resultSchema` / `deriveResultSchema` 时，提交前先按最简 JSON Schema 子集本地校验；失败抛 `UIActionLocalValidationError`，**不发请求、不做乐观更新**；通过则自动补记 `meta.clientValidated: true`。**权威校验永远在 server 边界**。
- **422 重填闭环**：server 校验失败返回 422 + `fieldErrors`，经 `form-errors` 响应式通道回填组件 prop，用户修正后重提（已填值保留）。参考 [VaForm 组件文档](/components/agent-ops)。

---

## 服务端侧：把交互能力接到工具定义上

`@vuagent/server` 的 `HarnessTool` 增加了可选 `interaction` 扩展字段（与 ui 侧 `UIComponentInteraction` 同构），`ui-registry` 注册期透传并做 `assertValidInteraction` 定义期校验：

```ts
import type { HarnessTool } from "@vuagent/server";
import { deriveFormResultSchema, liftFormResultSchema, coerceFormFields } from "@vuagent/protocol";

export const MyFormTool: HarnessTool = {
  name: "ui_my_form",
  description: "需要用户补充部署参数时调用",
  parameters: MyFormSchema,
  riskLevel: "low",
  requiresApproval: false, // L2 无审批挂起：挂起由 interaction.level 驱动，与 HITL 审批守卫解耦
  interaction: {
    level: "L2",
    timeoutMeaning: "cancel",
    deriveResultSchema: (args) =>
      liftFormResultSchema(deriveFormResultSchema(coerceFormFields(args?.fields))),
  },
  execute: async (ctx) => ({ rendered: true, component: "ui_my_form", props: ctx.args }),
};
// 内建参考实现：packages/server/src/tools/ui/protocol-tools.ts 的 UIFormTool / UIApprovalTool
```

模型可见的行为语义（由 server 统一实现，无需宿主干预）：

- **L1 决策**：批准走「语义摘要 + JSON 附录」双层 content；驳回/超时/取消是 `isError=false` 的**非错误信封摘要**（cancel 不是 error——混为 error 会诱导模型重试轰炸）；
- **L2 值采集**：无审批挂起，工具结果 = 用户提交的语义摘要；secret 字段值在路由边界剥离，模型只见 `{ ref, masked }` 占位；
- **patch（L3）**：仅对「声明 L3 且挂起仍存活」的组件生效——增量值经 resultSchema 校验后写入服务端 PatchStash 并返回 `200 {accepted:true, patchKeys}`（不唤醒协程、不落账）；挂起已终结返回 422 `PATCH_UNSUPPORTED`，多副本归属不符返回 409。submit 终态时服务端合并 `{...patchBase, ...submit.values}` 后校验与落账。

### 回调端点错误码速查

| 状态码 / 标记 | 场景 | 语义 |
|---|---|---|
| `400` | 回传体既非合法信封也非旧审批形态 | 解析失败（`parseUIActionPayload` 抛 `UIActionParseError`） |
| `422` + `fieldErrors` | 信封 values 未过 resultSchema 校验 | 值非法，**不唤醒**协程不落账，前端就地重填 |
| `422` `ACTION_PAYLOAD_MISMATCH` | 同 actionId 异体重放（body 哈希不同） | 同键异体拒绝，防误绑他人决策 |
| `200` + `delivered: false` | 同 actionId 同体重放（幂等键命中） | 幂等直达：返回既有决策，不重复唤醒 |
| `409` | actionId 归属其他会话 | 归属校验拒绝 |

---

## protocol-types vendored 约束与 sync 卡口

**`@vuagent/ui` 是 npm 分发且自包含**（peer 仅 `vue`，零 workspace 依赖）——因此：

1. **ui 侧不引入 `@vuagent/protocol` 运行时**。信封与交互声明类型 **vendor** 进 `ui/src/runtime/protocol-types.ts`；信封在组件侧以类型化对象字面量构造（只缺类型不缺解析——解析只发生在 server 路由边界）。
2. **派生函数逐字同源**。`deriveFormResultSchema` 这类两侧都要用的纯函数，ui 侧维护 vendored 副本（`ui/src/runtime/form-result-schema.ts`），与 protocol 原件由 sync 卡口机械锁死。
3. **`scripts/check-protocol-sync.mjs` 是 CI 卡口**：
   - 冻结类型（events.ts）与交互类型（interaction.ts）做**名集合比对**（计算型声明如 `Static<typeof Schema>` 无法文本同构，形状保真由双侧测试兜底）；
   - vendored 函数走 **FUNCTION_CORPUS 函数级比对**（花括号深度截取、剥注释归一化后逐字比对）。

自定义交互组件若需要同步 protocol 面（新类型/新派生函数），改动后必须跑：

```bash
pnpm protocol:sync-check   # 协议面同步卡口
pnpm registry:check        # registry 物料改动
```

---

## 完整参考实现

- **L1 决策型**：`ui_approval_card`（[审批卡文档](/components/agent-ops) / `packages/ui/src/runtime/registry.ts`）
- **L2 值采集型**：`ui_form` + `VaForm`（[组件文档](/components/agent-ops) / `packages/protocol/src/form.ts`）
- 契约规范全文：`docs/design/ui-llm-interaction-contract.md`（已落地 Phase 1/2）
