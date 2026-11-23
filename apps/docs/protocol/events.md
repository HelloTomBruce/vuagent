# 18 个流式事件全集

> `HarnessStreamEvent` 是前后端之间数据传输的核心载荷。它由 18 个以 `type` 字段判别的联合事件构成，完整串联起一次 Agent 任务从启动、流式生成、卡片展示、人机协同到最终收敛的全生命周期。

---

## 事件概览表

| 分组 | 事件名 (`type`) | 承载的业务语义 |
| :--- | :--- | :--- |
| **轮次控制** | `turn_start` | 轮次开始，前端据此进入 Loading 状态 |
| | `turn_end` | 轮次顺利完成，包含总步数与总耗时 |
| | `aborted` | 任务被显式中止（用户取消 / 超时 / 顶替 / 预算耗尽） |
| | `error` | 发生不可恢复的执行异常 |
| | `suspended` | 触发高风险工具，协程挂起，等待用户审批（HITL） |
| | `resumed` | 用户完成决策，挂起恢复执行 |
| **文本增量** | `thought_delta` | 模型思考链（Reasoning / Thinking）逐 token 输出 |
| | `text_delta` | 助手正文回复逐 token 输出 |
| **工具四段式** | `tool_call_start` | 模型发起工具调用，前端声明卡片占位 |
| | `tool_call_args_delta` | 参数容错半截 JSON，前端渐进解析局部 Props |
| | `tool_call_executing` | 参数已完整，工具进入执行中状态 |
| | `tool_call_result` | 工具执行收尾（成功或失败），载荷入上下文 |
| **UI 卡片** | `ui_agent_plan` | 结构化执行计划（多步骤与状态） |
| | `ui_code_diff` | 代码变更对比卡片（旧代码 vs 新代码） |
| | `ui_terminal_log` | 终端命令行输出卡片（stdout / stderr 染色） |
| | `ui_metric_chart` | 时序指标趋势图卡片 |
| **可观测性** | `usage` | Token 消耗分段（系统提示 / 历史 / 工具）与计价 |
| | `traj` | 执行轨迹台账时间线（三泳道台账） |

---

## 1. 轮次生命周期事件

### `turn_start`（轮次启动）
在模型开始任何推理之前由服务端广播，前端据此重置状态机并展示首字加载动效：
```json
{
  "type": "turn_start",
  "turnId": "turn_98721389",
  "startedAt": 1700000000000,
  "seq": 1
}
```

### `turn_end`（轮次完成）
当 ReAct 循环收敛且模型不再发起工具调用时发送，标志着本轮交互彻底完成：
```json
{
  "type": "turn_end",
  "stepCount": 3,
  "durationMs": 4210,
  "seq": 25
}
```

### `suspended` 与 `resumed`（HITL 审批挂起与恢复）
当遇到高风险工具（如写文件、执行 bash、退款等）且需要人工核准时发送：
```json
// 1. 协程挂起
{
  "type": "suspended",
  "actionId": "act_876123",
  "toolName": "order_refund",
  "args": { "orderId": "ORD-123", "amount": 100 },
  "timeoutMs": 60000,
  "seq": 14
}

// 2. 用户决策后恢复
{
  "type": "resumed",
  "actionId": "act_876123",
  "payload": { "approved": true },
  "seq": 15
}
```

### `aborted`（任务中断）
取代了以往通过假文本输出的中断方式，具有明确的机器可读原因：
```json
{
  "type": "aborted",
  "turnId": "turn_98721389",
  "reason": "user", // "user" | "timeout" | "preempt" | "process_restart" | "token_budget"
  "seq": 16
}
```

---

## 2. 流式文本与思考链

### `thought_delta`（思考链逐 Token）
适配 DeepSeek-R1、Claude 3.7 Sonnet 等具备显式推理链（Thinking / Reasoning）的模型：
```json
{
  "type": "thought_delta",
  "delta": "我们需要先检查订单是否存在...",
  "messageId": "msg_001",
  "seq": 2
}
```

### `text_delta`（正文逐 Token）
常规的助手回复内容：
```json
{
  "type": "text_delta",
  "messageId": "msg_001",
  "delta": "正在为您查询订单信息...",
  "seq": 3
}
```

---

## 3. 工具调用链四段式

为了防止前端在工具执行期间处于漫长的假死等待状态，协议将工具调用细化为四段式演进：

```text
tool_call_start ──▶ tool_call_args_delta ──▶ tool_call_executing ──▶ tool_call_result
   (占位骨架)            (参数渐进展现)           (进入执行/等待)           (收尾更新)
```

1. **`tool_call_start`**：声明工具调用的唯一标识与名称；
2. **`tool_call_args_delta`**：服务端将模型流式吐出的残缺 JSON 修补为安全合法的局部对象下发，前端可渐进填充卡片表单；
3. **`tool_call_executing`**：入参已完整闭合，工具正式进入执行状态；
4. **`tool_call_result`**：执行完毕，下发结果或错误信息：
```json
{
  "type": "tool_call_result",
  "toolCallId": "call_98127391",
  "toolName": "query_database",
  "status": "done",
  "data": { "rowCount": 15 },
  "seq": 10
}
```

---

## 4. UI 结构化卡片主动渲染

大模型不仅能调用工具，还能主动发起结构化渲染：

* **`ui_agent_plan`**：下发执行步骤清单（待办/进行中/完成）；
* **`ui_code_diff`**：代码比对卡片，前端自动渲染红绿差异对比；
* **`ui_terminal_log`**：终端命令输出卡片，自带标准控制台色彩高亮；
* **`ui_metric_chart`**：时序折线图卡片。

---

## 5. 可观测性与治理事件

### `usage`（Token 占用分段）
反映当前步骤的 Token 消耗，以及系统提示、历史会话与工具三段的水位估算：
```json
{
  "type": "usage",
  "promptTokens": 1820,
  "completionTokens": 320,
  "totalTokens": 2140,
  "contextWindow": 128000,
  "parts": [
    { "id": "sys", "label": "系统提示", "tokens": 620, "kind": "system" },
    { "id": "hist", "label": "上下文历史", "tokens": 980, "kind": "history" },
    { "id": "tool", "label": "工具定义", "tokens": 220, "kind": "tools" }
  ],
  "reasoningTokens": 150,
  "cachedTokens": 500,
  "seq": 24
}
```

---

## 总结

拥有这 18 个清晰定义的事件，你的后端（无论是官方的 `@vuagent/server` 还是自研服务）就能和前端建立起无歧义的对话协议。
接下来请参考：
👉 [对接自定义后端 (Python / Go / Java)](/protocol/custom-backend)
