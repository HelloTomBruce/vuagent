# 流式消费 Hooks（自建数据域）

> 面向**自建流式数据域**的宿主：不想用开箱状态机（`useAgentChat`），只要复用「SSE 消费 + 帧合批」这两段底层能力。三个公共件与 `useAgentChat` 内部消费的是**同一实现**——零差异、零额外依赖（peer 仅 vue，纯 TS 件连 vue 都不需要）。

## 选型：状态机 vs 公共件

| 场景 | 用什么 |
|---|---|
| 快速接入对话 UI（含 MessageBlock 混排流 / 卡片渲染 / HITL） | [`useAgentChat`](/guide/getting-started#形态-b-底层灵活编排在抽屉弹窗中嵌入) + [`VaAgentRenderer`](/components/chat) |
| 自建消息模型 / 已有消息总线，只要「SSE → 事件对象」的消费循环 | **`consumeSSEStream`** |
| 流式文本渲染要顺滑（markdown 重渲染按帧节流） | **`createDeltaBuffer`** |
| 需要自定义 SSE 解析（非标准分帧 / 事件路由前置） | **`parseSSEChunk`** |

## consumeSSEStream — SSE 消费循环

把一条 `fetch` Response 消费为类型化事件流：跨 chunk 半包拼接、CRLF 兼容、多行 `data` 合并、`[DONE]` 与本地中止分类、解析失败钩子（单块损坏不拖垮整条流）。

```ts
import { consumeSSEStream } from "@vuagent/ui";

const controller = new AbortController();
const { aborted } = await consumeSSEStream<HarnessStreamEvent>({
  // open 是唯一的传输扩展点：POST 发起 / GET 重连 / 鉴权头 / 代理转发都在这里做
  open: () =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, prompt }),
      signal: controller.signal,
    }),
  onEvent: (event) => reduce(event),     // event 已按泛型 T 类型化，无断言
  onDone: () => finalize(),              // 服务端 [DONE]
  signal: controller.signal,             // 本地中止 → { aborted: true }（不抛错）
});
```

行为契约：

- 非 2xx / 网络错误 / 流中断：**原样抛出**（调用方呈现）；
- `signal` 中止：返回 `{ aborted: true }`（服务端 `aborted` 事件通常已先行经流送达）；
- 解析失败：缺省 `console.warn` 跳过该块；传 `onParseError(payload, err)` 可接告警 / 采样 / 降级渲染。

## createDeltaBuffer — 流式文本 rAF 合帧

高频 `text_delta` 逐条直写会让 markdown 每帧重解析多次。合帧缓冲把 delta 累积到帧边界一次提交——重渲染同帧节流。

```ts
import { createDeltaBuffer } from "@vuagent/ui";

const buffer = createDeltaBuffer({
  commit: (text) => (turn.content += text),   // 提交目标由你的状态机决定
});

// 事件分发：text_delta 入缓冲，其余事件先 flush 已收文本（保序）
onEvent: (event) => {
  if (event.type === "text_delta") return buffer.push(event.delta);
  buffer.flush();
  reduce(event);
};

// 流收尾 / 中止 / 出错：flush 保全文完整；消息整体换血用 drop() 丢弃
```

扩展点：

| 选项 | 说明 |
|---|---|
| `commit(text)` | 提交目标由你的状态机决定（块寻址 / 响应式代理是调用方职责） |
| `scheduler` | 帧调度器可注入（worker / 节流 / 测试手动跑帧）；缺省 rAF，无 rAF 环境（Node SSR）自动同步降级 |

纪律约定：`flush()` 幂等（流结束 / 错误 / 块边界切换统一走）；`drop()` 用于消息整体换血；陈旧帧（flush 后迟到回调）不会二次提交。

## parseSSEChunk — 自定义解析

纯函数块解析：增量 `chunk` + 残余 `buffer` 线程。仅当 `consumeSSEStream` 的默认循环不满足（如需要在解析层做事件路由 / 非标准分帧）时才需要。

```ts
import { parseSSEChunk } from "@vuagent/ui";

let buffer = "";
for await (const chunk of stream) {
  const { payloads, buffer: rest } = parseSSEChunk(chunk, buffer);
  buffer = rest;
  for (const payload of payloads) route(payload);
}
```

## 组合：最小自建接入

```ts
import { consumeSSEStream, createDeltaBuffer } from "@vuagent/ui";

const buffer = createDeltaBuffer({ commit: (text) => (turn.content += text) });

await consumeSSEStream<HarnessStreamEvent>({
  open: () => fetch("/api/chat", { method: "POST", body }),
  onEvent: (event) => {
    if (event.type === "text_delta") return buffer.push(event.delta);
    buffer.flush();
    reduce(event);   // 你的事件归约
  },
  onDone: () => buffer.flush(),
});
```

纪律提醒：无障碍层面，一切流式文本渲染的动效（光标 / 入场）请沿用组件库约定——尊重 `prefers-reduced-motion`（组件内建支持；自建渲染请自查）。

## 下一步

- 开箱状态机（含混排流 / HITL / 卡片）：[快速接入 · 形态 B](/guide/getting-started#形态-b-底层灵活编排在抽屉弹窗中嵌入)
- 服务端事件契约（18 事件全集）与消费要点：[流式事件全集](/protocol/events)
- 断线重连与 seq 去重语义：[执行枢纽与断线重连](/server/execution-hub)
- 主题化（暗色 / 令牌覆盖）：[主题化与样式定制](/guide/theming)
