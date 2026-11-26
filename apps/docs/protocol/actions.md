# HITL 动作与审批回调协议

> 在真实生产业务中，高风险操作（转账、退款、删除数据库、执行 Shell 命令等）绝对不能由大模型盲目自主决定。必须引入 **人机协同（Human-in-the-Loop, HITL）** 机制。

本章详细说明 Vuagent 规定的动作回调契约与状态流转。

---

## 交互时序图

### L1 · 审批决策（approve / deny）

```text
大模型                Harness 服务端                前端 VaAgentRenderer        业务操作人员
  │                        │                               │                      │
  │── 发起高风险工具 ─────▶│                               │                      │
  │                        │── 权限判定: 需人工审批 ───────│                      │
  │                        │── 协程挂起 (挂起等待 Promise)  │                      │
  │                        │── 下发 suspended 事件 ───────▶│                      │
  │                        │                               │── 渲染审批卡片 ─────▶│
  │                        │                               │                      │
  │                        │                               │◀── 点击【批准】 ─────│
  │                        │◀── POST /api/action/:id ──────│                      │
  │                        │    (提交决策 payload)         │                      │
  │                        │── 唤醒挂起协程                │                      │
  │                        │── 下发 resumed 事件 ─────────▶│ (卡片更新为已处理)    │
  │◀── 注入审批结果摘要 ──│  (驳回/取消走非错误信封摘要，  │                      │
  │── 继续后续推理 ───────│   isError=false，不诱导重试)  │                      │
```

### L2 · 表单值采集（ui_form：submit / cancel / 422 重填闭环）

```text
大模型                Harness 服务端                    前端表单卡               用户
  │                        │                               │                      │
  │── 调用 ui_form ──────▶│                               │                      │
  │                        │── L2 无审批挂起 ──────────────│                      │
  │                        │   (协程挂起，非审批通道)      │                      │
  │                        │── 下发 suspended 事件 ───────▶│                      │
  │                        │                               │── 渲染 VaForm ─────▶│
  │                        │                               │   (executing 前禁提交)│
  │                        │                               │                      │
  │                        │  ┌──────────────────────────────────────────────────┐  │
  │                        │  │ 校验失败是重填的新输入（非终态）：               │  │
  │                        │◀─│ 必填缺失/类型错 → 本地拦截不发请求；             │
  │                        │422│ server 复核失败 → 422 fieldErrors              │
  │                        │  │ → 表单就地回显，用户修正后重提交                │  │
  │                        │  └──────────────────────────────────────────────────┘  │
  │                        │                               │                      │
  │                        │                               │◀── 填写后提交 ───────│
  │                        │                               │   {kind:"submit",    │
  │                        │◀── POST /api/action/:id ──────│    values, meta}     │
  │                        │    secret 字段先剥离 →        │                      │
  │                        │    {ref, masked} 占位         │                      │
  │                        │── 校验合并值（resultSchema）──│                      │
  │                        │── 唤醒挂起协程 ───────────────│  (表单卡收口为已提交)│
  │                        │── 下发 resumed 事件 ─────────▶│                      │
  │◀── 双层结果消息 ──────│  (语义摘要 + JSON 附录；      │                      │
  │── 精确取用字段值 ─────│   enum 回映 label、secret 打码)│                     │
  │                        │                                                │
  │   用户取消：POST {kind:"cancel"} → 非 Error 语义唤醒（放弃≠失败，      │
  │   模型不应重试轰炸）；超时由服务端裁决（timeoutMeaning=cancel）        │
```

### L3 · 协作计划（collaborative ui_agent_plan：patch 增量不唤醒）

```text
大模型                Harness 服务端                    前端计划卡               用户
  │── 调用 ui_agent_plan▶│                               │                      │
  │   (collaborative:   │── L3 无审批挂起 ──────────────│                      │
  │    true)            │── 下发 suspended 事件 ───────▶│── 渲染协作计划卡 ───▶│
  │                     │                               │                      │
  │                     │◀── POST {kind:"patch", ───────│◀── 编辑/增删/排序 ───│
  │                     │    values:{steps}} ───────────│   步骤（每次变更）   │
  │   （patch 仅服务端  │── 暂存 PatchStash ────────────│                      │
  │      暂存，不唤醒） │   200 {accepted:true}        │                      │
  │                     │                               │◀── 点【确认计划】────│
  │                     │◀── POST {kind:"submit"} ──────│                      │
  │                     │── 合并 patch+submit 值 ───────│                      │
  │                     │── 校验 → 唤醒协程 → 双层摘要  │                      │
  │◀── 合并后的计划 ────│                               │                      │
```

