---
"@vuagent/protocol": minor
"@vuagent/server": minor
"@vuagent/ui": minor
---

UI↔LLM 交互契约落地（Phase 1/2/3，docs/design/ui-llm-interaction-contract.md）：组件回传从自由 payload 升级为契约化信封，新增 L2 值采集与 L3 协作编辑能力。

**新增交互契约面**

- `@vuagent/protocol`：新增 `interaction.ts`——`UIActionEnvelope`（submit/cancel/patch 判别联合）+ `ActionMeta`（editedFields/durationMs/clientValidated）+ `UIComponentInteraction` 能力声明（level/resultSchema/deriveResultSchema/timeoutMeaning，`assertValidInteraction` 定义期校验）+ `parseUIActionPayload` 规范化解析器（旧审批形态 `{approved, reason, note}` 兼容映射为 L1 submit 信封）；`UIComponentDefinition` 增加可选 `interaction` 字段；`ApprovalActionPayloadSchema` 标注 `@deprecated`。新增 `form.ts`——`FormToolSchema` 六型字段（text/textarea/number/boolean/select/date）+ `deriveFormResultSchema`（resultSchema 由 fields 派生，模型不允许自行声明）+ `liftFormResultSchema`（机械提升为 TypeBox）+ `coerceFormFields`（入参防御解析）。
- `@vuagent/server`：`HarnessTool` 增加可选 `interaction` 扩展字段（ui-registry 注册期透传并校验）；新增 `ui_form` 工具——首个 L2 组件，无审批挂起（`requiresApproval=false`，挂起由 L2 声明驱动），secret 字段值路由边界剥离入 secret store、模型只见 `{ ref, masked }` 占位；system-prompt 新增「UI 交互结果说明」块。
- `@vuagent/ui`：新增 `VaForm` 六型字段表单卡与 `ui_form` 注册条目（422 fieldErrors 经 form-errors 响应式通道就地回显，重填闭环）；`useAgentChat.submitAction` 签名改为 `(toolCallId, envelope: UIActionEnvelope)`，声明 resultSchema 的组件提交前本地预校验（失败不发请求），通过则标记 `meta.clientValidated`；渲染层对 streaming/done/error 态透传 no-op 拦截桩守卫；信封/交互类型 vendor 进 `runtime/protocol-types.ts`（npm 自包含约束不变，peer 仅 vue）。

**Phase 3：L3 协作运行时（同批落地）**

- `@vuagent/protocol`：`AgentPlanToolSchema` 增加可选 `collaborative` 布尔（模型显式声明才进入协作挂起，缺省纯展示行为不变）；新增 `PlanCollabResultSchema`。
- `@vuagent/server`：新增 `core/patch-stash.ts`（内存增量暂存：按键合并 / 容量 500 逐出 / 终态清理钩子）；路由 patch 分支——对「声明 L3 且挂起仍存活」的组件 `200 {accepted:true, patchKeys}`（不唤醒协程、不落账、不触发幂等哈希），挂起终结 422 `PATCH_UNSUPPORTED`，多副本归属不符 409 `PENDING_OWNED_BY_OTHER_INSTANCE`；L3 submit 终态合并 `{...patchBase, ...submit.values}` 后校验/摘要/落账，patchBase 随决策持久化保证同体重放幂等重算；`ui_agent_plan` 声明 L3（`timeoutMeaning:"cancel"`）；执行器挂起条件扩展为 `L2 || (L3 && collaborative)`；system-prompt 补协作语义说明。
- `@vuagent/ui`：VaAgentPlan 新增协作态（编辑步骤发 patch、失败步骤重试发 `submit{retryStepId}`、「确认计划」发空 submit、「放弃」发 cancel，三层守卫）；registry `ui_agent_plan` 声明 `interaction {level:"L3"}`。
- **决策落账持久化扩展**：新增 SQLite 形态 `decisions` 表（`storage/sqlite-action-persist.ts`，复用存储驱动连接）——送达后的重复提交在单机形态同样幂等（同体 200 delivered:false / 异体 422）；Redis 形态维持 24h TTL 决策外置。

**模型可见文本行为变更**（依赖旧文本的宿主提示词需注意）

- 审批**驳回**从错误通道（`Error: 操作被用户驳回...`）迁移为非错误信封语义摘要（`isError=false`，含「这是用户的明确决定而非系统错误，不要换汤不换药重试」引导语）；
- 审批**批准**的工具结果从裸 JSON dump 变为「批准摘要 + ```json 附录」双层 content；
- 回传体非法（既非信封也非旧形态）返回 `400 ACTION_PAYLOAD_INVALID`；
- `kind: "patch"`：对 L3 协作组件（挂起存活）返回 `200 {accepted:true}`（不唤醒模型）；发往非 L3 组件或已终结挂起返回 `422 PATCH_UNSUPPORTED`；
- 同 actionId **异体**重放返回 `422 ACTION_PAYLOAD_MISMATCH`（键序无关哈希比对）；
- 送达路径幂等落账：Redis 形态（24h TTL）与 SQLite 形态（`decisions` 表）下重复同体提交从 404 谎报改为 `200 delivered:false` 返回已落账决策；
- 审批卡回写文案统一为 note 优先、reason 兜底（与执行器同口径；reason 不从 note 反推，防止人工驳回被误分类为服务端超时裁决）。
