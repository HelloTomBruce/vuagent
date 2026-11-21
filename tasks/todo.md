# 能力驱动运行时 · 任务清单

> 配套计划见 [plan.md](./plan.md)（架构决策 / 风险 / 开放问题）。任务按垂直切片组织，每片端到端可验收。

---

## Task 040: 协议与服务端——reasoningEffort 请求字段 + 声明校验 + 双驱动注入

**Description:** `/api/chat` 新增顶层可选字段 `reasoningEffort: string`。服务端解析 profile 的 `capabilities.reasoning`：未声明 supported 或档位不在 `supportedEfforts` 集合内 → 静默忽略（降级为不发送，保持保守）；合法 → 并入 `parameters.reasoning_effort`（OpenAI 兼容驱动经既有 `...req.parameters` 展开自然到达），Anthropic 原生驱动映射为 `thinking: { type: "enabled", budget_tokens }`（档位换算表 low 4K / medium 16K / high 32K，未知名按 medium）。

**Acceptance criteria:**
- [x] 声明 `supportedEfforts: ["low","high"]` 的模型：请求携带 `reasoning_effort: "low"` 生效（驱动请求体断言）
- [x] 档位不在声明集合 / 模型未声明推理 → 请求体**不含**任何 effort 相关字段
- [x] Anthropic 原生档案：`high` → `thinking.budget_tokens = 32000`
- [x] `modelOverride` 语义不变（安全基线测试全绿）

**Verification:**
- [x] `pnpm --filter @vuagent/server test`（新增驱动注入 + 校验降级测试）
- [x] `pnpm protocol:sync-check`

**Dependencies:** None
**Files likely touched:** `packages/server/src/server.ts`、`packages/server/src/core/agent-loop.ts`、`packages/server/src/adapters/anthropic-driver.ts`、`packages/server/src/storage/repositories/settings.repository.ts`、`packages/server/tests/`
**Estimated scope:** Medium（3-5 文件）

---

## Task 041: 前端——Composer 推理档位选择器

**Description:** Console Composer 在当前模型声明 `capabilities.reasoning.supported` 且有 `supportedEfforts` 时，于模型选择器旁渲染档位选择器（默认取 `defaultEffort`）；未声明模型完全不渲染（保持现状）。档位为会话级状态，随模型切换重置；选中值随 `/api/chat` 的 `reasoningEffort` 字段发送。

**Acceptance criteria:**
- [x] 声明 efforts 的模型：选择器出现且选项 = 声明集合，默认选中 `defaultEffort`
- [x] 未声明 / capabilities 缺失的模型：不渲染选择器，请求不含 `reasoningEffort`
- [x] 切换模型后档位状态重置为新模型默认
- [x] 既有 Composer 交互（@提及、附件、⌘K）无回归

**Verification:**
- [x] `pnpm --filter @vuagent/playground test`（新增 composable 单测：声明/未声明两形态）
- [x] 手动：网络面板确认请求体携带 reasoningEffort

**Dependencies:** TASK-040
**Files likely touched:** `apps/playground/src/console/composables/useModelProfiles.ts`（或新增 useReasoningEffort）、Composer 相关组件、`apps/playground/src/console/api/client.ts`
**Estimated scope:** Medium

---

## Task 042: 推理/缓存 token 分段——驱动解析 → usage 事件 → 分档计价

**Description:** 驱动层解析 usage 明细（OpenAI 兼容：`usage.completion_tokens_details.reasoning_tokens` / `prompt_tokens_details.cached_tokens`；Anthropic：`cache_read_input_tokens` 等），透传至 agent-loop，`usage` 事件新增可选 `reasoningTokens` / `cachedTokens` 字段；cost 记账按 pricing-table 既有 `reasoning` / `cacheRead` 分档单价计价（缺省回落规则不变）。

**Acceptance criteria:**
- [x] 模拟含 reasoning_tokens 的 usage 响应 → 事件携带 `reasoningTokens`，成本按分档单价计算
- [x] 旧端点无明细字段 → 分段缺省（undefined），计价回落现状，前端不报错
- [x] protocol:sync-check 通过（optional 字段演进）

**Verification:**
- [x] `pnpm --filter @vuagent/server test` + `pnpm --filter @vuagent/protocol test`
- [x] finops 相关既有测试全绿

**Dependencies:** TASK-040（同轮次内先做 040 的参数通路）
**Files likely touched:** `packages/protocol/src/stream-schema.ts`、`packages/server/src/adapters/*.ts`、`packages/server/src/core/{agent-loop,telemetry}.ts`、`packages/server/src/core/pricing-table.ts`
**Estimated scope:** Medium

---

## Task 043: 协议与服务端——/api/chat images 字段 + 能力门禁 + content parts + 双驱动组装

**Description:** `/api/chat` 新增可选 `images: Array<{ name; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string }>`（base64 无前缀，单张 ≤5MB、单轮 ≤4 张，服务端硬校验）。模型未声明 `inputModalities` 含 `image` → 400 带指引文案（保守）。`ChatMessage.content` 扩展为 `string | ContentPart[]`；驱动组装：OpenAI 兼容 `{ type: "image_url", image_url: { url: "data:<mediaType>;base64,<data>" } }`，Anthropic `{ type: "image", source: { type: "base64", media_type, data } }`；文本消息零改动。

