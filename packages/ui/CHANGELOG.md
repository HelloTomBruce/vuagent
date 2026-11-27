# @vuagent/ui

## 0.7.1

No changes in this release.

## 0.7.0

### Minor Changes

- 9525047: 新增 `VaTurnRail` 多轮快速跳转轨（turn rail + scroll-spy）：右侧一列轮次标记，点击/键盘（↑↓/Home/End）平滑定位到 `[data-turn-id]` 锚点，滚动跟随高亮当前轮并填充进度轨，悬停/聚焦出「#N + 文案」预览卡；支持受控 `v-model:active-id`、`minItems` 自动隐藏、`streaming`/`error` 状态点、`prefers-reduced-motion` 降级，以及 `container` 缺席（SSR）时的静态降级。

## 0.7.0-next.0

### Minor Changes

- 9525047: 新增 `VaTurnRail` 多轮快速跳转轨（turn rail + scroll-spy）：右侧一列轮次标记，点击/键盘（↑↓/Home/End）平滑定位到 `[data-turn-id]` 锚点，滚动跟随高亮当前轮并填充进度轨，悬停/聚焦出「#N + 文案」预览卡；支持受控 `v-model:active-id`、`minItems` 自动隐藏、`streaming`/`error` 状态点、`prefers-reduced-motion` 降级，以及 `container` 缺席（SSR）时的静态降级。

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

## 0.3.0

### Major Changes

- fbe79f5: 移除 VaEmailDraft 组件（产品判定 agent 控制台场景无邮件起草需求）：删除组件目录、index 导出、registry 条目与文档收录。0.2.0 起使用的宿主需迁移；同批移除配套 ui_email_draft 契约工具（协议与服务端，未随版本发布）

### Minor Changes

- a115c00: 新增 Overlay 组件族（6 个组件）：
  
  - **VaPopover**（+ `useFloating`）：浮层定位原语——手写零依赖定位引擎（top/bottom 自动翻转 + 8px 视口边距 shift + matchAnchorWidth），Teleport 到 body，外部点击 / Esc（仅栈顶）关闭，trigger 插槽或外部 anchor（含 VirtualAnchor）双模式
  - **VaDialog**：模态弹窗原语——焦点陷阱 + 焦点还原 + 堆叠栈 + body 滚动锁，`role=dialog/alertdialog`，完整 ARIA 关联
  - **VaSelect**：纯选择型下拉（单选/多选/可搜索/可清除/分组），完整键盘导航，基于 VaPopover
  - **VaConfirm**：命令式确认框 `await vaConfirm()` 返回 Promise，宿主 `<VaConfirmHost />`，tone/requireText/checkbox，队列串行
  - **VaDropdown**：动作菜单（三点菜单）——shortcut/danger/checked/divider/group + 一层子菜单，click/contextmenu/manual 三触发
  - **VaTooltip**：轻量文字提示——hover/focus 延迟显示 + Esc 关闭 + 触发器 aria-describedby 自动回填，role=tooltip 且 pointer-events:none
- 99c3a3e: 新增 L2 语义令牌与动效编排令牌（纯增量，向后兼容；换肤只改 tokens.css）：
  
  - **排版**：字号 scale `--va-fs-2xs`~`-2xl`（10–20px 七档）+ 行高 `--va-lh-tight/normal`、字重 `--va-fw-medium/semibold/bold`、字距 `--va-tracking-wide/wider`
  - **尺寸**：控件高度三档 `--va-h-sm/md/lg`（30/36/44px）、图标三档 `--va-icon-sm/md/lg`、z-index 阶梯 `--va-z-base`~`-toast`（浮层互斥顺序）
  - **间距半步**：`--va-s3h`（6px）/ `--va-s4h`（10px）
  - **语义对照色**：`--va-accent/success/warning/danger/info-contrast` 五组——实底色上的文字/图标色（`background: var(--va-accent); color: var(--va-accent-contrast)`），暗色主题实底换浅橙后用深墨字保对比度（实测 ≈7.3:1）
  - **遮罩**：`--va-scrim`（dialog/popover 页面压暗，亮 .45 / 暗 .6）；补齐骨架屏亮色定义 `--va-skel-bg/-hl`
  - **动效编排**：入场 `--va-dur-in` + `--va-ease-out-quart`、离场 `--va-dur-out` + `--va-ease-in-quad`、弹性 `--va-ease-spring`、位移 `--va-dist-s/m`、循环底速 `--va-dur-loop`；组件库全量 spinner 归一、浮层进出对称过渡、reduced-motion 分频策略（装饰动画全关、功能动画降级纯 opacity）
  - 全库组件 CSS 排版/尺寸/字重/字距收敛到语义令牌（内联 fallback 保留，单文件拷贝分发自包含性不破坏）

## 0.2.0

### Patch Changes

- 发布自包含修复：`@vuagent/protocol` 类型内联进 runtime（此前 `workspace:*` 依赖发布后无法解析）、`lucide-vue-next` 随构建内联移入 devDependencies——npm 包零运行时依赖（peer 仅 vue）；新增 LICENSE 随包分发

### Minor Changes

- M5-M7 交付：全库 60 项（43 组件 + Screens/Blocks/插画精选 + Motion 补齐）
  
  - M5 Agent 客户端刚需 9 件：差异化 CodeDiff / FileTree / TerminalLog / CheckpointList + CommentThread / EmailDraft / UsageMeter / CommandMenu / Dropzone；新增 lineDiff / ANSI 解析 / sparkline utils
  - M6 输入·表单·导航·反馈 16 件：Combobox / FilterMenu / OtpInput / ProfileMenu / StepperForm / ProgressTracker / SetupGuide / SmartRecommendation / PromptLibrary / DateRangePicker / IntegrationPicker+Settings / NotificationStack / TipsPanel / ReactionBar / ChangeSummary
  - M7 收官 20 件：手写 SVG 图表 5（KpiChart / Breakdown / Compact / Experiment / AiAnswer）、Motion 4、Screens 5、Blocks 3、插画 3
  - 按钮样式收敛为全局 .va-act 基类（registry 拷贝自动内联）；修复 VaButton loading 对齐、ToolCall 圆环、布尔 cast 回归
  - 测试 95 个（含 46 个 SSR smoke）；shadcn registry 60 条 + llms.txt 全量
