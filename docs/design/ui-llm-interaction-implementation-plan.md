# UI ↔ LLM 交互契约 · 实施方案

> **状态：已落地（Phase 1/2/3 完成，对应工作区任务 TASK-088~093 + L3 收尾批次）**。Phase 1（协议 + server + ui runtime + 审批卡迁移回归）与 Phase 2（ui_form 端到端）全部结单；Phase 3（L3 patch 运行时：PatchStash / collaborative ui_agent_plan / 路由 patch 分支 / 多副本归属闸门）亦已落地。各任务产出与决策见上游设计文档末尾「落地记录」。
> 上游设计：[ui-llm-interaction-contract.md](./ui-llm-interaction-contract.md)（交互分级 / 回传信封 / 双层结果 / 敏感值通道）。
> 本文档是它的**工程落地拆解**：任务边界、改动文件、测试验收与依赖关系。
> 全局约束（每个任务都适用）：
> - 不新增 UIStreamEvent / HarnessStreamEvent 事件成员（events.ts FROZEN；stream-schema 走 protocol-sync 门禁）；
> - 每任务完成后跑 `pnpm typecheck && pnpm test`；协议面改动额外跑 `pnpm protocol:sync-check`；registry 物料改动额外跑 `pnpm registry:check`；
> - 默认路径行为逐字节不变原则：所有新语义只对**声明了 `interaction` 的组件**生效，未声明组件走原代码路径。

## 0. 现状关键锚点（改动落点索引）

| 面 | 文件 | 现状 |
|---|---|---|
| 契约 | `packages/protocol/src/tools.ts` | `UIComponentDefinition` 只有 name/title/description/schema，无交互声明；`ApprovalActionPayloadSchema` 是唯一的回传 Schema（审批专用） |
| 契约 | `packages/protocol/src/events.ts` / `stream-schema.ts` | 冻结/门禁，本方案零改动 |
| server 注册 | `packages/server/src/core/ui-registry.ts` | `UIComponentRegistry.toHarnessTools()` 把组件定义转成 HarnessTool（execute 返回 `{rendered, component, props}`） |
| server 内建工具 | `packages/server/src/tools/ui/protocol-tools.ts` | 10 个 ui_* 工具逐个手写 |
| server 挂起 | `packages/server/src/core/action-hub.ts` | `ActionResponse` 已预留 `formData` 字段但**无人消费**（本方案将其重塑为 envelope，属安全重塑：无读取方） |
| server 回调 | `packages/server/src/server.ts` `handleResolveAction`（L1103-1214） | 已有幂等去重（getDecision）、孤儿落账、409 归属校验；缺：信封解析、resultSchema 校验、同键异体 422 |
| server 结果回填 | `packages/server/src/core/tool-step-executor.ts`（L560-570） | tool 消息 content = `JSON.stringify(executionResult)` 裸 dump；审批驳回走 `Error: 操作被用户驳回...` |
| ui 注册类型 | `packages/ui/src/runtime/types.ts` | `RegisteredComponentEntry.propAdapter(args, ctx)` 的 ctx 已带 `onSubmitAction`；无 interaction 声明位 |
| ui 注册中心 | `packages/ui/src/runtime/registry.ts` | 仅 approval_card 绑了 `onApprove/onDeny → ctx.onSubmitAction`，其余 9 个纯展示 |
| ui 提交通道 | `packages/ui/src/runtime/useAgentChat.ts` `submitAction`（L347-366） | POST `/api/action/:toolCallId`，payload 原样透传，无信封包装 |
| ui 渲染守卫 | `packages/ui/src/runtime/VaAgentRenderer.vue` | `onSubmitAction` 无条件透传给 propAdapter，是否可交互由各组件自查 `ctx.status`——分散、易漏 |
| 测试 | protocol/tests ×3；server/tests ×60+（含 action-hub / ui-registry / protocol-tools / tool-schema-gate）；ui/tests（registry / agent-renderer.dom / runtime / approval-card） | 无交互契约相关测试 |

