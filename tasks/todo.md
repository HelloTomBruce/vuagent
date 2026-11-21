# 运营体验闭环 · 任务清单

> 配套计划见 [plan.md](./plan.md)（架构决策 / 风险 / 开放问题）。任务编号自 TASK-050 起；Phase 1 与 Phase 2 可并行。上一轮「能力驱动运行时」（TASK-040~047）已全部完成并提交。

---

## Task 050: 对话流图片回显（当日真图 + 历史占位）

**Description:** 发送带图消息后，user turn 在对话流中显示图片缩略图（当日会话，dataUrl 直引）；跨刷新的历史轮次显示「[图] 名字」占位。`MessageTurn` 增加 `attachments?: { name; kind: "image" | "file"; size; dataUrl?: string }[]`——发送时由 `collectTurnImages` 的结果构造（dataUrl 复用已读的 base64 拼前缀，不重复读取）；历史恢复路径（useSessions 按 turns[].prompt 重建）拿不到图片，占位渲染。服务端 TurnEntity 增加轻量 `attachments?: { name; kind; size }[]` 元数据落库（不含 base64）。

**Acceptance criteria:**
- [ ] 发送带图消息：对话流 user turn 显示缩略图（点击可放大或新窗口打开）
- [ ] 刷新页面后同一轮次显示「[图] 文件名」占位，不报错不空白
- [ ] 文本附件回显同名 chip（现状仅发送时可见 → 一并持久到 turn）
- [ ] 纯文本轮次渲染与现状一致（回归）

**Verification:**
- [ ] `pnpm --filter @vuagent/playground test`（turn 构造与渲染组件单测）
- [ ] 浏览器回归：发图 → 见图 → 刷新 → 见占位

**Dependencies:** None
**Files likely touched:** `apps/playground/src/console/types.ts`、`Console.vue`（handleSend 构造 userTurn）、TurnList/用户 turn 渲染组件、`packages/server/src/core/{types,turn-persistence}.ts`（attachments 元数据）
**Estimated scope:** Medium

---

## Task 051: 粘贴/拖拽上传门禁验证

**Description:** `VaComposer` 的 `onPaste` 与拖入已统一 emit `filesSelected` → `onFilesSelected`（门禁 + base64 读取天然复用）。本任务做验证与补漏：粘贴截图（image/png）在未声明模型被拒且带指引、声明模型完整走通；检查拖入路径（drop）是否同样走 filesSelected，若有旁路补齐。

**Acceptance criteria:**
- [ ] 未声明模型：粘贴截图 → 拒绝 toast + 指引（与文件选择器口径一致）
- [ ] 声明模型：粘贴截图 → chip + 缩略图 + 发送带图
- [ ] 拖入文件行为与选择器一致（或确认已复用并记录）

**Verification:**
- [ ] 浏览器回归（ClipboardEvent 注入 + DataTransfer 模拟）
- [ ] 若发现旁路：补单测 + 修复

**Dependencies:** None（可与 050 并行）
**Files likely touched:** 验证为主；如需修复 `packages/ui/src/components/composer/VaComposer.vue`
**Estimated scope:** Small

---

## Task 052: 推理档位会话级隔离

**Description:** `reasoningEffort` 从全局 ref 迁移为 `Map<sessionId, string>`（composable 内部维护，由 Console 注入当前会话 id getter）。当前会话读取 map 值；切换会话恢复该会话的档位；模型切换重置语义保留（重置写入当前会话槽位）。

**Acceptance criteria:**
- [ ] 会话 A 选 high、切到会话 B（同模型）→ B 显示 defaultEffort，互不串扰
- [ ] 切回 A → 恢复 high
- [ ] 无会话（新建态）行为与现状一致
- [ ] 请求体 reasoningEffort 随当前会话档位（回归）

**Verification:**
- [ ] `pnpm --filter @vuagent/playground test`（新增双会话切换单测）

**Dependencies:** None
**Files likely touched:** `useModelProfiles.ts`、`Console.vue`（会话 getter 注入）
**Estimated scope:** Small-Medium

---

## Task 053: 真实端点验收 ✅（清单与执行模板已落盘 docs/verification.md；本地无 anthropic/视觉模型账号，五项均标「待执行」，需真实账号后回填）

**Description:** 上一轮 review 遗留的真实验证项，自动化（stub）已覆盖的部分不重复。产出 `docs/verification.md` 验收清单 + 执行记录模板，覆盖：① Anthropic 原生端点 thinking + 工具调用组合（真实 key）；② 真实视觉模型（如 glm-4v / qwen-vl / gpt-4o）发图获得描述性回答；③ DeepSeek/Kimi 端点的 cached_tokens / reasoning_tokens 明细落账；④ max_tokens 声明在真实端点生效（响应被截断可观察）。本地无对应账号的项标注「待执行」并留记录位。

