# Implementation Plan: 能力驱动运行时（Capability-Driven Runtime）

## Overview

上一轮迭代（Provider 1:N 分层 + 能力探测）把 `ModelCapabilities` 存了下来，但它目前只是「展示牌 + 附件门禁」：`capabilities` 在 server 运行时（agent-loop / drivers）零消费，推理档位与最大输出从未进过请求，图片附件即使通过能力门禁也只拼一行文件名文本。本轮把能力声明变成**真实运行时行为**，三个垂直切片：

1. **推理档位闭环**：`supportedEfforts` → Composer 档位选择 → 请求参数（OpenAI `reasoning_effort` / Anthropic `thinking` budget）→ 推理 token 分档计价；
2. **视觉通道闭环**：图片附件 base64 → `ChatMessage` content parts → 双驱动发送 → 压缩/检查点兼容；
3. **输出上限闭环**：`maxOutputTokens` 声明生效（小切片）。

## Architecture Decisions

- **保守策略贯穿**（与 model-probe 原则同源）：一切能力驱动行为**仅在 capabilities 明确声明时启用**。未声明推理 → 不发 effort 参数、UI 不渲染选择器；未声明图片 → 继续拒绝附件（现状）；未声明 maxOutput → 不限制。宁可少能力，不可猜错吃 provider 400。
- **effort 通路复用既有参数展开**：`openai-driver` 已 `...req.parameters` 展开进请求体，effort 只需在服务端归一为 `reasoning_effort` 字段即可自然到达所有 OpenAI 兼容端点；Anthropic 原生驱动单独映射 `thinking.budget_tokens`（档位换算表内置：low 4K / medium 16K / high 32K，未知名按 medium）。
- **请求级白名单字段而非 modelOverride 扩展**：`/api/chat` 新增顶层可选字段 `reasoningEffort` / `images[]`，服务端按 profile 的 capabilities 校验——不在 `supportedEfforts` 集合内的档位静默忽略（降级为不发送），图片能力未声明返回 400 带指引文案。不扩展 `modelOverride`（它的语义被安全基线锁定为「仅切换已登记 profile」）。
- **ChatMessage content parts 双形态**：`content?: string | ContentPart[]`，全链路（history-builder / context-compactor / 检查点序列化）兼容两种形态——纯文本消息零改动，含图消息才走 parts。旧检查点（纯 string）天然兼容。
- **压缩时图片折叠为占位符**：上下文压缩器遇到 parts 消息按固定估值（如每图 1K token）计入预算，压缩折叠后降级为 `[图片:name]` 文本占位；原始 parts 保留在逐轮检查点里，历史重建不丢。
- **协议演进只加 optional 字段**：usage 事件新增 `reasoningTokens` / `cachedTokens` 可选分段，旧服务端事件缺省不破坏前端；`pnpm protocol:sync-check` 卡口必须通过。
- **maxOutputTokens 与内部预算取小**：`capabilities.maxOutputTokens` 注入请求 `max_tokens`，与既有 contextBudget 内部上限取较小者，防止能力声明反向放大内部预算。

## Task List

### Phase 1: 推理档位闭环
- [ ] TASK-040 协议与服务端：reasoningEffort 请求字段 + 声明校验 + 双驱动注入
- [ ] TASK-041 前端：Composer 推理档位选择器（按模型声明动态渲染）
- [ ] TASK-042 推理/缓存 token 分段：驱动解析 → usage 事件 → 分档计价

### Checkpoint: 推理档位
- [ ] server + playground typecheck/test 全绿；protocol:sync-check 通过
- [ ] 浏览器回归：声明 efforts 的模型出现档位选择器，切换后请求体携带 reasoning_effort（网络面板验证）

### Phase 2: 视觉通道闭环
- [ ] TASK-043 协议与服务端：/api/chat images 字段 + 能力门禁 + ChatMessage content parts + 双驱动组装
- [ ] TASK-044 压缩与检查点兼容：图片 token 估值、折叠占位、序列化往返
- [ ] TASK-045 前端：Composer 图片 base64 读取与发送（门禁沿用现有 supportsImageInput）

### Checkpoint: 视觉通道
- [ ] 全仓 typecheck/test 全绿
- [ ] 端到端验证：注入 driverFactory 测试替身断言消息 parts；浏览器回归（真实视觉模型可选）

### Phase 3: 输出上限 + 收尾
- [ ] TASK-046 maxOutputTokens 生效（双驱动 + 内部预算取小）
- [ ] TASK-047 文档同步（README 能力运行时小节）+ 全量回归 + llms/registry 卡口

### Checkpoint: Complete
- [ ] 三个切片验收标准全满足
- [ ] 未声明能力的模型行为与现状逐项一致（保守策略回归）

## Risks and Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| 各供应商 `reasoning_effort` 字段方言不一（参数名/取值集不同） | 中 | 第一版只按 OpenAI 标准字段名与模型声明的原值发送；发现不支持的字段错误属 ClassifiedModelError 的请求非法类，不触发降级重试，错误文案直达用户 |
| base64 图片撑大请求体 / 检查点膨胀 | 中 | 单张 ≤ 5MB、单轮 ≤ 4 张的服务端硬校验；检查点 parts 保留但压缩折叠立即生效；后续可做服务端落盘引用 |
| content parts 触碰消息结构，影响历史重建/压缩回归 | 高 | 双形态兼容 + 既有 persistence-recovery / session-compact 测试全量跑；新增含图消息的序列化往返专项测试 |
| Anthropic budget 换算表拍脑袋 | 低 | 表内置常量 + 注释说明依据；错误预算会被 API 纠错，档位选择是用户可逆操作 |
| 前端档位选择器与 @提及等 Composer 既有交互冲突 | 低 | 档位器挂在模型选择器旁的动作区，独立状态；TASK-041 验收含既有交互回归 |

## Open Questions

- effort 作用域：**默认会话级**（切换会话跟随模型重置），是否需要「每请求临时档」？（默认不做）
- 图片上限：默认单张 5MB / 单轮 4 张，是否需要可配置（harness_config）？（第一版写死 + 常量注释）
- OpenAI 兼容端点的 reasoning token 解析依赖 `completion_tokens_details.reasoning_tokens`（较新字段），旧端点缺省时 reasoning 计价落 0——可接受？
