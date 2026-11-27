# @vuagent/server

## 0.7.0-next.0

### Patch Changes

- @vuagent/protocol@0.7.0-next.0

## 0.6.0

### Minor Changes

- 82a35fd: UI↔LLM 交互契约落地（Phase 1/2/3，docs/design/ui-llm-interaction-contract.md）：组件回传从自由 payload 升级为契约化信封，新增 L2 值采集与 L3 协作编辑能力。
  
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

### Patch Changes

- Updated dependencies [82a35fd]
  - @vuagent/protocol@0.6.0

## 0.5.0

### Minor Changes

- 动效体系强化轮（五维审视落地：触发打断 / 时间物理 / 空间连续 / 反馈容错 / 性能无障碍）。
  
  **@vuagent/ui（本轮唯一功能性变更包；protocol/server 无接口变化，随 fixed 三包联动升版）**
  
  - **错误反馈标准 `.va-shake`**：校验失败横向微振 ±3px（`--va-dur-2` × 2），reduced-motion 降级为不播（可感知性由错误样式承担）；配套 `useShake()` composable，`VaStepperForm` / `VaOtpInput` 经 `defineExpose({ shake })` 暴露给宿主，宿主自绘表单可直接挂类。错误语义仍需宿主以文案/aria 披露
  - **行级按压反馈分轨口径**：file-tree / notification-stack / session-manager 行与 command-menu / dropdown / select 选项补 `:active`——表面朝 `--va-ink` 混 15% 加深（主题自适应方向），选中/高亮行保持 accent 色相不跳灰
  - **动效档位 `--va-dur-4: 600ms`**：慢速状态条档（ContextWindow 收缩条迁入）；全量 transition/animation 时长字面量清零，循环动画统一 `calc(--va-dur-loop)` 倍率（时长精确不变）；VaButton transition 补 opacity（hover/disabled 变暗由瞬跳改过渡）
  - **ThinkingLoader**：shine 动画移入内层 span，阶段切换时长回归 CSS（`--va-dur-1`）驱动，移除 `:duration` 硬编码
  - **registry 自包含修复**：组件使用 motion 工具类时拷贝自动附带 motion.css（修复 terminal-log 等 10 个组件缺 `.va-copy`/`.va-enter-*` 规则的存量缺口）；共享模块 `import type` 整句导入会被内联器剥 type 语义，已改内联 `import { type X }` 形式
  - **性能**：VaSegmentedControl 滑块 `will-change` 去除 width（无合成收益）
  
  **配套门禁与宿主（仓库层，不入包）**
  
  - `tokens:check` 新增第 4 项检查：transition/animation 裸时长字面量一律红灯（豁免 0s/亚毫秒、var fallback、delay 长手、插画装饰白名单）
  - playground（不发布）：修复发送消息出现双份思考过程（sendPrompt 双 push 回归，R8）
  
  **视觉微调说明**：循环动画时长全部经精确分数换算（1.2s=×2/3、1.6s=×8/9、2s=×10/9、0.9s=×0.5、1.1s=×11/18），仅 playground 侧 vaSpin 对齐库内底速由 1.2s 收敛至 0.9s。

### Patch Changes

- Updated dependencies
  - @vuagent/protocol@0.5.0

## 0.4.0

### Minor Changes

