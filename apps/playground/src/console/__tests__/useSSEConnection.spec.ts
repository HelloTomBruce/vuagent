import { describe, expect, it } from "vitest";
import { consumeSSEStream } from "../composables/hooks/useSSEConnection";

/** 构造 SSE Response（chunk 数组按序推送后收尾） */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("consumeSSEStream（TASK-113）", () => {
  it("解析事件按序上抛；[DONE] 走 onDone；正常收尾 aborted:false", async () => {
    const events: unknown[] = [];
    let done = false;
    const result = await consumeSSEStream({
      open: async () =>
        sseResponse([
          'data: {"type":"text_delta","delta":"a"}\n\n',
          'data: {"type":"text_delta","delta":"b"}\n\ndata: [DONE]\n\n',
        ]),
      onEvent: (e) => events.push(e),
      onDone: () => {
        done = true;
      },
    });
    expect(result.aborted).toBe(false);
    expect(events).toEqual([
      { type: "text_delta", delta: "a" },
      { type: "text_delta", delta: "b" },
    ]);
    expect(done).toBe(true);
  });

  it("跨 chunk 半包正确拼接", async () => {
    const events: unknown[] = [];
    await consumeSSEStream({
      open: async () => sseResponse(['data: {"type":"te', 'xt_delta","delta":"x"}\n\n']),
      onEvent: (e) => events.push(e),
      onDone: () => {},
    });
    expect(events).toEqual([{ type: "text_delta", delta: "x" }]);
  });

  it("signal 中止 → aborted:true（不抛错）", async () => {
    const controller = new AbortController();
    // 模拟真实 fetch 行为：signal 中止使挂起的 reader.read() 以 AbortError 拒绝
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: {"a":1}\n\n'));
        const onAbort = () =>
          streamController.error(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener("abort", onAbort, { once: true });
      },
    });
    // 首 chunk 消费后（读侧挂起等待下一块）触发中止 → 挂起的 read 以 AbortError 拒绝
    setTimeout(() => controller.abort(), 5);
    const result = await consumeSSEStream({
      open: async () => new Response(stream, { status: 200 }),
      onEvent: () => {},
      onDone: () => {},
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
  });

  it("非中止错误原样抛出（open 失败）", async () => {
    const result = consumeSSEStream({
      open: async () => {
        throw new Error("服务器返回错误 [500]");
      },
      onEvent: () => {},
      onDone: () => {},
    });
    await expect(result).rejects.toThrow("服务器返回错误 [500]");
  });
});