**Acceptance criteria:**
- [x] 声明图片能力的模型：注入 driverFactory 替身断言 user 消息含 image parts（双驱动格式分别断言）
- [x] 未声明能力 / 超限 / 非法 mediaType → 400 结构化错误
- [x] 纯文本轮次的消息结构与现状逐字节一致（回归）

**Verification:**
- [x] `pnpm --filter @vuagent/server test`（新增路由门禁 + 驱动组装测试）

**Dependencies:** None（与 Phase 1 可并行）
**Files likely touched:** `packages/server/src/server.ts`、`packages/server/src/core/context-compactor.ts`（ChatMessage 类型）、`packages/server/src/adapters/{openai,anthropic}-driver.ts`、`packages/server/src/core/history-builder.ts`
**Estimated scope:** Large → 拆分执行时先做类型与门禁，驱动组装随后

---

## Task 044: 压缩与检查点兼容——图片 token 估值、折叠占位、序列化往返

**Description:** 上下文压缩器对含图消息按固定估值（每图 1K，常量注释依据）计入预算；滑动窗口折叠后 parts 降级为 `[图片:name]` 文本占位；逐轮检查点保留原始 parts，历史重建与崩溃恢复路径序列化往返不丢图。session-compact / persistence-recovery 既有测试补含图用例。

**Acceptance criteria:**
- [x] 含图消息参与压缩预算计量；折叠后上下文为占位符形态
- [x] 检查点保存→历史重建往返：图片 parts 完整还原
- [x] 旧检查点（纯 string content）加载无回归

**Verification:**
- [x] `pnpm --filter @vuagent/server test`（session-compact / persistence-recovery 全绿 + 新用例）

**Dependencies:** TASK-043
**Files likely touched:** `packages/server/src/core/{context-compactor,history-builder,turn-persistence}.ts`
**Estimated scope:** Medium

---

## Task 045: 前端——Composer 图片 base64 读取与发送

**Description:** 通过 `supportsImageInput` 门禁的图片附件，FileReader 读取为 base64（剥离 data: 前缀），随 `/api.chat` 的 `images` 字段发送；附件 chip 预览沿用现有 previewUrl；失败（413/400）toast 展示服务端结构化错误。文本附件行为不变。

**Acceptance criteria:**
- [x] 上传 PNG → 发送请求体含对应 images 条目（网络面板验证）
- [x] 未声明模型仍被门禁拦截（现状回归）
- [x] 服务端 400（超限/未声明竞态）→ toast 指引文案

**Verification:**
- [x] `pnpm --filter @vuagent/playground test`
- [x] 浏览器回归：端到端发送（真实视觉模型或观察请求体）

**Dependencies:** TASK-043
**Files likely touched:** `apps/playground/src/Console.vue`、`apps/playground/src/console/api/client.ts`
**Estimated scope:** Small-Medium

---

## Task 046: maxOutputTokens 生效

**Description:** `capabilities.maxOutputTokens` 声明时注入请求（OpenAI 兼容 `max_tokens` / `max_completion_tokens` 按端点兼容、Anthropic `max_tokens`），与 agent-loop 既有 contextBudget 内部上限取较小者；未声明不发送（现状）。

**Acceptance criteria:**
- [x] 声明 8192 的模型：请求体含 max_tokens=8192（若内部预算更小则取小）
- [x] 未声明模型：请求体不含该字段（现状回归）

**Verification:**
- [x] `pnpm --filter @vuagent/server test`（驱动请求断言）

**Dependencies:** TASK-040（同一参数注入点）
**Files likely touched:** `packages/server/src/core/agent-loop.ts`、`packages/server/src/adapters/*.ts`
**Estimated scope:** Small

---

## Task 047: 文档同步 + 全量回归

**Description:** server README「能力驱动运行时」小节（保守策略、effort 映射表、图片通道与折叠策略、usage 分段）；根 README playground 段补一句；`pnpm llms` 再生成 + `registry:check` + 全仓 test/typecheck；浏览器回归按三检查点清单执行。

**Acceptance criteria:**
- [x] 文档与实现一致（字段名/上限/默认值逐项核对）
- [x] tokens / registry / llms / protocol:sync-check / 全仓 test 全绿

**Dependencies:** TASK-040 ~ 046
**Files likely touched:** `packages/server/README.md`、`README.md`
**Estimated scope:** Small

---

## Checkpoints

### Checkpoint 1（TASK-040 ~ 042 后）
- [x] 推理档位端到端：声明模型出选择器 → 请求带 effort → usage 分段计价
- [x] 全部相关测试 + protocol:sync-check 绿

### Checkpoint 2（TASK-043 ~ 045 后）
- [x] 图片端到端：上传 → parts 到驱动（替身断言 + 浏览器请求体）
- [x] 压缩/恢复全量回归绿

### Checkpoint 3（TASK-046 ~ 047 后）
- [x] 保守策略回归：未声明模型三处行为（effort/图片/maxOutput）与现状一致
- [x] 文档 + 全部卡口绿，可发版
