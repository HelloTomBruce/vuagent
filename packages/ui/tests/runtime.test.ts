import { describe, it, expect } from "vitest";
import { renderToString } from "@vue/server-renderer";
import { h } from "vue";
import {
  useAgentChat,
  VaAgentRenderer,
  getAgentComponent,
  registerAgentComponent,
} from "../src/index.js";

describe("Agent Runtime - useAgentChat State Machine", () => {
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
