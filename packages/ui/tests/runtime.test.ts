import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { renderToString } from "@vue/server-renderer";
import { h } from "vue";
import {
  useAgentChat,
  VaAgentRenderer,
  getAgentComponent,
  registerAgentComponent,
  setupDefaultAgentRegistry,
} from "../src/index.js";
import { postAgentAction } from "../src/runtime/actionClient";

// registry 已无模块顶层副作用：使用内置组件前必须显式初始化（useAgentChat 内部也会兜底调用）
beforeAll(() => {
  setupDefaultAgentRegistry();
});

describe("Agent Runtime - useAgentChat State Machine", () => {
  it("无 rAF 环境（Node SSR/单测）降级为同步直写：每 delta 即时可见", () => {
    // 本文件运行于 vitest node 环境：无 window/requestAnimationFrame，
    // useAgentChat 走同步降级路径（TASK-104），行为与合帧前契约一致
    expect(typeof requestAnimationFrame).toBe("undefined");

    const { messages, handleStreamEvent } = useAgentChat();
    handleStreamEvent({ type: "text_delta", messageId: "m1", delta: "同步" });
    handleStreamEvent({ type: "text_delta", messageId: "m1", delta: "直写" });

    expect(messages.value[0].blocks?.length).toBe(1);
    expect(messages.value[0].blocks?.[0]).toEqual({
      id: expect.any(String),
      kind: "text",
      content: "同步直写",
    });
  });

  it("accumulates text_delta events into contiguous text blocks", () => {
    const { messages, handleStreamEvent } = useAgentChat();

    handleStreamEvent({ type: "text_delta", messageId: "m1", delta: "Hello " });
    handleStreamEvent({ type: "text_delta", messageId: "m1", delta: "World!" });

    expect(messages.value.length).toBe(1);
    expect(messages.value[0].blocks?.length).toBe(1);
    expect(messages.value[0].blocks?.[0]).toEqual({
      id: expect.any(String),
      kind: "text",
      content: "Hello World!",
    });
  });

  it("handles component lifecycle from start to ready", () => {
    const { messages, handleStreamEvent } = useAgentChat();

    // 1. component_start
    handleStreamEvent({
      type: "component_start",
      messageId: "m1",
      toolCallId: "call-1",
      componentName: "ui_approval_card",
    });

    let currentBlock = messages.value[0].blocks?.[0] as any;
    expect(currentBlock.status).toBe("streaming");
    expect(currentBlock.componentName).toBe("ui_approval_card");

    // 2. component_args_delta
    handleStreamEvent({
      type: "component_args_delta",
      toolCallId: "call-1",
      partialArgs: { title: "发布生产" },
    });
    currentBlock = messages.value[0].blocks?.[0] as any;
    expect(currentBlock.args.title).toBe("发布生产");

    // 3. component_executing
    handleStreamEvent({
      type: "component_executing",
      toolCallId: "call-1",
      args: { title: "发布生产", risk: "high" },
    });
    currentBlock = messages.value[0].blocks?.[0] as any;
    expect(currentBlock.status).toBe("executing");
    expect(currentBlock.args.risk).toBe("high");

    // 4. component_ready
    handleStreamEvent({
      type: "component_ready",
      toolCallId: "call-1",
      status: "done",
      data: { approved: true },
    });
    currentBlock = messages.value[0].blocks?.[0] as any;
    expect(currentBlock.status).toBe("done");
    expect(currentBlock.result).toEqual({ approved: true });
  });

  it("replays mock events sequentially", async () => {
    const { messages, isStreaming, playMockEvents } = useAgentChat();

    await playMockEvents([
      { type: "text_delta", messageId: "m1", delta: "Task starting..." },
      { type: "turn_end" },
    ], 5);

    expect(isStreaming.value).toBe(false);
    expect(messages.value[0].blocks?.[0].kind).toBe("text");
  });

  it("mock 序列缺终态事件时 isStreaming 不悬挂（回放结束强制复位）", async () => {
    const { isStreaming, playMockEvents } = useAgentChat();

    await playMockEvents([
      { type: "text_delta", messageId: "m1", delta: "只有增量、没有 turn_end" },
    ], 5);

    expect(isStreaming.value).toBe(false); // 审查修复回归锚点：原实现永久悬挂 true
  });
});

