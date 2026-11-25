import { describe, expect, it, vi } from "vitest";
import { consumeSSEStream, parseSSEChunk } from "../src/runtime/sse";

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

describe("parseSSEChunk（TASK-114 共享件）", () => {
  it("单块完整事件解析", () => {
    const r = parseSSEChunk('data: {"type":"text_delta","delta":"hi"}\n\n', "");
    expect(r.payloads).toHaveLength(1);
    expect(JSON.parse(r.payloads[0]).type).toBe("text_delta");
    expect(r.buffer).toBe("");
  });

  it("跨 chunk 半包：残余 buffer 正确拼接", () => {
    const first = parseSSEChunk('data: {"type":"te', "");
    expect(first.payloads).toHaveLength(0);
    expect(first.buffer).toBe('data: {"type":"te');
    const second = parseSSEChunk('xt_delta"}\n\ndata: {"a":1}\n\n', first.buffer);
    expect(second.payloads).toEqual(['{"type":"text_delta"}', '{"a":1}']);
  });

  it("兼容 CRLF；多行 data 合并（SSE 规范）", () => {
    expect(parseSSEChunk('data: {"a":1}\r\n\r\n', "").payloads).toEqual(['{"a":1}']);
    expect(parseSSEChunk('data: {"a":\ndata: 1}\n\n', "").payloads).toEqual(['{"a":\n1}']);
  });
});

describe("consumeSSEStream（TASK-114 共享件）", () => {
  it("事件按序上抛；[DONE] 走 onDone；正常收尾 aborted:false", async () => {
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

  it("signal 中止 → aborted:true（不抛错）", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    // 模拟真实 fetch：signal 中止使挂起的 reader.read() 以 AbortError 拒绝
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encoder.encode('data: {"a":1}\n\n'));
        const onAbort = () =>
          streamController.error(Object.assign(new Error("aborted"), { name: "AbortError" }));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      },
    });
    const promise = consumeSSEStream({
      open: async () => new Response(stream, { status: 200 }),
      onEvent: () => {},
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);
    expect((await promise).aborted).toBe(true);
  });

  it("open 失败（非中止）原样抛出", async () => {
    const result = consumeSSEStream({
      open: async () => {
        throw new Error("Chat request failed with status 500");
      },
      onEvent: () => {},
    });
    await expect(result).rejects.toThrow("Chat request failed with status 500");
  });

  it("流自然读完但未发 [DONE]：不触发 onDone，aborted:false（异常收尾语义）", async () => {
    let done = false;
    const result = await consumeSSEStream({
      open: async () => sseResponse(['data: {"type":"text_delta","delta":"x"}\n\n']),
      onEvent: () => {},
      onDone: () => {
        done = true;
      },
    });
    expect(result.aborted).toBe(false);
    expect(done).toBe(false);
    void vi;
  });
});

describe("consumeSSEStream 扩展点（TASK-114）", () => {
  it("泛型事件类型直达回调（无断言）；onParseError 钩子接解析失败且流继续", async () => {
    const events: Array<{ n: number }> = [];
    const parseErrors: string[] = [];
    const result = await consumeSSEStream<{ n: number }>({
      open: () =>
        sseResponse([
          'data: {"n":1}\n\n',
          "data: not-json\n\n",
          'data: {"n":2}\n\ndata: [DONE]\n\n',
        ]),
      onEvent: (e) => events.push(e),
      onParseError: (payload) => parseErrors.push(payload),
      onDone: () => {},
    });
    expect(events).toEqual([{ n: 1 }, { n: 2 }]); // 泛型 T 通道
    expect(parseErrors).toEqual(["not-json"]); // 单块损坏不拖垮整条流
    expect(result.aborted).toBe(false);
  });

  it("缺省 onParseError：console.warn 兜底不抛错", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await consumeSSEStream({
      open: () => sseResponse(["data: bad\n\n"]),
      onEvent: () => {},
    });
    expect(result.aborted).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
