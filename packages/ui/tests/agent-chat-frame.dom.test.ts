// @vitest-environment happy-dom
/**
 * useAgentChat 流式渲染 rAF 合帧测试（TASK-104）：
 * 可注入 fake rAF（手动帧队列 + flushFrame 手动推进）驱动合帧路径，断言
 * 「N 个 delta / 1 帧 → commit 1 次、内容合并不丢字」「非 text_delta 前置 flush
 * 保块序」「flushNow 取全文 + 陈旧帧防御（frameId !== id 迟到帧幂等）」
 * 「turn_end/error 强制 flush（流异常中断不悬挂）」「卸载 flush 且
 * cancelAnimationFrame 被调用」「clearMessages 丢弃缓冲」「无 rAF 降级同步直写」。
 * commit 次数经 Vue watch 计数——与 markdown 重解析同源（VaMarkdown 的 content
 * computed 只在 content 变化时重算），commit 1 次 = 重解析 1 次（同帧节流达成）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { defineComponent, h, watch } from "vue";
import { mount } from "@vue/test-utils";
import { useAgentChat } from "../src/runtime/useAgentChat";
import type { ChatMessage } from "../src/runtime/useAgentChat";

type FrameCb = (time: number) => void;
type Chat = ReturnType<typeof useAgentChat>;

/** fake rAF：手动帧队列 + 可断言 cancel mock；帧只在 flushFrame 显式推进 */
function stubRaf() {
  const frames: FrameCb[] = [];
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameCb) => {
    frames.push(cb);
    return frames.length; // 帧句柄 id（1 起）
  });
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return { frames, cancel };
}

/** 显式跑完当前帧队列（一次「浏览器帧」）；已 cancel 的帧不应在队列中被推进 */
function flushFrame(frames: FrameCb[]) {
  for (const cb of frames.splice(0)) cb(0);
}

function delta(chat: Chat, s: string) {
  chat.handleStreamEvent({ type: "text_delta", messageId: "m1", delta: s });
}