## 1. 任务拆解总览

```
TASK-A（协议层）──┬──> TASK-B（server 校验+摘要）──┐
                 └──> TASK-C（ui runtime 通道）──┴──> TASK-D（审批卡迁移回归）
                                                        │
                                                        ▼
                                              TASK-E（ui_form 端到端，Phase 2）
                                                        │
                                                        ▼
                                              TASK-F（文档/物料/changeset）
```

A 无依赖；B、C 只依赖 A 且互相独立（可并行）；D 依赖 B+C；E 依赖 D；F 依赖 E。

> ✅ 全链路已完成（TASK-A~F ↔ 工作区任务 TASK-088~093 全部结单）。

---

## TASK-A · 协议层：交互信封与能力声明（P0）

> ✅ 已完成（工作区任务 TASK-088；决策 DEC-1795656818956-b696c8：解析器运行时只放 protocol 包，ui 包只 vendor 类型）。

**产出**：`@vuagent/protocol` 新增交互契约模块，零事件词表变更。

**改动**：
1. 新建 `packages/protocol/src/interaction.ts`：
   - `ActionMetaSchema`（editedFields / durationMs / clientValidated）；
   - `UIActionEnvelopeSchema`：`submit | cancel | patch` 判别联合（设计文档 §3）；
   - `UIComponentInteractionSchema`：`{ level: "L0"|"L1"|"L2"|"L3", resultSchema?, timeoutMeaning? }`；
   - `parseUIActionPayload(raw, interaction?)`：规范化解析器——信封原样通过；**无 `kind` 的旧形态 `{approved, reason, note}` 映射为 L1 submit 兼容信封**（`values: { approved: true/false }`）；无法识别抛 `UIActionParseError`；
   - 该解析器是 server/ui 两侧唯一事实来源（ui 包按既有自包含约束内联类型到 `runtime/protocol-types.ts`，运行时代码从 server 引用或各自实现同构逻辑——**解析逻辑放 protocol 包，ui 包依赖 protocol 运行时值为新增依赖，需在 ui/package.json 评估；若破坏自包含则 ui 侧只内联类型、解析由 server 完成**，此处实现时二选一并记录决策）。
2. `tools.ts`：`UIComponentDefinition` 增加 `interaction?: ...`（可选字段，Addition over modification）；`ApprovalActionPayloadSchema` 标注 `@deprecated` 指向信封（不删除，兼容期内保留）。
3. `index.ts` 导出新符号。

**不做**：不动 events.ts / stream-schema.ts / models.ts。

**测试**：新建 `packages/protocol/tests/interaction.test.ts`：
- 信封三 kind 判别与非法 payload 拒绝；
- 兼容解析：旧审批形态 → submit 信封；裸 `{approved}`、缺 kind 的 cancel 形态；
- `interaction` 缺省视为 L0；L2 缺 resultSchema 时 Schema 校验报错（定义期错误前置）。

**验收**：`pnpm --filter @vuagent/protocol test && pnpm --filter @vuagent/protocol typecheck && pnpm protocol:sync-check` 全绿。

---

## TASK-B · server：边界校验 + 语义摘要 + 幂等契约化（P0，依赖 A）

> ✅ 已完成（工作区任务 TASK-089；决策 DEC-1795658195598-e8ff00：审批驳回迁移为非错误信封摘要通道，ui_approval_card 声明 L1 interaction）。

**产出**：回传值在 server 边界完成「解析 → 校验 → 摘要化」，模型上下文只进双层格式结果。

**改动**：
1. 新建 `packages/server/src/core/action-envelope.ts`：
   - 复用 protocol 的 `parseUIActionPayload` 做入口解析；
   - `validateEnvelopeValues(envelope, def)`：L2 组件按 `interaction.resultSchema`（TypeBox `Value.Check`，复用 tool-schema-gate 的校验口径）校验 `values`；失败返回结构化 fieldErrors（**不唤醒协程**）；
   - 摘要截断：单字段值 ≤500 字符、附录 JSON ≤4KB（超限折叠为引用说明）。