- 596f461: ## ⚠️ 升级注意（审查修复轮补记）
  
  - **会话拆表迁移不支持降级**：TASK-092 迁移后的库（主文档 `turns: []` + 独立轮次行）不能被旧版本代码打开（旧版读成空会话并可能交错覆盖）。升级前备份 `DB_PATH`；回滚版本必须连数据文件一起回退（详见 packages/server/README「存储布局」）。
  - 限流装配顺序变更：限流中间件现注册在鉴权**之前**（鉴权失败路径计入限流，防令牌爆破）；无效令牌共享 IP 桶，仅有效令牌进指纹分桶。反代部署需设 `VUAGENT_TRUST_PROXY=1` 才采信 X-Forwarded-For（取末段）。
  - `/api/health?deep=1` 的 `checks.*.detail` 不再回显驱动层错误原文（免鉴权端点信息收口），原因明细改落服务端日志（`HEALTH_PROBE_FAILED`）。
  - `PATCH /api/sessions/:id` 响应不再内嵌 `turns` 数组（迁移修复后写路径返回 raw 形状，列表接口本就 meta-only）；依赖该字段的宿主请改走会话详情端点。
  
  三轮体系化强化（TASK-085~111）：
  
  **Server 安全（迭代 1）**
  - 默认安全绑定：仅监听 127.0.0.1，对外绑定需显式 VUAGENT_HOST + VUAGENT_TOKEN（否则拒绝启动，VUAGENT_ALLOW_UNSAFE_NETWORK 豁免）
  - 路由输入校验全覆盖（workspaces rootPath 策略 + VUAGENT_WORKSPACE_ROOTS 白名单 / sessions 元数据白名单 / models provider 枚举闸门）
  - web_fetch SSRF 重定向逐跳复检；/api/* 全局 1MB 请求体上限（chat 保留 32MB）
  - HTTP 限流（默认 240/min，探测端点独立 12/min）；bash 子进程环境净化（bashEnvPolicy=safe 白名单，密钥类变量剥离）
  - 全局错误收口（err.message 不外泄）+ x-request-id + secureHeaders + 日志脱敏
  
  **Server 性能与部署（迭代 2）**
  - SSE 心跳注释帧 + 按 seq 增量重连（Last-Event-ID/fromSeq，缺口诚实回退全量）
  - turn 落盘防抖批处理 + session 拆表迁移（turns 独立行存储，写放大消除，旧库读时合并兼容）
  - compactor 增量计数 / 成本聚合 SQL 下推 / 会话列表瘦身 / 工具并行执行（parallelTools 可关）
  - Dockerfile + compose + SIGTERM 优雅停机 + release workflow + health deep 探测 + LOG_LEVEL
  
  **Server 监控与 Harness（迭代 3）**
  - HTTP/SSE/进程指标扩展（时延直方图、route 模板归一）；OTLP traces 可选推送（traceparent 透传）
  - prompt caching 控制（Anthropic cache_control 断点，execution.promptCaching）
  - HITL 挂起 + 事件缓冲 Redis 外置（审批跨重启落账，孤儿决策诚实 delivered:false）
  - mid-turn resume 门控原型 + partial JSON 修复可观测 + 协议版本协商（426）
  
  **UI 动效体系（迭代 1~3）**
  - 动效/光影 token 扩展族（blur 四档/glow/渐变/stagger/shadow-4/stage 表面）+ motion.css 共享进出场协议 + useStagger
  - 消息流动效（user-bubble/assistant-turn 入场 + skeleton 交叉过渡）+ 流式渲染 rAF 合帧
  - 统一按压反馈/光斑基类/复制反馈标准 + 空状态动效化；16 个零动效组件清零
  - 新组件：VaSpotlightCard / VaScrimEdge / VaGradientBorder（running 态 conic 光环）；glass/noise 克制体系
  - runtime 共享流式消费件导出：consumeSSEStream / parseSSEChunk / createDeltaBuffer（TASK-114 双轨归一——useAgentChat 内部迁移至同一实现，SSE 解析升级支持跨 chunk 半包/CRLF/多行 data 合并；consumeSSEStream 泛型事件类型 + onParseError 钩子，createDeltaBuffer 帧调度器可注入，传输/调度均为扩展点）

### Patch Changes

- Updated dependencies [596f461]
  - @vuagent/protocol@0.4.0

## 0.3.0

### Minor Changes

- ee5e855: 协议契约成熟化（TASK-053~056）：HarnessStreamEvent TypeBox 运行时化（schema 唯一事实来源 + validateHarnessStreamEvent）；新增 turn_start/aborted 控制事件与全事件 seq 寻址；7 个系统工具入参 schema 收口（AllToolSchemas 全量聚合 + VuagentAllToolName）；UiComponentRenderResult.component 收口为 VuagentToolName 联合类型；子路径导出 ./stream ./tools ./system-tools ./lifecycle；README（消费矩阵/变更纪律/校验语义约定）。

### Patch Changes

- Updated dependencies [ee5e855]
- Updated dependencies [135f11e]
- Updated dependencies [135f11e]
  - @vuagent/protocol@0.3.0
