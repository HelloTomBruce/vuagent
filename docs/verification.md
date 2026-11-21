# 真实端点验收清单（TASK-053）

> 自动化（stub）已覆盖的部分不在此重复；本清单只列**必须打到真实供应商端点**才能验收的项。
> 执行后请把请求/响应摘要填进对应条目；无账号的项保持「⏳ 待执行」。

## 前置

- 本地起隔离栈：`PORT=3111 DB_PATH=/tmp/verify.db pnpm --filter @vuagent/server dev`
- 建供应商/模型：经控制台（`pnpm console` 后 VITE_API_TARGET 指向 3111）或直接 `curl /api/settings/providers`
- 所有示例以 `ORIGIN="http://localhost:5173"` 为准（本地白名单）

---

## ① Anthropic thinking + 工具调用组合

**背景**：`reasoning_effort=high` 映射 `thinking.budget_tokens=32768`；stub 已验证映射与互斥剔除（temperature），真实端点需确认 thinking 与 tools 同发不被 422。

```bash
curl -N http://localhost:3111/api/chat -H "Content-Type: application/json" -H "Origin: $ORIGIN" -d '{
  "sessionId": "sess-anthropic", "workspaceId": "<ws>", "prompt": "列出当前目录文件",
  "reasoningEffort": "high"
}'
```

- [ ] ⏳ 待执行（账号：____________）
- 预期：SSE 出现 `thought_delta`（thinking 增量）且 `tool_call_start`（fs 工具），无 4xx
- 实测记录：

## ② 真实视觉模型发图获得描述性回答

**背景**：`images[]` → content parts → 驱动组装已由 stub 与浏览器请求体验证；真实视觉模型需确认端到端「发图 → 模型描述图内容」。

```bash
B64=$(base64 -i test-image.png | tr -d '\n')
curl -N http://localhost:3111/api/chat -H "Content-Type: application/json" -H "Origin: $ORIGIN" -d "{
  \"sessionId\": \"sess-vision\", \"workspaceId\": \"<ws>\", \"prompt\": \"这张图里有什么\",
  \"images\": [{\"name\": \"t.png\", \"mediaType\": \"image/png\", \"data\": \"$B64\"}]
}"
```

- [ ] ⏳ 待执行（候选模型：glm-4v / qwen-vl-max / gpt-4o，账号：____________）
- 预期：`text_delta` 内容包含对图片的实际描述（非泛泛回答）
- 实测记录：

## ③ DeepSeek / Kimi 的 cached_tokens / reasoning_tokens 明细落账

**背景**：OpenAI 兼容 usage 明细解析已 stub 验证；真实端点确认字段存在且落 `cost_records`（配好 `config/model-pricing.json` 后 costUsd>0）。

```bash
curl -s "http://localhost:3111/api/finops/summary?windowMs=3600000" -H "Origin: $ORIGIN"
# 跑一轮 deepseek-reasoner 后检查 usage 事件与明细：
# SSE 中 usage 事件应含 reasoningTokens；finops/summary 的 tokens 应只增不减
```

- [ ] ⏳ 待执行（账号：____________）
- 预期：deepseek-reasoner 轮次的 usage 事件带 `reasoningTokens > 0`；`cost_records` 明细含分档 costUsd
- 实测记录：

## ④ max_tokens 声明在真实端点生效

**背景**：`capabilities.maxOutputTokens → max_tokens` 注入已 stub 验证；真实端点确认输出被截断（finish_reason=length）。

```bash
# 模型 capabilities.maxOutputTokens 声明为 32 后发一轮长文请求
curl -N http://localhost:3111/api/chat -H "Content-Type: application/json" -H "Origin: $ORIGIN" -d '{
  "sessionId": "sess-maxout", "workspaceId": "<ws>", "prompt": "写一篇 500 字短文"
}'
```

- [ ] ⏳ 待执行（账号：____________）
- 预期：回答明显短于正常（约 32 token 截断）
- 实测记录：

---

## ⑤ 能力验证探测真实表现（TASK-057 联动）

控制台「模型设置 → 编辑模型 → 验证能力」：对声明图片但端点不支持的模型应得 ✗。可复用 ①② 的账号快速点验。

- [ ] ⏳ 待执行
- 实测记录：
