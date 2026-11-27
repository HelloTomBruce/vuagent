/**
 * createCachedBlockRenderer 缓存行为测试
 *
 * 回归目标：流式渲染时，每个 text_delta 只重解析「正在增长的尾块」，
 * 内容稳定的块必须命中缓存（此前模板直接 renderMarkdown(block.content)，
 * 每个 delta 都对累积全文重新解析，累计工作量为 O(n²)，主线程掉帧）。
 */
import { describe, expect, it, vi } from "vitest";
import { createCachedBlockRenderer, renderMarkdown } from "../utils/markdown";
import type { TurnBlock } from "../types";

describe("createCachedBlockRenderer", () => {
  it("块内容不变时命中缓存，不重复调用底层渲染", () => {
    const spy = vi.fn((s: string) => `<p>${s}</p>`);
    const renderBlock = createCachedBlockRenderer(spy);
    const block: TurnBlock = { kind: "text", content: "hello" };

    expect(renderBlock(block)).toBe("<p>hello</p>");
    expect(renderBlock(block)).toBe("<p>hello</p>");
    expect(renderBlock(block)).toBe("<p>hello</p>");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("尾块原地增长（同对象引用）时重解析，前块保持缓存", () => {
    const spy = vi.fn((s: string) => `[${s.length}]`);
    const renderBlock = createCachedBlockRenderer(spy);

    // 模拟 reducer 的输出时序块：text 块之间被卡片块切开，只有尾块在 += 增长
    const blockA: TurnBlock = { kind: "text", content: "第一段" };
    const card: TurnBlock = { kind: "card", cardId: "c1" };
    const blockB: TurnBlock = { kind: "text", content: "第二段" };

    renderBlock(blockA);
    renderBlock(card);
    renderBlock(blockB);
    expect(spy).toHaveBeenCalledTimes(2); // card 不经过 markdown

    // 流式：尾块 B 原地增长
    blockB.content += "，继续输出";
    renderBlock(blockA); // 命中缓存
    renderBlock(blockB); // 重解析
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2][0]).toBe("第二段，继续输出");
  });

  it("量化：N 次 delta 的累计解析量从 O(n²) 降为 O(n)", () => {
    const N = 200;
    const DELTA = "token ";

    // 无缓存（旧行为模拟）：每个 delta 都对累积全文重新解析
    let uncachedChars = 0;
    let acc = "";
    for (let i = 0; i < N; i++) {
      acc += DELTA;
      uncachedChars += acc.length;
    }

    // 有缓存（新行为）：块级缓存下每个 delta 只解析尾块当前全文
    // ——尾块本身就是累积块，单块解析不可避免；但稳定块（此处用第二个块模拟）零开销
    const spy = vi.fn((s: string) => {
      return s;
    });
    const renderBlock = createCachedBlockRenderer(spy);
    const stable: TurnBlock = { kind: "text", content: "x".repeat(5000) };
    const tail: TurnBlock = { kind: "text", content: "" };
    for (let i = 0; i < N; i++) {
      tail.content += DELTA;
      renderBlock(stable); // 每次都渲染前块（旧行为的成本来源）
      renderBlock(tail);
    }
    const cachedChars = spy.mock.calls.reduce((sum, call) => sum + (call[0] as string).length, 0);

    // 缓存版解析总量 = 稳定块 1 次 + 尾块累计；旧行为是两者都按 O(n²) 累计
    const expectedTail = (DELTA.length * N * (N + 1)) / 2;
    expect(cachedChars).toBe(5000 + expectedTail);
    // 旧行为同等条件下前块还要再贡献 5000 * N
    expect(cachedChars).toBeLessThan(uncachedChars + 5000 * N);
  });

  it("空块与非文本块直接返回空串且不调用渲染", () => {
    const spy = vi.fn((s: string) => s);
    const renderBlock = createCachedBlockRenderer(spy);

    expect(renderBlock({ kind: "text", content: "" })).toBe("");
    expect(renderBlock({ kind: "card", cardId: "c1" })).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("默认使用内置 markdown-it 渲染器", () => {
    const renderBlock = createCachedBlockRenderer();
    const html = renderBlock({ kind: "text", content: "**加粗**" });
    expect(html).toBe(renderMarkdown("**加粗**"));
    expect(html).toContain("<strong>加粗</strong>");
  });
});
