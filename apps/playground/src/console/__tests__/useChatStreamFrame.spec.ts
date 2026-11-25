import { beforeEach, describe, expect, it, vi } from "vitest";
// rAF 手动帧队列（node 环境无原生 rAF——stub 后合帧路径激活，可观测批帧行为）
const frameQueue: FrameRequestCallback[] = [];
let frameSeq = 0;
vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
  frameQueue.push(cb);
  return ++frameSeq;
});
vi.stubGlobal("cancelAnimationFrame", () => {});

const { openChatStream } = vi.hoisted(() => ({
  openChatStream: vi.fn(),
}));

vi.mock("../api/client", () => ({
  openChatStream,
  openSessionStream: vi.fn(),
  abortSession: vi.fn(async () => {}),
}));

import { useChatStream } from "../composables/useChatStream";
import type { MessageTurn } from "../types";

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

function setup() {
  frameQueue.length = 0;
  const chat = useChatStream({
    getActiveSessionId: () => "sess-1",
    refreshSessions: async () => {},
    scrollToBottom: () => {},
  });
  return chat;
}

describe("useChatStream text_delta rAF 合帧（TASK-114）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    frameQueue.length = 0;
  });

  it("同帧多次 delta 只调度一次帧（3 delta → 1 帧回调）；收尾 flush 后全文完整", async () => {
    openChatStream.mockResolvedValue(
      sseResponse([
        'data: {"type":"text_delta","delta":"a"}\n\n',
        'data: {"type":"text_delta","delta":"b"}\n\n',
        'data: {"type":"text_delta","delta":"c"}\n\ndata: [DONE]\n\n',
      ])
    );
    const chat = setup();
    chat.sendPrompt("hello", { sessionId: "sess-1", workspaceId: "w", permission: "auto" });
    // 等待流被完整消费（node 微任务 + read 循环）
    await new Promise((r) => setTimeout(r, 10));

    const assistantTurn = chat.chatTurns.value.find((t) => t.role === "assistant") as MessageTurn;
    // 合帧证据：3 条 delta 只入队 1 次帧回调
    expect(frameQueue.length).toBe(1);
    // [DONE] 收尾 flush 同步提交：全文完整无丢字
    expect(assistantTurn.content).toBe("abc");
  });

  it("sendPrompt 入列恰好一次：1 user + 1 assistant，assistant 不双份（R8 回归）", async () => {
    openChatStream.mockResolvedValue(
      sseResponse(['data: {"type":"text_delta","delta":"x"}\n\ndata: [DONE]\n\n'])
    );
    const chat = setup();
    chat.sendPrompt("hello", { sessionId: "sess-1", workspaceId: "w", permission: "auto" });
    await new Promise((r) => setTimeout(r, 10));

    // 回归背景：TASK-113 抽取时 sendPrompt 手动 push 后又调 appendReactiveTurn
    // 二次入列，同一 assistant turn 渲染两份（双思考过程）。
    const turns = chat.chatTurns.value;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    const assistantTurns = turns.filter((t) => t.role === "assistant");
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0]!.content).toBe("x");
  });

  it("text/thought 交错：非文本事件前 flush 已收文本（保序）", async () => {
    openChatStream.mockResolvedValue(
      sseResponse([
        'data: {"type":"text_delta","delta":"a"}\n\n',
        'data: {"type":"thought_delta","delta":"thinking"}\n\n',
        'data: {"type":"text_delta","delta":"b"}\n\ndata: [DONE]\n\n',
      ])
    );
    const chat = setup();
    chat.sendPrompt("hello", { sessionId: "sess-1", workspaceId: "w", permission: "auto" });
    await new Promise((r) => setTimeout(r, 10));

    const assistantTurn = chat.chatTurns.value.find((t) => t.role === "assistant") as MessageTurn;
    // thought 到达前 flush "a"，之后 "b" 入缓冲随收尾提交——正文序保持 a→b
    expect(assistantTurn.content).toBe("ab");
    expect(assistantTurn.thought).toBe("thinking");
  });

  it("多会话并行流式：按 turn 分键互不串字", async () => {
    openChatStream
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"type":"text_delta","delta":"A1"}\n\n',
          'data: {"type":"text_delta","delta":"A2"}\n\ndata: [DONE]\n\n',
        ])
      )
      .mockResolvedValueOnce(
        sseResponse([
          'data: {"type":"text_delta","delta":"B1"}\n\ndata: [DONE]\n\n',
        ])
      );
    const chat = setup();
    chat.sendPrompt("p1", { sessionId: "sess-a", workspaceId: "w", permission: "auto" });
    chat.sendPrompt("p2", { sessionId: "sess-b", workspaceId: "w", permission: "auto" });
    await new Promise((r) => setTimeout(r, 15));

    const contents = chat.chatTurns.value
      .filter((t) => t.role === "assistant")
      .map((t) => t.content);
    expect(contents).toContain("A1A2"); // 会话 A 文本完整
    expect(contents).toContain("B1"); // 会话 B 文本完整（未串入 A 的缓冲）
  });
});
