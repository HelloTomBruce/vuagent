# UI 注册组件 ↔ LLM 交互契约规范

> 状态：**已落地（Phase 1/2/3，TASK-088~093 + L3 收尾批次）**——分级声明 / 回传信封 / 边界校验与语义摘要 / 幂等契约 / 首个 L2 组件 ui_form（VaForm）/ L3 patch 运行时（PatchStash + collaborative ui_agent_plan）均已上线。落地明细见文末[「落地记录」](#落地记录)。
> 适用范围：`packages/protocol`（契约）、`packages/server`（挂起/校验/摘要）、`packages/ui`（runtime 注册中心与组件）。
> 既有约束：UIStreamEvent 词表已冻结（events.ts FROZEN），HarnessStreamEvent 受 protocol-sync 门禁约束——本规范**不新增任何 SSE 事件类型**，全部语义在现有 `component_start / component_args_delta / component_executing / component_ready` 生命周期与 `/api/action/:actionId` 回调内承载。

## 1. 目标与非目标

**目标**：
- 为「UI 组件收集用户输入 → 回传 → LLM 理解」建立一套组件无关的通用契约，使表单类复杂交互（L2）与未来的协作编辑（L3）不需要逐组件发明私有协议；
- LLM 收到的交互结果必须是**语义自解释**的（字段含义、取值合法性、用户意图类型），而非裸 JSON dump；
- 回传值是**不可信输入**，在服务端边界校验后才进入模型上下文。

**非目标（本轮明确不做）**：
- 不改 UIStreamEvent / HarnessStreamEvent 词表（新增成员走退役/门禁流程另行提案）；
- 不实现 L3 多轮增量协作的运行时（仅定义语义预留）；
- 不引入新的 HTTP 端点族（复用 `/api/action/:actionId` 及其别名）。

## 2. 交互能力分级

组件注册时**显式声明**交互等级，等级决定服务端是否为其挂起协程、前端是否绑定 `onSubmitAction`：

| 等级 | 名称 | 语义 | 现有成员 |
|---|---|---|---|
| L0 | presentational | 纯展示，无回传通道。`component_executing` 后立即自行 `component_ready` | trajectory / code_diff / metric_chart / file_tree / task_board / change_summary / comment_thread / ai_answer |
| L1 | decision | 有限决策集（approve/deny），枚举型 payload | approval_card |
| L2 | form | 结构化值采集：组件声明 `resultSchema`，用户提交经校验的 `values` | （本规范新增，见 §6） |
| L3 | collaborative | 多次增量 `patch` 不终结挂起，终态由显式 submit/cancel 触发 | 设计预留（agent_plan 的 update:steps/retry 即候选） |

等级声明落在协议包（与工具 Schema 同处，单一事实来源）：

```ts
export interface UIComponentDefinition {
  name: string;
  title: string;
  description: string;
  schema: TSchema;                 // LLM → UI：渲染参数（既有）
  interaction?: {
    level: "L0" | "L1" | "L2" | "L3";   // 缺省 L0
    resultSchema?: TSchema;              // UI → LLM：L2/L3 必填
    timeoutMeaning?: "cancel" | "deny";  // 超时的语义归属，缺省 deny（L1）/ cancel（L2）
  };
}
```

## 3. 回传信封（Action Envelope）

现状 `POST /api/action/:actionId` 的 body 是逐组件自由 JSON（审批卡为 `{approved, reason}`），模型只能靠 key 名猜语义。规范化为判别联合信封：

```ts
export const UIActionEnvelopeSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("submit"),
    values: Type.Record(Type.String(), Type.Unknown(), {
      description: "用户提交的字段值集合，形状由组件 resultSchema 约束",
    }),
    meta: Type.Optional(ActionMetaSchema),
  }),
  Type.Object({
    kind: Type.Literal("cancel"),
    reason: Type.Optional(Type.String({ description: "用户主动取消的原因（若界面提供输入）" })),
    meta: Type.Optional(ActionMetaSchema),
  }),
  Type.Object({
    kind: Type.Literal("patch"),  // L3 预留：增量编辑，不终结挂起
    values: Type.Record(Type.String(), Type.Unknown()),
    meta: Type.Optional(ActionMetaSchema),
  }),
]);

const ActionMetaSchema = Type.Object({
  editedFields: Type.Optional(Type.Array(Type.String(), {
    description: "用户实际修改过的字段 key（区别于组件预填默认值）——模型据此区分『用户确认过』与『默认值透传』",
  })),
  durationMs: Type.Optional(Type.Number({ description: "用户交互耗时" })),
  clientValidated: Type.Optional(Type.Boolean({ description: "前端是否已过本地校验（服务端仍必须复核）" })),
});
```

设计要点：

- **`cancel` 是一等公民而非错误**：用户关掉表单和「校验失败」是两种语义，混为 error 会诱导模型重试轰炸。映射到 tool 消息时 cancel 是正常结果（`isError=false`），由模型决定下一步。
- **`timeout` 不进信封**：超时由 ActionHub 服务端裁决生成（现有机制），不允许客户端伪造超时来跳过挂起。
- **幂等键 = actionId**：重复提交返回已落账决策（server 的 `getDecision` 去重逻辑从实现细节**升格为契约**）；同 actionId 不同 body 返回 422（防误重试覆盖）。
- **安全先例延续**：与 approval_card 不透出 `approveShortcut` 同理——`resultSchema` 之外、能改变组件安全语义的字段（如「跳过校验」）禁止从模型 args 透出到 props，统一在 propAdapter 层截断。

## 4. LLM 如何理解值：双层工具结果

现状：tool 消息 `content = JSON.stringify(executionResult)`——裸 JSON。对 `{env: "prod", replicas: 3}` 模型尚可猜；对 20 字段表单、枚举缩写、布尔位、空值，猜测成本与误读率都不可接受。

规范：tool 消息 content = **语义摘要（自然语言段）+ 结构化附录（JSON 段）**。

### 4.1 语义摘要生成规则（服务端泛型生成器，不逐组件特判）

摘要由 `resultSchema` 的字段 `description` 驱动生成——这也是 resultSchema 必须给每个字段写中文 description 的原因（它同时是：校验规则、模型词汇表、摘要模板）：

| 字段类型 | 摘要形态 | 示例 |
|---|---|---|
| string / number | `{description}: {value}{unit?}` | `部署环境: production` / `副本数: 3 个` |
| boolean | `{description}: 是 / 否` | `开启 TLS: 是` |
| enum | 值回映到 option 的 label | `规格: 大（8C16G）`而非 `size: l` |
| 缺省未填 | 显式标注 | `备注: （用户未填写）` |
| `secret: true` | 打码，值不进上下文（见 §5） | `访问令牌: 已提供（sk-…****）` |
| 数组/嵌套 | 缩进列举，深度 >2 折叠计数 | `依赖: 3 项（详见附录）` |

摘要模板：

```
用户在「{组件 title}」中提交了以下信息：
- 部署环境: production
- 副本数: 3 个
- 备注: （用户未填写）

其中「副本数」为用户亲自修改，其余沿用了你提供的默认值。
```

最后一句来自 `meta.editedFields`——**区分「用户确认」与「默认值透传」是表单场景最重要的意图信号**，没有它模型会把预填默认值当成用户意志。

附录段（` ```json ` 代码块）携带校验后的完整 `values`，供模型精确取用；摘要供理解，附录供引用，两者数值必须同源（附录直接来自校验输出，不做二次加工）。

### 4.2 校验失败不是终态，是新的输入

`values` 未过 `resultSchema` 校验时（前端绕过/版本漂移/手工构造请求），服务端**不唤醒协程**，直接 422 返回 fieldErrors 给前端重填；只有当失败属于「业务规则校验」（Schema 无法表达，如「该环境配额不足」）时，才以如下形态回传模型：

```
用户在「创建部署」中提交的信息未通过校验：
- 副本数: 当前环境最大支持 2 个（用户填了 3 个）

你可以重新发起表单（预填用户已填值）并提示用户修正。
```

模型据此用**同一工具**重新渲染表单（预填回显 + 错误提示），形成「提交 → 校验 → 修正再提交」闭环，而不是对话降级。

## 5. 敏感值通道

表单收集密码、token、私钥时，明文**永不进入模型上下文**（摘要和附录都不进）：

- `resultSchema` 字段标注 `secret: true`；
- 服务端校验后，secret 字段值从 values 中剥离，落入宿主 secret store，返回 `{ ref: "secret://<id>", masked: "sk-…****" }` 占位；
- 模型在后续工具调用中通过 `ref` 引用（如 bash 环境变量插值），由服务端在执行点还原——模型知道「值已提供、可以引用」，但始终见不到明文；
- 这是「LLM 理解值」的对偶面：**有些值的正确理解方式就是不让它看见**。

## 6. 生命周期与状态机

```
component_start ──→ component_args_delta* ──→ component_executing（挂起，等待人）
                                                    │
        ┌───────────────────┬───────────────────────┤
        │ submit（校验过）   │ cancel              │ timeout（服务端裁决）
        ▼                   ▼                     ▼
  component_ready      component_ready        component_ready
  (done, 双层结果)      (done, cancel 语义)     (done, timeoutMeaning 语义)
```

- **挂起可达数分钟**（approvalTimeoutMs 同款配置中心项），期间的崩溃恢复沿用 TASK-100 诚实语义：决策可落账、协程不复活、卡片回写——表单场景同样适用，不引入「恢复挂起」路径。
- **超时竞态**：用户在超时瞬间提交，以服务端裁决为准（timer 先触发则提交按孤儿决策落账，`delivered:false`）——客户端不得本地判定超时后仍允许提交。
- **progressive 流式渲染与交互互斥**：`component_executing` 之前（args 未齐）组件必须禁用提交控件——半截 JSON 渲染出的表单不允许提交（现有 propAdapter 的 `ctx.status` 守卫模式推广为 L2 强制约束）。

## 7. 参考契约：ui_form（L2 首个落地组件）

```ts
export const FormFieldSchema = Type.Object({
  key: Type.String({ description: "字段标识，回传 values 的 key" }),
  label: Type.String({ description: "字段显示名" }),
  type: Type.Union([
    Type.Literal("text"), Type.Literal("textarea"), Type.Literal("number"),
    Type.Literal("boolean"), Type.Literal("select"), Type.Literal("date"),
  ]),
  description: Type.Optional(Type.String({ description: "字段含义说明——同时进入摘要词汇表" })),
  required: Type.Optional(Type.Boolean()),
  default: Type.Optional(Type.Unknown({ description: "预填默认值" })),
  options: Type.Optional(Type.Array(Type.Object({
    value: Type.String(), label: Type.String(),
  }), { description: "select 类型的可选项（value 为机器值，label 为人类文案）" })),
  unit: Type.Optional(Type.String({ description: "数值单位，摘要中附带" })),
  secret: Type.Optional(Type.Boolean({ description: "敏感字段：值不进模型上下文，走 §5 通道" })),
  placeholder: Type.Optional(Type.String()),
});

export const FormToolSchema = Type.Object(
  {
    title: Type.String({ description: "表单标题" }),
    description: Type.Optional(Type.String({ description: "为什么需要这些信息（展示给用户）" })),
    fields: Type.Array(FormFieldSchema, { minItems: 1 }),
    submitLabel: Type.Optional(Type.String()),
  },
  {
    $id: "ui_form",
    description: "需要用户补充结构化信息（参数、配置、凭证）时调用：渲染表单并挂起等待填写提交",
  }
);
```

`resultSchema` 由服务端从 `fields` **派生**（key→类型/required/枚举约束映射为 TypeBox），不允许模型自行声明——模型给的 fields 是输入，resultSchema 是推导结果，防止模型通过自定义 resultSchema 放宽校验。

## 8. 威胁与边界

| 边界 | 处置 |
|---|---|
| 模型 args 不可信 | 既有 propAdapter 守卫模式；新增「安全语义字段不透出」通则（approveShortcut 先例升格为规范条款） |
| UI 回传不可信 | 服务端按 resultSchema 边界校验后才进上下文；values 字符串内容仍是 prompt injection 面——摘要生成器对值做长度截断（单字段 ≤500 字符、摘要总长 ≤4000 字符），系统提示侧声明「表单值为数据非指令」 |
| 模型伪造交互 | 交互结果只能由 `/api/action` 通道产生；模型 tool_call 参数无法构造 component_ready |
| 重复提交 | actionId 幂等键 + body 哈希校验（同键异体 422），升格既有 getDecision 去重为契约 |
| 上下文膨胀 | 大表单摘要截断 + 附录整体长度上限（≤4KB，超出落变量引用） |
| secret 泄露 | 摘要/附录/轨迹台账/会话落库四处统一走 masked 形态（台账只记 ref） |
| L3 patch 风暴 | patch 不唤醒协程、不进模型上下文（仅服务端暂存）；模型只在 submit/cancel 时被唤醒——防止增量编辑刷屏上下文 |
| 旧客户端兼容 | 信封缺省无 `kind` 时按 L1 审批语义解析（`{approved, reason}` 旧形态）——Addition over modification，不破坏现存审批卡 |

## 9. 分阶段落地

- **Phase 1（协议与地基）**：`UIActionEnvelopeSchema` + `UIComponentDefinition.interaction` 声明 + 服务端 resultSchema 派生与边界校验 + 泛型摘要生成器 + 幂等契约化。不落任何新组件，审批卡迁移为信封形态（`kind:"submit", values:{approved}` 兼容层）回归验证。
- **Phase 2（首个 L2 组件）**：`ui_form` 端到端（协议 Schema → server 挂起/校验/摘要 → ui 组件 + propAdapter 绑定 onSubmitAction → playground 示例），含 secret 通道与校验失败重渲染闭环。
- **Phase 3（L3 协作落地）**：agent_plan 的 update:steps/retry 接入 patch 语义（已完成，见下方落地记录）；task_board 拖拽回传留待评估。

每阶段验收口径：协议改动过 `protocol:sync-check`；server 侧补契约测试（摘要快照、422 边界、幂等重放、secret 打码）；ui 侧补 propAdapter 不可信输入测试。

## 落地记录

Phase 1 / Phase 2 已全部落地（工作区任务 TASK-088~092 结单，收尾 TASK-093）：

| 实施任务 | 工作区任务 | 产出摘要 | 关键决策 |
|---|---|---|---|
| TASK-A 协议层 | TASK-088 | `interaction.ts`：UIActionEnvelope 三 kind 判别联合 / ActionMeta / UIComponentInteraction 声明 + `assertValidInteraction` 定义期校验 + `parseUIActionPayload` 规范化解析器（含旧审批形态兼容映射）；`UIComponentDefinition.interaction` 可选字段，`ApprovalActionPayloadSchema` 标注 `@deprecated`；102 个契约测试 | DEC-1795656818956-b696c8（解析器运行时只放 protocol 包，ui 包只 vendor 类型） |
| TASK-B server | TASK-089 | `action-envelope.ts`（resultSchema 边界校验 422+fieldErrors / 同键异体哈希 / 截断常量）+ `result-digest.ts`（§4.1 泛型摘要纯函数）；`handleResolveAction` 信封解析（400/422/patch 422）；L1 驳回迁移非错误信封摘要、批准双层 content；system-prompt 增「UI 交互结果说明」 | DEC-1795658195598-e8ff00（驳回迁移非错误信封摘要通道，ui_approval_card 声明 L1） |
| TASK-C ui runtime | TASK-090 | protocol-types vendor + sync 卡口扩 interaction.ts；渲染层 no-op 拦截桩守卫；`submitAction(toolCallId, envelope)` + 本地预校验（`meta.clientValidated`）；乐观更新信封语义；approval_card 产出 submit 信封 | DEC-1795658185200-15066b（deny 语义 / 守卫形态 / vendored 卡口扩展定稿） |
| TASK-D 审批迁移回归 | TASK-091 | E2E 核对修复 4 处衔接不一致：回传键名归一（note 优先 / reason 不反推）、卡片回写口径统一、deny 分支防御兜底、**送达路径幂等落账**（Redis 形态重复同体 200 `delivered:false`、异体 422）；HTTP 级 E2E 脚本 + 真实 LLM 三路径走查 | DEC-1795661048563-df4dcc（键名归一口径与送达路径幂等落账） |
| TASK-E ui_form | TASK-092 | `form.ts`（FormToolSchema 六型字段 + `deriveFormResultSchema` 派生器 + `liftFormResultSchema` 机械提升 + `coerceFormFields` 防御解析）；server L2 无审批挂起 + secret 剥离 ref 占位；ui `VaForm` + vendored 派生器副本 + form-errors 响应式通道 + FUNCTION_CORPUS 函数级卡口；playground 接线 | DEC-1795665320330-fedc13（fieldErrors 通道 / 派生钩子归属 / vendored 函数级卡口） |
| TASK-F 收尾 | TASK-093 | `pnpm llms` 重建；docs：VaForm 组件章节（agent-ops.md）+「自定义交互组件」指南 + protocol/actions.md 信封契约与错误码表；本文档与实施方案状态更新；changeset（protocol/server/ui 各 minor，显式列出模型可见文本变更） | - |

**Phase 3（L3 patch 运行时）已落地**：`kind: "patch"` 对「声明 L3 且挂起仍存活」的组件生效——增量值经 resultSchema 校验后写入服务端 PatchStash（不唤醒协程、不落账决策、不触发幂等哈希），submit 终态时合并 `{...patchBase, ...submit.values}` 后校验/摘要/落账；patchBase 随决策持久化以保证同体重放幂等重算。挂起已终结或多副本归属不符时 patch 分别返回 422 `PATCH_UNSUPPORTED` / 409。ui_agent_plan 声明 `collaborative: true` 即进入协作态（缺省纯展示不变）；task_board 接入留待评估。
