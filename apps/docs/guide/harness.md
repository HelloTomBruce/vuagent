# Agent Harness 接入指南

`@vuagent/server` 是自研 Agent Harness 服务端：ReAct 循环、HITL 审批、工具沙箱、SSE 事件流。本页面向**宿主接入者**——怎么把它跑起来、怎么发起一轮对话、怎么消费事件流。架构决策与内部机制见 [`packages/server/README.md`](https://github.com/HelloTomBruce/vuagent/tree/main/packages/server)。

## 启动

```bash
# 本地开发（server + playground 控制台双进程）
pnpm console

# 独立部署
pnpm --filter @vuagent/server dev        # 默认 http://localhost:3001
```

| 环境变量 | 作用 | 缺省 |
|---|---|---|
| `PORT` | 监听端口 | `3001` |
| `DB_PATH` | SQLite 数据库文件 | `.vuagent/harness.db` |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | 未登记任何模型档案时的兜底凭据 | — |
| `VUAGENT_TOKEN` | 启用后 `/api/*` 要求 Bearer 令牌（豁免 `/api/health` 存活探针；默认关闭，本地 Origin 白名单已够用） | — |
| `VUAGENT_CORS_ORIGINS` | Origin 白名单追加（逗号分隔） | 本地 5173/4173 |
| `VUAGENT_ALLOW_BYO_PROVIDER` | 允许前端自带供应商配置（默认拒绝） | `false` |

## 模型配置：供应商 1:N 模型

端点与凭证在**供应商层**配置一次，其下挂载任意多模型；改一次 Key 全组生效。

```bash
# 建供应商（端点/凭证）
curl -X POST :3001/api/settings/providers -H "Content-Type: application/json" -d '{
  "name": "DeepSeek 官方", "provider": "deepseek", "apiKey": "sk-..."
}'
# 在供应商下拉模型并自动探测能力（上下文窗口/输入模态/推理档位）
curl :3001/api/settings/providers/<id>/models/discover
# 挂模型（点选探测结果即自动填充能力标记）
curl -X POST :3001/api/settings/providers/<id>/models -H "Content-Type: application/json" -d '{
  "name": "DeepSeek Chat", "model": "deepseek-chat"
}'
```

**能力声明驱动运行时行为**（保守策略：未声明 = 不发送，与不带该参数完全一致）：

| 声明 | 运行时行为 |
|---|---|
| `reasoning.supportedEfforts` | 请求携带 `reasoning_effort`（Anthropic 映射 thinking budget） |
| `inputModalities` 含 `image` | `/api/chat` 接受 `images[]` 并组装多模态 content parts |
| `maxOutputTokens` | 请求注入 `max_tokens` |

能力可随时用「验证能力」实测（`POST /api/settings/models/:id/verify-capabilities`，对勾选项发 max_tokens=1 最小探测，三态结果）。

## 发起一轮对话

```bash
curl -N :3001/api/chat -H "Content-Type: application/json" -H "Origin: http://localhost:5173" -d '{
  "sessionId": "sess-1", "workspaceId": "<ws-id>",
  "prompt": "帮我分析这个目录的代码结构",
  "modelProfileId": "<可选：切换模型档案>",
  "reasoningEffort": "high",          // 可选：推理档位（按声明校验，不合法静默忽略）
  "images": [{"name":"a.png","mediaType":"image/png","data":"<base64>"}],  // 可选：≤4 张、单张 ≤5MB
  "attachments": [{"name":"a.png","kind":"image","size":67}],              // 可选：回显元数据
  "preempt": true                     // 可选：顶替同会话运行中的轮次
}'
```

响应是 `text/event-stream`，每个事件 `data: {"type": "...", "seq": N, ...}`。一轮对话的典型事件序（完整 18 事件契约见 `@vuagent/protocol` 的 `HarnessStreamEvent`）：

```
turn_start → thought_delta* → text_delta* → [tool_call_start → tool_call_executing
→ tool_call_result]*（或 ui_* 卡片事件）→ usage → turn_end
```

消费要点：

- **seq 单调递增**：断线重连后从 `/api/sessions/:id/stream` 续流，按 seq 去重；
- **`suspended` 事件**：高风险工具挂起等待审批，用户决策经 `POST /api/action/:id` 回传（`{"decision": "approve" | "deny"}`）唤醒执行；
- **`usage` 事件**：本步 token 消耗（可选 `reasoningTokens`/`cachedTokens` 分段，分档计价数据源）；
- **错误即事件**：`error` 事件携带 `code` 与可读 message，连接不中断。

## 会话与恢复

| 接口 | 用途 |
|---|---|
| `GET /api/sessions` / `GET /api/sessions/:id` | 会话列表 / 详情（含逐轮检查点快照） |
| `POST /api/sessions/:id/compact` | 手动压缩历史（折叠为摘要，上下文占用断崖回落） |
| `GET /api/finops/summary?windowMs=` | 成本聚合（token/USD + 按模型分桶） |
| `GET /api/finops/by-session?windowMs=` | 会话级成本 |

轮次中途崩溃后重启：中断的 `running` 轮次被诚实标记为 `error/process_restart`——不续跑、不重放模型；崩溃前已落库的检查点与内容原样保留，可在会话详情中查看已完成步骤，下一轮提问按已落库历史正常重建上下文。

## 安全模型（本地优先）

- **Origin 白名单**：非白名单 Origin 直接 403（不只是不下发 CORS 头）；本地 5173/4173 默认放行；
- **apiKey 零外泄**：一切模型/供应商响应只回显末 4 位掩码；明文仅存服务端；
- **BYO 默认拒绝**：前端自带 baseUrl/apiKey 的请求默认 403（SSRF 面），`VUAGENT_ALLOW_BYO_PROVIDER=1` 显式开启后风险自担；
- 远程部署必须配置 `VUAGENT_TOKEN`（TLS 由部署方负责），等于把本机执行权交给令牌持有者。

## 存储形态

默认单文件 SQLite（`DB_PATH`），全部实体（工作区/会话/模型/供应商/成本台账）单副本落盘；分布式形态（Redis）与一致性边界见 server README 的「存储方案」。