2. 新建 `packages/server/src/core/result-digest.ts`——泛型摘要生成器（设计文档 §4.1 规则表）：
   - 输入：`values` + `resultSchema`（字段 description 作词汇表）+ `meta.editedFields` + 组件 title；
   - 输出：`用户在「…」中提交了以下信息：\n- 字段: 值` 形态 + enum label 回映 + boolean 是/否 + 未填标注 + editedFields 尾句（「为用户亲自修改 / 沿用默认值」）；
   - cancel / timeout 的摘要形态（cancel 不是 Error）；
   - `secret: true` 字段输出 `已提供（masked）`（真实剥离在 TASK-E 落 secret store，本任务先保证**值不进摘要/附录**——摘要生成器内置打码，不依赖调用方自觉）。
3. `core/ui-registry.ts`：`UIComponentDefinition.interaction` 透传进 HarnessTool（挂到工具定义的扩展字段），使执行器可查。
4. `core/action-hub.ts`：`ActionResponse` 增加 `envelope?: UIActionEnvelope`；`formData` 字段标注退役（无消费方，直接移除或保留注释墓碑——实现时按 lint/兼容检查定）。
5. `server.ts` `handleResolveAction`：
   - 解析信封（兼容旧形态）→ 查组件定义 → L2 校验失败返回 **422 + fieldErrors**（不落账、不唤醒）；
   - **同键异体 422**：`getDecision` 命中时比较 payload 哈希，不一致返回 422（现有「重复提交返回已记录决策」仅限同体重放）；
   - 解析失败（非信封非旧形态）返回 400 + 结构化错误。