> 通用语义：`cancel` 是一等公民而非错误（放弃 ≠ 失败，模型不应换汤不换药重试）；超时由服务端裁决（L1 timeoutMeaning 缺省 deny / L2·L3 缺省 cancel），不允许客户端伪造；重试风暴防护见上文响应规范。

---

## 接口定义

### 1. 回调端点
```http
POST /api/action/:actionId
Content-Type: application/json
```

* **`:actionId`**：路径参数，对应服务端在 `suspended` 事件中下发的动作唯一标识符（通常为 `toolCallId` 或专门生成的 `actionId`）。

### 2. 请求载荷 (Payload)

载荷是 **UIActionEnvelope 回传信封**（`@vuagent/protocol` `interaction.ts` 定义，判别联合），以 `kind` 字段区分三形态；同时兼容历史审批卡的旧形态载荷。

**信封形态（推荐）**：

```json
// submit：用户提交结构化值（L1 决策 / L2 表单共用）
{
  "kind": "submit",
  "values": { "approved": true },
  "meta": { "editedFields": ["environment"], "clientValidated": true }
}

// cancel：用户主动取消/放弃——一等公民而非错误，模型感知「用户放弃」而非报错重试
{
  "kind": "cancel",
  "reason": "暂时不需要了"
}

// patch：L3 增量编辑（仅对声明 L3 且挂起仍存活的协作组件生效；服务端暂存
// PatchStash 并返回 200 {accepted:true}，不唤醒协程；其余情况 422 PATCH_UNSUPPORTED）
{ "kind": "patch", "values": { "replicas": 4 } }
```

字段说明：

* **`values`**：提交的键值集合，形状由组件 `interaction.resultSchema` 约束（L2/L3 必过服务端边界校验）；
* **`meta.editedFields`**：用户**亲自修改过**的字段 key（预填默认值透传不计入）——模型据此区分「用户确认过」与「默认值照抄」；
* **`meta.clientValidated`**：前端本地预校验已通过的标记（服务端仍必须复核）；
* **超时不进信封**：超时由服务端 ActionHub 裁决生成，不允许客户端伪造。

**旧形态兼容**（无 `kind` 的审批卡历史载荷，解析器自动映射为 L1 submit 信封）：

```json
{
  "approved": true,
  "reason": "manual",
  "note": "运营确认金额无误，同意退款"
}
```

### 3. 响应规范

| 状态码 | code / 标记 | 场景与语义 |
|---|---|---|
| `200` | `{ success: true }` | 决策送达挂起协程，正常唤醒 |
| `200` | `{ success: true, delivered: false, prior }` | **幂等命中**：同 actionId 同体重复提交（body 哈希一致），返回已落账决策，不重复唤醒 |
| `200` | `{ success: true, delivered: false, note }` | **孤儿落账**：所属执行已随进程重启中断，决策记录并回写审批卡，不唤醒执行（诚实语义） |
| `400` | `ACTION_PAYLOAD_INVALID` | 回传体既非合法信封也非旧审批形态（`parseUIActionPayload` 解析失败） |
| `404` | `{ success: false }` | actionId 无挂起且无落账决策（不存在/已过期清理） |
| `409` | `PENDING_OWNED_BY_OTHER_INSTANCE` | 多副本部署时挂起轮次由其他副本持有，本副本不能判定其中断——请重试路由到持有副本 |
| `422` | `ENVELOPE_VALUES_INVALID` + `fieldErrors` | submit values 未过组件 `resultSchema` 校验——**不唤醒协程、不落账**，前端就地回显错误供重填 |
| `422` | `ACTION_PAYLOAD_MISMATCH` | 同 actionId **异体**重放（body 哈希与已落账决策不一致），拒绝覆盖 |
| `422` | `PATCH_UNSUPPORTED` | `kind: "patch"` 发往非 L3 组件、或挂起已终结（L3 协作组件的 patch 语义见上方时序图：存活时返回 `200 {accepted:true, patchKeys}`） |
| `426` | `PROTOCOL_VERSION_MISMATCH` | 显式携带 `x-vuagent-protocol-version` 且主版本不兼容（未携带头的旧客户端放行） |

幂等键 = `actionId`，配合**键序无关的规范化 body 哈希**判定同体/异体：同体重放直达已落账决策（幂等），异体重放 422 拒绝（防误重试覆盖他人决策）。

::: tip secret 字段
L2 表单中 `secret: true` 字段的值在校验通过后、唤醒/落账之前于**服务端路由边界剥离**：真实值入 secret store（宿主注入点），原位替换为 `{ ref, masked }` 占位。模型上下文、轨迹台账、会话落库与摘要只见占位，永远拿不到明文。`ref` 按 `actionId + field` 确定性推导，同键重放剥离结果逐字节一致，幂等哈希不受剥离影响。
:::

