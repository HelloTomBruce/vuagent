# 对接自定义后端 (Python / Go / Java)

> Vuagent 的 Web 前端与底层 Harness 服务端完全解耦。只要你的后端服务满足 `@vuagent/protocol` 规范，你完全可以使用 **Python (FastAPI / LangGraph / CrewAI)、Go、Java** 等任何技术栈来驱动 Vuagent 的界面！

---

## 最小实现契约

要驱动 `@vuagent/ui` 前端（如 `VaAgentChat` 或 `useAgentChat`），你的后端只需实现两个标准端点：

1. **`POST /api/chat`**：接收前端用户输入，返回符合规范的 `text/event-stream` SSE 流；
2. **`POST /api/action/:actionId`**（可选，仅当使用 HITL 审批或交互卡片时）：接收用户在前端做出的决策。

---

## Python (FastAPI) 极简对接示例

下面是一个完整的、可直接运行的 Python FastAPI 后端示例。它演示了如何模拟流式打字与工具调用卡片下发：

```python
# main.py
import asyncio
import json
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

app = FastAPI()

# 允许跨域（适配前端本地开发）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def sse_pack(event_data: dict) -> str:
    """按标准 SSE 格式打包单条事件"""
    return f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

async def mock_agent_event_stream(prompt: str):
    seq = 1

    # 1. 发送轮次启动事件 (turn_start)
    yield sse_pack({
        "type": "turn_start",
        "turnId": f"turn_{int(time.time())}",
        "startedAt": int(time.time() * 1000),
        "seq": seq
    })
    seq += 1
    await asyncio.sleep(0.3)

    # 2. 流式推送文本回复 (text_delta)
    reply_text = f"收到您的指令：'{prompt}'。正在为您进行业务逻辑分析..."
    for char in reply_text:
        yield sse_pack({
            "type": "text_delta",
            "messageId": "msg_001",
            "delta": char,
            "seq": seq
        })
        seq += 1
        await asyncio.sleep(0.04)

    # 3. 模拟触发一个 UI 计划卡片 (ui_agent_plan)
    yield sse_pack({
        "type": "ui_agent_plan",
        "title": "业务执行方案",
        "steps": [
            {"id": "step_1", "title": "校验用户权限与风控", "status": "completed"},
            {"id": "step_2", "title": "调用核心数据库更新订单", "status": "in_progress"},
            {"id": "step_3", "title": "发送飞书/邮件审批通知", "status": "pending"}
        ],
        "seq": seq
    })
    seq += 1
    await asyncio.sleep(0.5)

    # 4. 发送轮次完成事件 (turn_end)
    yield sse_pack({
        "type": "turn_end",
        "stepCount": 2,
        "durationMs": 1500,
        "seq": seq
    })

@app.post("/api/chat")
async def chat_endpoint(request: Request):
    body = await request.json()
    prompt = body.get("prompt", "")
    
    return StreamingResponse(
        mock_agent_event_stream(prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "x-vuagent-protocol-version": "1"
        }
    )

@app.post("/api/action/{action_id}")
async def handle_action(action_id: str, request: Request):
    payload = await request.json()
    print(f"收到前端用户决策 actionId={action_id}, payload={payload}")
    # 在这里唤醒你后端等待的协程或更新数据库状态
    return {"success": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 验证运行
1. 安装依赖并启动：
   ```bash
   pip install fastapi uvicorn
   python main.py
   ```
2. 前端 `useAgentChat` 或 `VaAgentChat` 的 `apiBaseUrl` 直接指向 `http://localhost:8000` 即可，前端组件完全能够正常渲染出计划卡片与文本流！

---

## 接入 LangGraph / LangChain 的推荐模式

如果你的后端基于 LangGraph 构建了复杂的多 Agent 状态图：

```text
LangGraph StateGraph ──▶ 捕获 Graph Node 输出 ──▶ 映射为 Vuagent 18 事件 ──▶ SSE 下发
```

1. **节点开始/结束**：在 LangGraph 的 `astream_events` 中捕获 `on_chat_model_stream`，直接映射为 `text_delta`；
2. **工具调用**：捕获 `on_tool_start` 映射为 `tool_call_start`；工具返回结果时映射为 `tool_call_result`；
3. **Interrupt 挂起机制**：当 LangGraph 遇到 `interrupt()` 触发人机断点时，向前端推送 `suspended` 事件（携带 `actionId`）。前端用户点击后调用 `/api/action/:id`，后端调用 `graph.update_state()` 或 `graph.resume()` 恢复图执行。

---

## Go / Java / 其它语言接入要点

无论使用什么后端语言，牢记以下 3 个核心原则：

1. **响应头标准**：必须包含 `Content-Type: text/event-stream`，关闭缓冲（`X-Accel-Buffering: no` 用于 Nginx 反代）；
2. **事件 JSON 格式**：事件对象必须包含 `type` 字段（对应 18 个协议事件之一）；
3. **分批 Flush**：每次生成事件数据后，务必显式 Flush 输出流缓冲区，确保前端能够立刻收到增量帧。

---

## 协议测试与自测工具

为了帮助第三方后端开发者检验自身 SSE 输出是否完全合规，`@vuagent/protocol` 提供了开箱即用的运行时校验工具：

```ts
import { validateHarnessStreamEvent } from "@vuagent/protocol";

const [isValid, errors] = validateHarnessStreamEvent(myEventPayload);
if (!isValid) {
  console.error("事件不符合协议契约:", errors);
}
```

接下来，请了解：
👉 [HITL 动作与审批回调协议](/protocol/actions)