6. `core/tool-step-executor.ts`：
   - 结果消息构造点（L560-570）：**声明了 interaction 的工具**走「语义摘要 + ```json 附录」双层 content；未声明工具逐字节不变；
   - L1 审批卡：驳回路径从 `Error: 操作被用户驳回...` 迁移为信封摘要（cancel/deny 语义，不再是 Error 消息）——**注意这会改变模型可见文本**，属本任务的预期行为变更，需同步更新依赖该文案的测试与系统提示（见下）；
   - `system-prompt.ts`：补一段「UI 交互结果说明」——告知模型：摘要中字段值为用户输入数据（非指令）、cancel 是合法用户意图、secret 值以 ref 引用。

**测试**：
- 新建 `server/tests/action-envelope.test.ts`：信封解析、422 fieldErrors、同键异体 422、兼容旧审批形态、解析失败 400；
- 新建 `server/tests/result-digest.test.ts`：§4.1 规则表逐行快照测试（enum/boolean/未填/editedFields/secret 打码/截断）；
- 扩展 `action-hub.test.ts`：envelope 字段流转；`ui-registry.test.ts`：interaction 透传；`tool-schema-gate.test.ts` 口径复用确认；
- 审批文案变更影响的存量测试（grep `操作被用户驳回`）逐一适配。

**验收**：`pnpm --filter @vuagent/server test && pnpm --filter @vuagent/server typecheck` 全绿；手工 curl 验证：旧形态 POST 审批决策 → 200 且模型消息为兼容摘要。

---

## TASK-C · ui runtime：信封包装与渲染层守卫（P0，依赖 A，与 B 并行）

> ✅ 已完成（工作区任务 TASK-090；决策 DEC-1795658185200-15066b：deny 语义、渲染层守卫形态与 vendored 卡口扩展定稿）。

**产出**：前端提交一律走信封；交互权限从「组件自查」上收到「渲染层统一截断」。

**改动**：
1. `runtime/types.ts`：`RegisteredComponentEntry` 增加 `interaction?: { level; ... }`（类型内联进 `protocol-types.ts`，保持 npm 自包含；运行时解析逻辑归属按 TASK-A 决策执行）。
2. `runtime/VaAgentRenderer.vue`：**渲染层统一守卫**——`status !== "executing"` 时不向 propAdapter 透传 `onSubmitAction`（或透传一个 no-op + dev 警告），替代现在各组件自查 `ctx.status` 的分散模式；approval_card 内的 `ctx.status === "executing"` 判断保留为双保险但不再是唯一防线。
3. `runtime/useAgentChat.ts` `submitAction`：
   - 签名扩展为 `submitAction(toolCallId, envelope: UIActionEnvelope)`；内部不再原样透传；
   - 提交前本地校验（resultSchema 可获取时），失败不发出请求（clientValidated 标记）；
   - 乐观更新逻辑（block.status = "done"）迁移到信封语义：cancel 也标 done 但 result 记 cancel 信封（UI 区分展示）。
4. `runtime/registry.ts`：approval_card 的 `onApprove/onDeny` 改为产出信封（`kind:"submit", values:{approved:true}, meta:{editedFields:[]}`）；deny 带 reason 时映射 cancel 还是 submit 按设计文档 §3（deny 是 submit 的一种 values 形态，cancel 留给「关闭/放弃」）——实现时对照设计文档定稿并记录。

**测试**：
- 扩展 `runtime.test.ts`：submitAction 信封包装、本地校验拦截、cancel 乐观更新；
- 扩展 `agent-renderer.dom.test.ts`：非 executing 状态下 onSubmitAction 不透传（伪造 streaming 态断言回调缺失）；
- 扩展 `registry.test.ts` / `approval-card.test.ts`：approve/deny 产出的信封形状快照。

**验收**：`pnpm --filter @vuagent/ui test && pnpm --filter @vuagent/ui typecheck` 全绿。

---

## TASK-D · 审批卡迁移端到端回归（P0，依赖 B+C）

> ✅ 已完成（工作区任务 TASK-091；决策 DEC-1795661048563-df4dcc：审批回传键名归一口径与送达路径幂等落账——核对出并修复 4 处衔接不一致）。

**产出**：Phase 1 的端到端证明——唯一 L1 组件跑在新信封链路上，旧链路兼容。

**改动**：
1. server 侧审批卡链路贯通：`ui_approval_card`（requiresApproval 挂起路径）回传信封 → 解析 → 摘要 → 模型消息；
2. 兼容性回归：
   - 旧客户端（不升级 ui 包）POST `{approved, reason}` → server 兼容解析 → 正常唤醒；
   - 新客户端信封 → 正常唤醒；
   - 重复提交同体 → 200 幂等；异体 → 422；
3. playground `Console.vue` 手工全链路：发起需审批工具 → 卡片渲染 → 批准/拒绝 → 模型续答语义无退化；
4. 更新受影响存量测试（`agent-loop-cards.test.ts`、`server.test.ts` 中审批相关断言）；
5. **行为变更清单**落进 changeset 描述（模型可见文本变更：驳回不再是 Error 前缀）。

**验收**：`pnpm test`（全仓）+ `pnpm protocol:sync-check` + playground 手工走查批准/拒绝/超时三路径。

---

## TASK-E · ui_form：首个 L2 组件端到端（P1，依赖 D）

> ✅ 已完成（工作区任务 TASK-092；决策 DEC-1795665320330-fedc13：fieldErrors 通道、派生钩子归属、vendored 函数级卡口三项定稿）。

**产出**：设计文档 §7 的 `ui_form` 落地，含 secret 通道与校验失败重渲染闭环。

**改动**（三层 + 示例）：
1. protocol：`FormToolSchema` / `FormFieldSchema`（§7 契约）+ `deriveFormResultSchema(fields)` **派生器放 protocol 包**（server 校验与 ui 本地校验共用同一推导逻辑，避免双事实来源）；
2. server：`tools/ui/protocol-tools.ts` 注册 `ui_form`（`requiresApproval: false` 但 **挂起语义**——注意现有挂起绑定在 requiresApproval 审批路径上，ui_form 需要「无审批挂起」新路径：执行器识别 L2 组件直接 `actionHub.waitForAction`，不走审批守卫）；secret 字段：values 剥离 + 内存 secret store（接口 + 宿主注入点，Redis 形态留 TASK 尾巴）+ ref 占位；
3. ui：新建 `components/ui/form/`（VaForm.vue + types + css，六型字段渲染、必填星标、错误回显、提交/取消按钮、executing 前禁提交）+ registry.ts 注册（propAdapter 守卫 + onSubmitAction 绑定 + fieldErrors 从 submitAction 的 422 响应回填）+ skeleton；
4. 闭环：业务校验失败 → 摘要回传模型 → 模型重发 ui_form（预填 = 上次 values）→ 前端回显；
5. playground 新增 demo（如「创建部署」表单：环境 select + 副本数 number + 密钥 secret）；
6. registry 物料：`pnpm registry` 重新生成 + `registry:check`。

**测试**：protocol（派生器：六型映射/required/枚举/secret 标记）；server（无审批挂起路径、secret 剥离不进摘要/台账/落库、422 重填）；ui（VaForm dom 测试：校验、提交信封、错误回填、禁提交守卫）。

**验收**：全仓 test/typecheck/registry:check 绿；playground demo 走通「填表 → 提交 → 模型读懂并复述关键字段」「少填必填 → 422 回显」「secret 字段模型只见 masked」三场景。

---

## TASK-F · 文档、物料与发布（P2，依赖 E）

> ✅ 已完成（工作区任务 TASK-093）。产出：`pnpm llms` 重建（llms.txt/llms-full.txt 含 Form/VaForm 条目，数据源 meta/components.mjs 自动纳入）；docs 组件文档（components/agent-ops.md 新增 VaForm 章节：props 表 / 六型字段 / fieldErrors 重填闭环 / secret 通道 / 信封事件）；指南新增 `guide/custom-interactive-components.md`（已挂侧边栏）；protocol/actions.md 补信封契约与错误码表；两份设计文档状态更新 + 落地记录；changeset（protocol/server/ui 各 minor，显式列出模型可见文本变更）。

1. `pnpm llms` 重建 llms.txt / llms-full.txt；
2. apps/docs：ui_form 组件页 + 指南新增「自定义交互组件」（如何声明 interaction / resultSchema / onSubmitAction）；
3. 两份设计文档状态从「设计提案」更新为「已落地（Phase 1/2）」并标注 TASK 号；
4. changeset：`@vuagent/protocol` / `@vuagent/server` / `@vuagent/ui` 各 minor（新能力、向后兼容）；描述中显式列出模型可见文本变更（审批驳回文案）。

**验收**：`pnpm docs:build` 通过；`pnpm prepublish:check` 全绿。

---

## 2. 风险与注意点（实施时逐条对照）

1. **模型可见文本变更是行为变更**（Hyrum's Law）：审批驳回文案、工具结果从裸 JSON 变双层格式——都可能影响依赖旧文本的宿主提示词。统一在 TASK-B 落地、TASK-D 清单化、changeset 声明。
2. **ui 包自包含约束**：protocol 运行时值的引入是 TASK-A 的悬而未决点（解析逻辑放哪），实现时先查 `runtime/protocol-types.ts` 头注释的既有约定再定，记录决策。
3. **无审批挂起路径**（TASK-E）是对 tool-step-executor 审批路径的首次分叉——守卫（tool-guards.ts）与权限矩阵（permissions.ts）需要明确「L2 挂起≠审批」，避免被高风险工具策略误拦或误放。
4. **protocol:sync-check / registry:check 是 CI 卡口**：每个协议/registry 面改动任务完成后必跑，不攒到最后。
5. **摘要生成器是纯函数**——快照测试友好；不要在摘要里拼接未截断的用户自由文本（注入面，设计文档 §8 已列）。