**Acceptance criteria:**
- [ ] 清单文档落地，含 curl/脚本片段与预期输出
- [ ] 至少 2 项真实执行并记录（视本地可用账号而定，其余标注待执行）

**Verification:**
- [ ] 已执行项的请求/响应记录入档
- [ ] 不阻塞合并（stub 覆盖项全绿）

**Dependencies:** None
**Files likely touched:** `docs/verification.md`（新）、scripts/ 可选辅助脚本
**Estimated scope:** Small

---

## Task 054: 成本查询 API

**Description:** 新增 `GET /api/costs/summary?windowMs=`（默认 24h，上限 30d）：返回 `{ windowUsage: { tokens, costUsd }, byModel: Record<model, { tokens, costUsd }>, quota?: { windowTokenLimit, windowUsdLimit } }`。配额从 finops admission 同源的配置读取（configResolver 对应命名空间）。会话级：`GET /api/costs/by-session?windowMs=`（sessionId → usage）供 056 使用。仓储层零改动（sumWindow / sumWindowByModel 已存在）。

**Acceptance criteria:**
- [ ] summary 聚合值 = costRepo.sumWindow / sumWindowByModel 直查结果（一致性测试）
- [ ] 未配计价表时 costUsd 为 0/undefined，tokens 照常
- [ ] windowMs 越界钳制（24h 默认 / 30d 上限）+ 非法入参 400

**Verification:**
- [ ] `pnpm --filter @vuagent/server test`（新路由测试 + 三口径对账断言）

**Dependencies:** None（可与 Phase 1 并行）
**Files likely touched:** `packages/server/src/server.ts`、`packages/server/tests/`（新 costs-api.test.ts）
**Estimated scope:** Small-Medium

---

## Task 055: 前端成本面板 ✅（规划调研疏漏：TASK-075 已实现 UsagePanel + useUsage + /api/finops/summary 全链路；本轮仅清理了重复的 /api/costs/summary——by-session 迁至 /api/finops/by-session）

**Description:** 右侧面板（UsagePanel 区域或新「成本」分区）：窗口 token/USD 双口径总量、按模型分桶（条形，优先复用 VaBreakdownChart）、配额进度条（token 与 USD 双条，>80% 预警色、超限红）。数据源 TASK-054 summary 接口，打开面板时拉取 + 手动刷新按钮。

**Acceptance criteria:**
- [ ] 无记账数据时显示空态文案（不显示 0 美元误导）
- [ ] 配额 >80% 预警、超限红色样式（模拟数据断言）
- [ ] byModel 分桶与接口一致、按 USD 降序

**Verification:**
- [ ] `pnpm --filter @vuagent/playground test`（组件结构测试）
- [ ] 浏览器回归：配好计价表跑一轮后面板出数

**Dependencies:** TASK-054
**Files likely touched:** `apps/playground/src/console/components/UsagePanel.vue`（或新 CostPanel.vue）、api/client.ts、console.css
**Estimated scope:** Medium

---

## Task 056: 会话级成本 ✅（降级交付：树内逐行徽标需 TreeSession 协议扩展（ui 包 + protocol + registry 链），本轮以「UsagePanel 当前会话成本行」交付等价可见性；树内徽标转后续任务）

**Description:** 会话列表行显示该会话累计成本徽标（`>0` 才显示，tooltip 含 token 数）。数据源 by-session 接口，随会话列表加载一并拉取（一次批量请求，避免 N+1）。

**Acceptance criteria:**
- [ ] 有记账的会话显示 `$0.0123` 徽标；无记账隐藏
- [ ] 会话列表加载不产生逐会话请求（网络面板验证单次批量）

**Verification:**
- [ ] playground 测试 + 浏览器回归

**Dependencies:** TASK-054
**Files likely touched:** `ConsoleSidebar.vue`、api/client.ts
**Estimated scope:** Small

---

## Task 057: 服务端 verify-capabilities 探测端点

**Description:** `POST /api/settings/models/:id/verify-capabilities`：对档案勾选的能力逐项发最小探测（服务端代发，凭据不出服务端，复用 models/test 信任边界）——图片：1×1 PNG + `max_tokens=1` 最小 chat；推理档位：最低档 effort 同最小 chat；输出上限：跳过（无法低成本验证）。串行探测，单项 15s 超时。返回 `[{ capability, ok, detail }]`（4xx 参数类拒绝 → ok:false + 建议文案；网络/鉴权失败 → inconclusive 标注）。