---

## 超时与熔断保护

为了防止后端协程无限期处于挂起假死状态，协议规定：

1. **下发超时时间**：在 `suspended` 事件中必须携带 `timeoutMs`（如 `60000` 毫秒）；
2. **服务端看门狗**：到达超时时间仍未收到用户回调，服务端协程自动拒绝（`reason: "timeout"`），唤醒后续逻辑，并向前端广播 `aborted` 或错误事件；
3. **前端倒计时视觉**：前端 `VaApprovalCard` 可消费 `timeoutMs` 呈现倒计时进度条，超时后自动锁定按钮为置灰不可点击状态。

---

## 跨会话审批收件箱支持

在企业级管理后台中，审批并不一定由当前发起聊天的用户实时点击，可能需要推送到专职主管的**统一待办收件箱**中。

由于 `actionId` 与 `toolCallId` 具有全局唯一性，主管可以在完全不同的页面或设备上打开审批卡片，直接调用 `POST /api/action/:actionId`，服务端同样能精准定位并唤醒原执行会话！

---

## 回传信封契约（interaction.ts）

`@vuagent/protocol` 的 `interaction.ts` 是「UI → LLM」方向回传载荷的**单一事实来源**（设计文档：`docs/design/ui-llm-interaction-contract.md`，已落地 Phase 1/2）。三个组成面：

### UIActionEnvelope —— 回传信封

`submit / cancel / patch` 判别联合（形状见上文请求载荷）。设计原则：

* **cancel 是一等公民而非错误**——混为 error 会诱导模型对用户决策「换汤不换药」重试轰炸；L1 驳回/超时/取消统一走非错误通道（`isError=false` 的语义摘要），模型可见文本明确告知「这是用户的明确决定而非系统错误」；
* **timeout 不进信封**——超时的权威裁决在服务端 ActionHub（按组件 `timeoutMeaning`），客户端倒计时触发的操作仅以 `note: "timeout"` 作展示性标记。

### UIComponentInteraction —— 组件交互能力声明

挂在工具/组件定义上（`HarnessTool.interaction` / `registerAgentComponent` 的 `interaction`），声明与校验（`assertValidInteraction`）都发生在**定义期**：

| 字段 | 类型 | 约束 |
|---|---|---|
| `level` | `"L0" \| "L1" \| "L2" \| "L3"` | L0 纯展示（缺省）；L1 决策型；L2 值采集；L3 协作型 |
| `resultSchema` | TSchema | L2/L3 必填（或与 `deriveResultSchema` 二选一）：边界校验规则 + 模型词汇表 + 摘要模板，一身三任 |
| `deriveResultSchema` | `(args) => TSchema` | Schema 由模型入参决定时使用（`ui_form` 先例）；**模型不允许自行声明 resultSchema**，防放宽校验 |
| `timeoutMeaning` | `"deny" \| "cancel"` | 挂起超时语义：deny（L1 缺省）/ cancel（L2 缺省）；**超时不得映射为 submit**（半成品值不得当作用户意图） |

分级语义与声明方法详见指南[「自定义交互组件」](/guide/custom-interactive-components)。

### parseUIActionPayload —— 规范化解析器

服务端路由边界的**唯一解析入口**：合法信封直通（TypeBox 形状校验）；无 `kind` 的旧审批形态兼容映射为 L1 submit 信封（Addition over modification，不破坏存量审批卡）；其余抛 `UIActionParseError`（路由层映射为 400 `ACTION_PAYLOAD_INVALID`）。

解析器作为运行时值只存在于 `@vuagent/protocol`（server 侧唯一消费）；`@vuagent/ui` 因 npm 自包含约束只 vendor 类型、以对象字面量构造信封——两侧文本由 `pnpm protocol:sync-check` 卡口机械锁死。

### 模型可见文本（行为变更提示）

对接方若在自有提示词中依赖旧的审批结果文本格式，注意以下模型可见行为已变更（详细清单见仓库 `.changeset/` 对应条目）：

* L1 审批**驳回**：从 `Error: 操作被用户驳回...` 错误通道迁移为非错误信封摘要（含驳回原因与「不要重试」引导语）；
* L1 审批**批准**：工具结果从裸 JSON dump 变为「语义摘要 + ```json 附录」双层 content；
* L2 表单**提交/超时/取消**：工具结果为泛型摘要（字段词汇表回映、枚举 label 回映、unit 后缀、未填标注、secret 打码、4KB 截断附录）。
