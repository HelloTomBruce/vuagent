# 协议总览与契约设计

> `@vuagent/protocol` 是 Vuagent 架构中最重要的单一事实契约层。它彻底将前端界面（`@vuagent/ui`）与后端执行引擎解耦，让任何满足协议的 Harness Server 都能无缝驱动前端。

---

## 为什么需要独立的契约层？

在传统的 Agent 前后端联调中，最常遇到的系统性问题是**数据漂移**：
* 模型生成的 JSON 字段名、服务端转化的 SSE 事件名、前端组件接收的 Props 名各写一套；
* 一旦服务端漏发字段或拼错属性，前端只会表现为**静默渲染错乱或白屏**，排查成本极高；
* 前后端紧密耦合，如果想把 Node.js 后端换成 Python 或 Go，前端界面几乎需要推倒重写。

Vuagent 采用 **TypeBox Schema** 作为全链路单一事实来源：

```text
               TypeBox Schema (单一事实来源)
              /                             \
Static<typeof Schema>推导                 Value.Check()
      ▼                                       ▼
TypeScript 强类型定义                   跨进程序列化运行时校验
(前后端编译期无双写漂移)                 (SSE / HTTP 边界不合法即拒绝)
```

一份契约，在三个关键边界发挥作用：
1. **模型 Function Calling 约束**：直接导出作为大模型的 `parameters` 定义；
2. **前端 Props 编译期约束**：单向推导出 TypeScript 类型，绝无手工双写 interface；
3. **SSE 传输边界校验**：在序列化边界守护数据合法性，宽进严出，杜绝脏值污染。

---

## 通信通道与协议标准

前端与 Harness 服务端通过标准 HTTP 与 **Server-Sent Events (SSE)** 通信：

### 1. 协商与版本控制
* **下行流响应头**：必须包含 `Content-Type: text/event-stream`。
* **协议版本头**：服务端在建立 SSE 响应时建议携带 `x-vuagent-protocol-version: 1`，为未来破坏性变更提供协商通道。

### 2. SSE 事件帧规范
每条事件以标准 SSE 规范下发：
```text
data: {"type":"turn_start","turnId":"t_01","startedAt":1700000000000,"seq":1}

data: {"type":"text_delta","messageId":"msg_01","delta":"您好，","seq":2}

data: {"type":"turn_end","stepCount":1,"durationMs":680,"seq":3}
```
* 载荷必须为合法的 JSON 字符串；
* 两个换行符 `\n\n` 作为消息结束符；
* `seq`：可选广播序号（从 1 起单调递增），用于前端断线重连时去重与补漏。

### 3. 上行动作回调 (Action)
当用户在前端卡片上做出决策（如点击审批、提交交互表单）时，通过标准 HTTP POST 请求回传：
```http
POST /api/action/:actionId HTTP/1.1
Content-Type: application/json

{
  "approved": true,
  "note": "同意执行该操作"
}
```

---

## 宽进严出的前向兼容哲学

`@vuagent/protocol` 的 Schema 默认**不设 `additionalProperties: false`**：
* **前向兼容**：服务端未来新增字段，旧版本的前端校验器会安全忽略，绝不崩溃；
* **严格拦截**：已知核心字段若类型错误（如 `stepCount` 发成了字符串）或必填项缺失，立即被校验器识别报错。

---

## 协议模块组成

契约分为以下子域，职责分明：

| 模块 | 职责 | 核心类型 / Schema |
| :--- | :--- | :--- |
| `stream` | 18 个 SSE 流式事件的完整定义与校验器 | `HarnessStreamEvent`、`HarnessStreamEventSchema` |
| `tools` | 10 个内建 UI 工具的参数约束（计划/差异/图表等） | `VuagentToolName`、`UiAgentPlanArgs` |
| `system-tools` | 8 个系统工具 Schema（fs, bash, glob, grep 等） | `FsWriteSchema`、`BashSchema` |
| `lifecycle` | 前端组件四态生命周期模型 | `ComponentLifecycleState`、`MessageBlock` |

接下来，请详细查阅：
👉 [18 个流式事件全集](/protocol/events)
👉 [对接自定义后端 (Python / Go / Java)](/protocol/custom-backend)