/** 经响应式代理读取首个 text block 内容（与模板读取链路一致） */
function textOf(chat: Chat): string {
  const block = chat.messages.value[0]?.blocks?.[0];
  return block && block.kind === "text" ? block.content : "";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAgentChat 流式 rAF 合帧", () => {
  it("同帧多次 text_delta 只 commit 1 次（watch 计数 = 响应式文本更新 = markdown 重解析次数），内容合并不丢字", () => {
    const { frames } = stubRaf();
    const chat = useAgentChat();

    delta(chat, "Hello ");
    delta(chat, "rAF ");
    delta(chat, "batc");
    delta(chat, "hed ");
    delta(chat, "world");

    // 缓冲期：尚未落账，且 5 次 delta 只调度了一帧
    expect(textOf(chat)).toBe("");
    expect(frames).toHaveLength(1);

    let commits = 0;
    // flush: "sync"——帧回调内同步计数每次响应式提交（默认 pre flush 会在微任务批量，
    // 无法在同步断言里区分提交次数）
    const stop = watch(
      () => textOf(chat),
      () => {
        commits++;
      },
      { flush: "sync" },
    );

    flushFrame(frames);
    expect(textOf(chat)).toBe("Hello rAF batched world");
    expect(commits).toBe(1);
    stop();
  });

  it("flushNow 即时取到全文（无需等帧）；frameId!==id 陈旧帧防御：迟到帧回调幂等不二次提交", () => {
    const { frames } = stubRaf();
    const chat = useAgentChat();

    delta(chat, "复制/截图");
    delta(chat, "场景需要全文");
    chat.flushNow();

    expect(textOf(chat)).toBe("复制/截图场景需要全文");
    flushFrame(frames); // flushNow 已置 frameId=null；迟到的帧回调命中 frameId !== id 防御，不再二次提交
    expect(textOf(chat)).toBe("复制/截图场景需要全文");
  });

  it("非 text_delta（component_start）前置 flush 保块序：text → component → text 与逐 delta 直写一致", () => {
    const { frames } = stubRaf();
    const chat = useAgentChat();

    delta(chat, "A");
    chat.handleStreamEvent({
      type: "component_start",
      messageId: "m1",
      toolCallId: "call-1",
      componentName: "ui_approval_card",
    });
    // 组件块插入打断文本流：旧块缓冲已先就位，保证块序
    expect(textOf(chat)).toBe("A");
    const blocks = chat.messages.value[0].blocks!;
    expect(blocks.map((b) => b.kind)).toEqual(["text", "component"]);

    delta(chat, "B");
    chat.flushNow();
    expect(blocks[2]).toMatchObject({ kind: "text", content: "B" });
    flushFrame(frames);
    expect(blocks[2]).toMatchObject({ kind: "text", content: "B" });
  });

  it("turn_end 强制 flush：缓冲全文完整落账、无丢字", () => {
    const { frames } = stubRaf();
    const chat = useAgentChat();

    delta(chat, "第一段");
    delta(chat, "第二段");
    expect(textOf(chat)).toBe(""); // 帧未跑，仍在缓冲

    chat.handleStreamEvent({ type: "turn_end" });
    expect(chat.isStreaming.value).toBe(false);
    expect(textOf(chat)).toBe("第一段第二段");

    flushFrame(frames); // 迟到帧不再改变内容
    expect(textOf(chat)).toBe("第一段第二段");
  });

  it("流异常中断（error 事件）→ flush 不悬挂：已收文本先完整落账，迟到帧不二次提交", () => {
    const { frames } = stubRaf();
    const chat = useAgentChat();

    delta(chat, "已收到");
    chat.handleStreamEvent({ type: "error", message: "stream broken" });

    expect(textOf(chat)).toBe("已收到");
    expect(chat.error.value).toBe("stream broken");
    expect(chat.isStreaming.value).toBe(false);

    // 流虽异常中断，缓冲已同步落账：假队列里的迟到帧（flushNow 只置 frameId=null，
    // 不从队列移除回调）推进后命中陈旧帧防御，不悬挂也不二次写入
    expect(frames).toHaveLength(1);
    flushFrame(frames);
    expect(textOf(chat)).toBe("已收到");
  });

  it("无 rAF 环境降级同步直写：每 delta 即时可见（合帧前对外行为契约）", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    const chat = useAgentChat();

    delta(chat, "同步");
    expect(textOf(chat)).toBe("同步");
    delta(chat, "直写");
    expect(textOf(chat)).toBe("同步直写");
  });

  it("组件卸载：挂起帧被 flush（缓冲文本不丢）且 cancelAnimationFrame 被调用（在途帧不悬挂）", () => {
    const { frames, cancel } = stubRaf();
    let chat!: Chat;
    const Host = defineComponent({
      setup() {
        chat = useAgentChat();
        return () => h("div");
      },
    });
    const wrapper = mount(Host);

    delta(chat, "卸载前缓冲");
    expect(textOf(chat)).toBe("");
    expect(frames).toHaveLength(1); // 有一帧挂起

    wrapper.unmount();
    // 卸载钩子 flushNow：先 cancel 在途帧，再同步提交缓冲
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(1);
    expect(textOf(chat)).toBe("卸载前缓冲");
    // 缓冲已空：即使迟到帧被推进（若未被 cancel 移除）也不产生二次写入
    flushFrame(frames);
    expect(textOf(chat)).toBe("卸载前缓冲");
  });

  it("clearMessages 丢弃缓冲：换血后不把旧缓冲写入新消息", () => {
    const { frames } = stubRaf();
    const chat = useAgentChat();

    delta(chat, "旧流");
    chat.clearMessages();
    expect(chat.messages.value).toHaveLength(0);

    // 新一轮流从空白开始，旧缓冲不串入
    delta(chat, "新流");
    chat.flushNow();
    expect(chat.messages.value).toHaveLength(1);
    expect(textOf(chat)).toBe("新流");
    flushFrame(frames);
    expect(textOf(chat)).toBe("新流");
  });
});