describe("Agent Runtime - VaAgentRenderer SSR & Fallback", () => {
  it("renders unknown component gracefully in fallback mode", async () => {
    const vnode = h(VaAgentRenderer, {
      toolCallId: "call-unknown",
      componentName: "unknown_custom_tool",
      status: "streaming",
      args: { foo: "bar" },
    });

    const html = await renderToString(vnode);
    expect(html).toContain("未知组件: unknown_custom_tool");
    expect(html).toContain("foo");
  });

  it("tolerates malformed args (null) and renders approval card fallback title", async () => {
    const vnode = h(VaAgentRenderer, {
      toolCallId: "call-null-args",
      componentName: "ui_approval_card",
      status: "executing",
      args: null,
    });

    const html = await renderToString(vnode);
    // args 为 null 时 propAdapter 兜底为默认标题，不抛错
    expect(html).toContain("审批申请");
  });

  it("tolerates dirty arg types from model output", async () => {
    const vnode = h(VaAgentRenderer, {
      toolCallId: "call-dirty-args",
      componentName: "ui_approval_card",
      status: "executing",
      args: { title: 42, risk: "critical", countdown: "soon" },
    });

    const html = await renderToString(vnode);
    // title 非字符串 → 兜底默认标题；risk 非法枚举 → 组件默认 medium
    expect(html).toContain("审批申请");
    expect(html).toContain("va-acd--medium");
  });

  it("renders registered ui_approval_card component correctly", async () => {
    const vnode = h(VaAgentRenderer, {
      toolCallId: "call-approve-1",
      componentName: "ui_approval_card",
      status: "executing",
      args: {
        title: "部署权限申请",
        risk: "medium",
      },
    });

    const html = await renderToString(vnode);
    expect(html).toContain("部署权限申请");
    expect(html).toContain("va-agent-renderer");
  });

  it("renders registered ui_metric_chart component correctly", async () => {
    const vnode = h(VaAgentRenderer, {
      toolCallId: "call-chart-1",
      componentName: "ui_metric_chart",
      status: "done",
      args: {
        title: "API P99 响应延迟",
        chartType: "bar",
        unit: "ms",
        series: [
          { label: "10:00", value: 45 },
          { label: "10:05", value: 120 },
        ],
      },
    });

    const html = await renderToString(vnode);
    expect(html).toContain("API P99 响应延迟");
    expect(html).toContain("va-metric-chart");
  });

  it("renders registered ui_agent_plan component correctly", async () => {
    const vnode = h(VaAgentRenderer, {
      toolCallId: "call-plan-1",
      componentName: "ui_agent_plan",
      status: "executing",
      args: {
        title: "全库扫描执行计划",
        steps: [
          { id: "p1", title: "初始化依赖图", status: "done" },
          { id: "p2", title: "执行死代码分析", status: "running" },
        ],
      },
    });

    const html = await renderToString(vnode);
    expect(html).toContain("全库扫描执行计划");
    expect(html).toContain("初始化依赖图");
  });
});

describe("Agent Runtime - postAgentAction 容错（res.ok 检查）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("HTTP 2xx 时正常返回", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await expect(postAgentAction("http://x", "call-1", { approved: true })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://x/api/action/call-1",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("HTTP 非 2xx 时抛错（不再静默吞掉失败）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(postAgentAction("http://x", "call-1", {})).rejects.toThrow("HTTP 500");
  });

  it("网络异常时透传错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(postAgentAction("http://x", "call-1", {})).rejects.toThrow("network down");
  });

  it("payload 为 null/undefined 时序列化为空对象", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await postAgentAction("http://x", "call-1", null);
    expect(fetchMock.mock.calls[0][1].body).toBe("{}");
  });
});
