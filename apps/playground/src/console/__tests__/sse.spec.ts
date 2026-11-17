import { describe, expect, it } from "vitest";
import { extractSSEEvents } from "../stream/sse";

describe("extractSSEEvents", () => {
  it("解析单块完整 SSE 事件", () => {
    const r = extractSSEEvents('data: {"type":"text_delta","delta":"hi"}\n\n', "");
    expect(r.payloads).toHaveLength(1);
    expect(JSON.parse(r.payloads[0]).type).toBe("text_delta");
    expect(r.buffer).toBe("");
  });

  it("跨 chunk 半包：残余 buffer 正确拼接", () => {
    const first = extractSSEEvents('data: {"type":"te', "");
    expect(first.payloads).toHaveLength(0);
    expect(first.buffer).toBe('data: {"type":"te');

    const second = extractSSEEvents('xt_delta"}\n\ndata: {"a":1}\n\n', first.buffer);
    expect(second.payloads).toEqual(['{"type":"text_delta"}', '{"a":1}']);
    expect(second.buffer).toBe("");
  });

  it("兼容 CRLF 换行", () => {
    const r = extractSSEEvents('data: {"a":1}\r\n\r\n', "");
    expect(r.payloads).toEqual(['{"a":1}']);
  });

  it("按 SSE 规范合并同一事件块内的多行 data", () => {
    const r = extractSSEEvents('data: {"a":\ndata: 1}\n\n', "");
    expect(r.payloads).toEqual(['{"a":\n1}']);
  });

  it("[DONE] 标记原样透传", () => {
    const r = extractSSEEvents("data: [DONE]\n\n", "");
    expect(r.payloads).toEqual(["[DONE]"]);
  });

  it("忽略注释行/无 data 事件块，保留不完整尾块", () => {
    const r = extractSSEEvents(': keep-alive\nevent: ping\n\ndata: {"a":1}\n\nwai', "");
    expect(r.payloads).toEqual(['{"a":1}']);
    expect(r.buffer).toBe("wai");
  });
});
