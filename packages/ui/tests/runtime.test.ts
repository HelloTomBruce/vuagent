import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { renderToString } from "@vue/server-renderer";
import { h } from "vue";
import {
  useAgentChat,
  VaAgentRenderer,
  getAgentComponent,
  registerAgentComponent,
  setupDefaultAgentRegistry,
  CardSkeleton,
  UIActionLocalValidationError,
} from "../src/index.js";
import { postAgentAction } from "../src/runtime/actionClient";
import type { UIActionEnvelope } from "../src/index.js";

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

describe("Agent Runtime - submitAction 信封通道（TASK-090）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 注册一个声明了 resultSchema 的 L2 测试组件（本地校验触发前提）
  beforeAll(() => {
    registerAgentComponent("test_l2_probe", {
      component: CardSkeleton,
      interaction: {
        level: "L2",
        resultSchema: {
          type: "object",
          required: ["replicas"],
          properties: {
            replicas: { type: "number" },
            env: { type: "string", enum: ["staging", "prod"] },
          },
        },
      },
    });
  });

  const okFetch = () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ delivered: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  /** 驱动组件块进入 executing 挂起态 */
  const driveToExecuting = (
    chat: ReturnType<typeof useAgentChat>,
    toolCallId: string,
    componentName: string,
  ) => {
    chat.handleStreamEvent({ type: "component_start", messageId: "m1", toolCallId, componentName });
    chat.handleStreamEvent({ type: "component_executing", toolCallId, args: {} });
  };

  const blockOf = (chat: ReturnType<typeof useAgentChat>, toolCallId: string) =>
    chat.messages.value[0].blocks?.find(
      (b) => b.kind === "component" && b.toolCallId === toolCallId,
    ) as any;

  it("信封原样 POST；乐观更新 status=done 且 result 记信封本身", async () => {
    const fetchMock = okFetch();
    const chat = useAgentChat();
    driveToExecuting(chat, "call-env-1", "ui_approval_card");

    const envelope: UIActionEnvelope = {
      kind: "submit",
      values: { approved: true },
      meta: { editedFields: [] },
    };
    await chat.submitAction("call-env-1", envelope);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/action/call-env-1",
      expect.objectContaining({ method: "POST" }),
    );
    // L1 审批卡无 resultSchema：不附加 clientValidated，信封原样发出
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual(envelope);

    const block = blockOf(chat, "call-env-1");
    expect(block.status).toBe("done");
    expect(block.result).toEqual(envelope);
  });

  it("cancel 是一等公民：同样标 done，result 记 cancel 信封（UI 区分展示）", async () => {
    const fetchMock = okFetch();
    const chat = useAgentChat();
    driveToExecuting(chat, "call-env-2", "ui_approval_card");

    const envelope: UIActionEnvelope = { kind: "cancel", reason: "用户放弃本次操作" };
    await chat.submitAction("call-env-2", envelope);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual(envelope);
    const block = blockOf(chat, "call-env-2");
    expect(block.status).toBe("done");
    expect(block.result).toEqual(envelope);
  });

  it("本地校验失败：不发请求、不做乐观更新、抛 UIActionLocalValidationError（带 fieldErrors）", async () => {
    const fetchMock = okFetch();
    const chat = useAgentChat();
    driveToExecuting(chat, "call-l2-1", "test_l2_probe");

    const bad: UIActionEnvelope = {
      kind: "submit",
      values: { replicas: "three", env: "moon" }, // 类型错 + 枚举越界
    };
    const failure = await chat.submitAction("call-l2-1", bad).catch((e) => e);
    expect(failure).toBeInstanceOf(UIActionLocalValidationError);
    expect((failure as UIActionLocalValidationError).fieldErrors).toEqual({
      replicas: "应为数值",
      env: '取值不在可选范围内（"staging" / "prod"）',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(blockOf(chat, "call-l2-1").status).toBe("executing"); // 不乐观更新
  });

  it("本地校验拦截必填缺失；补全后放行并标记 meta.clientValidated", async () => {
    const fetchMock = okFetch();
    const chat = useAgentChat();
    driveToExecuting(chat, "call-l2-2", "test_l2_probe");

    await expect(
      chat.submitAction("call-l2-2", { kind: "submit", values: {} }),
    ).rejects.toBeInstanceOf(UIActionLocalValidationError);
    expect(fetchMock).not.toHaveBeenCalled();

    await chat.submitAction("call-l2-2", {
      kind: "submit",
      values: { replicas: 3, env: "prod" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      kind: "submit",
      values: { replicas: 3, env: "prod" },
      meta: { clientValidated: true },
    });
  });

  it("HTTP 非 2xx 时抛错且不乐观更新", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const chat = useAgentChat();
    driveToExecuting(chat, "call-env-3", "ui_approval_card");

    await expect(
      chat.submitAction("call-env-3", { kind: "submit", values: { approved: true } }),
    ).rejects.toThrow("status 500");
    expect(blockOf(chat, "call-env-3").status).toBe("executing");
  });
});