**Acceptance criteria:**
- [ ] 勾选图片但端点 400 的场景（stub）→ verdict 明确 ✗ 与「建议取消勾选」
- [ ] 探测请求凭据不出服务端、端点取自已存配置（安全断言）
- [ ] 未勾选能力不探测（不发多余请求，网络断言）

**Verification:**
- [ ] `pnpm --filter @vuagent/server test`（stub fetch 断言探测请求形态与 verdict 分类）

**Dependencies:** 弱依赖 Phase 1（探测模式参照）；技术无依赖
**Files likely touched:** `packages/server/src/server.ts`、`packages/server/tests/`
**Estimated scope:** Medium

---

## Task 058: 设置面板「验证能力」交互

**Description:** 模型编辑器能力区块加「验证能力」按钮（有勾选能力才可用）：点击先 toast「将发起 N 次最小探测请求（约 N×最小 token 费用）」，确认后调用 057 端点，结果以逐能力角标呈现（✓ 通过 / ✗ 不符 + 建议改声明 / ? 无法判定 + 重试）。✗ 时提供「按探测结果修正声明」快捷操作。

**Acceptance criteria:**
- [ ] 三态结果渲染清晰，✗ 附建议文案
- [ ] 探测期间按钮 loading、防重复点击
- [ ] 快捷修正写回 capabilities 并保存

**Verification:**
- [ ] playground 组件测试 + 浏览器回归（stub 服务端三态）

**Dependencies:** TASK-057
**Files likely touched:** `ModelProfilesPanel.vue`、`useModelProfiles.ts`
**Estimated scope:** Medium

---

## Task 059: guide/harness.md 宿主接入指南

**Description:** docs 站新增面向宿主接入者的指南：安装与启动（pnpm console / 独立部署 env 表）、/api/chat 完整契约（含 images / reasoningEffort / preempt 与 SSE 事件流消费示例 curl）、模型配置（Provider 1:N + 能力探测 + 保守策略行为表）、安全模型（Origin/token/BYO）、存储与 env 兜底。单机 SQLite 规模；Redis 一句话链接 server README。

**Acceptance criteria:**
- [ ] 新接入者按文档可跑通：起服务 → 配供应商 → curl 发起一轮 → 消费 SSE
- [ ] 契约字段与代码一致（以 stream-schema.ts 为准逐项核对）

**Verification:**
- [ ] `pnpm docs:build` 通过
- [ ] 契约核对清单勾选

**Dependencies:** TASK-053/054 的最终形态（契约含新字段）
**Files likely touched:** `apps/docs/guide/harness.md`（新）
**Estimated scope:** Medium

---

## Task 060: docs 导航配置 + MCP 标注处理

**Description:** `.vitepress/config.mts` 侧栏加「Agent Harness」分组（harness.md 入口）；getting-started 的「MCP server（规划中）」改为 roadmap 说明或移除，不再挂未立项承诺。

**Acceptance criteria:**
- [ ] 侧栏导航出现新分组且链接有效
- [ ] 全站无「规划中」式未立项承诺残留（grep 校验）

**Verification:**
- [ ] `pnpm docs:build` + 站点导航人工检查

**Dependencies:** TASK-059
**Files likely touched:** `apps/docs/.vitepress/config.mts`、`getting-started.md`
**Estimated scope:** Small

---

## Task 061: 全量回归 + 发布检查

**Description:** 四 Phase 收尾：全仓 test/typecheck、tokens/registry/llms/protocol-sync 卡口、docs:build、浏览器回归按四个 Checkpoint 清单执行、README（如需）与 tasks 归档。

**Acceptance criteria:**
- [ ] 全部卡口绿
- [ ] 四个 Checkpoint 验收项全勾选

**Dependencies:** TASK-050 ~ 060
**Files likely touched:** 收尾性质
**Estimated scope:** Small

---

## Checkpoints

### Checkpoint 1（TASK-050 ~ 053 后）
- [ ] 图片回显双形态（真图/占位）+ 粘贴门禁 + 档位会话隔离端到端
- [ ] 真实端点验收清单归档（≥2 项已执行）

### Checkpoint 2（TASK-054 ~ 056 后）
- [ ] 成本面板对账一致 + 配额预警样式
- [ ] 会话徽标批量加载无 N+1

### Checkpoint 3（TASK-057 ~ 058 后）
- [ ] 能力验证三态交互 + 凭据不出服务端

### Checkpoint 4（TASK-059 ~ 061 后）
- [ ] docs 站指南可用、导航正确、无未立项承诺
- [ ] 全部卡口绿，可发版
