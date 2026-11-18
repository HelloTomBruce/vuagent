/**
 * useStickToBottom 行为测试（node 环境：stub rAF + 伪造滚动元素）
 *
 * 回归目标：流式输出期间用户上翻时，自动滚动不得再把视口拽回底部
 * （此前每个 SSE 数据块都无条件 scrollTop = scrollHeight，与用户滚轮打架导致卡顿）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import { useStickToBottom, BOTTOM_THRESHOLD_PX } from "../composables/useStickToBottom";

/** 伪造滚动容器（jsdom 之外的 node 环境下直接以对象字面量模拟几何量） */
function fakeScrollEl() {
  // 保持可变对象类型（HTMLElement 的 scrollHeight/clientHeight 是只读属性），
  // 传入 composable 时统一断言为 HTMLElement
  return { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 };
}

function asEl(el: ReturnType<typeof fakeScrollEl>) {
  return ref(el as unknown as HTMLElement);
}

/** 手动执行一帧（rAF 以 setTimeout(0) stub） */
async function flushFrame() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("useStickToBottom", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0) as unknown as number
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("钉底状态下流式调用会滚到底部", async () => {
    const el = fakeScrollEl();
    el.scrollTop = el.scrollHeight - el.clientHeight; // 600，贴底
    const { scrollToBottom, dispose } = useStickToBottom(asEl(el));

    el.scrollHeight = 1200; // 新内容进来
    scrollToBottom();
    await flushFrame();

    expect(el.scrollTop).toBe(1200);
    dispose();
  });

  it("用户上翻超过阈值后，流式调用不再强制滚动", async () => {
    const el = fakeScrollEl();
    el.scrollTop = el.scrollHeight - el.clientHeight;
    const { scrollToBottom, onScroll, isPinned, dispose } = useStickToBottom(asEl(el));

    // 用户上翻：距底远超阈值
    el.scrollTop = 100;
    onScroll();
    expect(isPinned.value).toBe(false);

    el.scrollHeight = 2000; // 流式内容持续增长
    scrollToBottom();
    scrollToBottom();
    await flushFrame();

    expect(el.scrollTop).toBe(100); // 阅读位置保持稳定
    dispose();
  });

  it("用户滚回底部后恢复跟随", async () => {
    const el = fakeScrollEl();
    el.scrollTop = el.scrollHeight - el.clientHeight;
    const { scrollToBottom, onScroll, isPinned, dispose } = useStickToBottom(asEl(el));

    el.scrollTop = 0;
    onScroll();
    expect(isPinned.value).toBe(false);

    // 滚回阈值以内
    el.scrollTop = el.scrollHeight - el.clientHeight - (BOTTOM_THRESHOLD_PX - 1);
    onScroll();
    expect(isPinned.value).toBe(true);

    el.scrollHeight = 1500;
    scrollToBottom();
    await flushFrame();
    expect(el.scrollTop).toBe(1500);
    dispose();
  });

  it("force 通道无视钉底状态（发送消息/切换会话）", async () => {
    const el = fakeScrollEl();
    el.scrollTop = 0; // 用户在很靠上的位置
    const { scrollToBottom, onScroll, isPinned, dispose } = useStickToBottom(asEl(el));
    onScroll();
    expect(isPinned.value).toBe(false);

    scrollToBottom({ force: true });
    await flushFrame();
    expect(el.scrollTop).toBe(el.scrollHeight);
    dispose();
  });

  it("同一帧内多次调用合并为一次 rAF", async () => {
    const el = fakeScrollEl();
    const rafSpy = vi.fn((cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 0)
    );
    vi.stubGlobal("requestAnimationFrame", rafSpy);

    const { scrollToBottom, dispose } = useStickToBottom(asEl(el));
    scrollToBottom();
    scrollToBottom();
    scrollToBottom();
    await flushFrame();

    expect(rafSpy).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("dispose 取消待执行的滚动", async () => {
    const el = fakeScrollEl();
    const { scrollToBottom, dispose } = useStickToBottom(asEl(el));
    scrollToBottom({ force: true });
    dispose();
    await flushFrame();
    expect(el.scrollTop).toBe(0);
  });
});