describe("Agent Runtime - deriveResultSchema 派生钩子与 422 重填闭环（TASK-092）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeAll(() => {
    // 模拟 ui_form 的「resultSchema 由 args 派生」形态（与真实 ui_form 注册条目同构）
    registerAgentComponent("test_derived_l2", {
      component: CardSkeleton,
      interaction: {
        level: "L2",
        deriveResultSchema: (args: Record<string, unknown>) => ({
          type: "object",
          required: Array.isArray(args.requiredKeys) ? (args.requiredKeys as string[]) : [],
          properties: { replicas: { type: "number" } },
        }),
      },
    });
  });

  const driveToExecuting = (
    chat: ReturnType<typeof useAgentChat>,
    toolCallId: string,
    componentName: string,
    args: Record<string, unknown> = {},
  ) => {
    chat.handleStreamEvent({ type: "component_start", messageId: "m1", toolCallId, componentName });
    chat.handleStreamEvent({ type: "component_executing", toolCallId, args });
  };

  it("deriveResultSchema 按挂起 args 派生：本地校验用派生 Schema（required 来自 args）", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ delivered: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const chat = useAgentChat();
    // args 声明 replicas 必填 → 缺失即本地拦截
    driveToExecuting(chat, "call-d1", "test_derived_l2", { requiredKeys: ["replicas"] });

    const failure = await chat
      .submitAction("call-d1", { kind: "submit", values: {} })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UIActionLocalValidationError);
    expect(fetchMock).not.toHaveBeenCalled();

    // 同一组件、不同 args 派生出不同 required → 同 values 现在放行（派生随 args 走）
    driveToExecuting(chat, "call-d2", "test_derived_l2", { requiredKeys: [] });
    await chat.submitAction("call-d2", { kind: "submit", values: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("server 422 携带 fieldErrors：就地回显到 formFieldErrors、不乐观更新、错误可再修正重提", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        success: false,
        code: "ENVELOPE_VALUES_INVALID",
        fieldErrors: { replicas: "当前环境最大支持 2 个" },
      }),
    }));
    const chat = useAgentChat();
    driveToExecuting(chat, "call-d3", "test_derived_l2", { requiredKeys: [] });

    const failure = await chat
      .submitAction("call-d3", { kind: "submit", values: { replicas: 3 } })
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(UIActionLocalValidationError);
    const block = chat.messages.value[0].blocks?.find(
      (b) => b.kind === "component" && b.toolCallId === "call-d3",
    ) as { status?: string };
    expect(block.status).toBe("executing"); // 不乐观更新：卡片保持可重填
  });

  it("同键异体 422（无 fieldErrors）：维持通用失败语义，不进重填通道", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ code: "ACTION_PAYLOAD_MISMATCH" }),
    }));
    const chat = useAgentChat();
    driveToExecuting(chat, "call-d4", "ui_approval_card");

    await expect(
      chat.submitAction("call-d4", { kind: "submit", values: { approved: true } }),
    ).rejects.toThrow("status 422");
  });
});

describe("Agent Runtime - patch 信封不乐观更新（评审 C-1 回归）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const driveToExecuting = (
    chat: ReturnType<typeof useAgentChat>,
    toolCallId: string,
    componentName: string,
  ) => {
    chat.handleStreamEvent({ type: "component_start", messageId: "m1", toolCallId, componentName });
    chat.handleStreamEvent({ type: "component_executing", toolCallId, args: {} });
  };

  const blockOf = (chat: ReturnType<typeof useAgentChat>, toolCallId: string) =>
    chat.messages.value[0].blocks?.find(
      (b) => b.kind === "component" && b.toolCallId === toolCallId,
    ) as { status?: string; result?: unknown };

  it("patch：请求发出但 block 保持 executing、result 不被污染（patch 不终结挂起）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, accepted: true, patchKeys: ["steps"] }),
    }));
    const chat = useAgentChat();
    driveToExecuting(chat, "call-patch-1", "ui_approval_card");

    await chat.submitAction("call-patch-1", { kind: "patch", values: { steps: [] } } as UIActionEnvelope);

    const block = blockOf(chat, "call-patch-1");
    expect(block.status).toBe("executing"); // 修复前：被误标 done → L3 协作出口消失死锁
    expect(block.result).toBeUndefined();
  });

  it("对照：submit / cancel 仍乐观更新为 done", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }));
    const chat = useAgentChat();
    driveToExecuting(chat, "call-sub-1", "ui_approval_card");
    await chat.submitAction("call-sub-1", { kind: "submit", values: { approved: true } });
    expect(blockOf(chat, "call-sub-1").status).toBe("done");

    driveToExecuting(chat, "call-sub-2", "ui_approval_card");
    await chat.submitAction("call-sub-2", { kind: "cancel" });
    expect(blockOf(chat, "call-sub-2").status).toBe("done");
  });
});
