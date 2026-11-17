import { describe, expect, it } from "vitest";
import { applyStreamEvent, applyUiComponentResult, type ReducerSink } from "../stream/reducer";
import type { MessageTurn, PlanStep } from "../types";

function makeTurn(): MessageTurn {
  return { id: "t1", role: "assistant", content: "", thought: "", cards: [], timestamp: 0 };
}

function makeSink() {
  const calls: PlanStep[][] = [];
  const sink: ReducerSink = { setPlanSteps: (steps) => calls.push(steps) };
  return { calls, sink };
}

describe("applyStreamEvent", () => {
  it("text_delta 逐段追加正文", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(turn, { type: "text_delta", delta: "你", messageId: "m1" }, { isActiveSession: true }, sink);
    applyStreamEvent(turn, { type: "text_delta", delta: "好", messageId: "m1" }, { isActiveSession: true }, sink);
    expect(turn.content).toBe("你好");
  });

  it("thought_delta 追加思考流", () => {
    const turn = makeTurn();
    applyStreamEvent(turn, { type: "thought_delta", delta: "拆解" }, { isActiveSession: true }, makeSink().sink);
    expect(turn.thought).toBe("拆解");
  });

  it("error 事件在已有正文时换行追加", () => {
    const turn = makeTurn();
    turn.content = "前文";
    applyStreamEvent(turn, { type: "error", message: "boom" }, { isActiveSession: true }, makeSink().sink);
    expect(turn.content).toContain("前文");
    expect(turn.content).toContain("boom");
  });

  it("ui_agent_plan 仅激活会话时同步计划", () => {
    const turn = makeTurn();
    const active = makeSink();
    applyStreamEvent(
      turn,
      { type: "ui_agent_plan", title: "p", steps: [{ id: "s1", title: "a", status: "pending" }] },
      { isActiveSession: true },
      active.sink
    );
    expect(active.calls).toHaveLength(1);

    const idle = makeSink();
    applyStreamEvent(
      turn,
      { type: "ui_agent_plan", title: "p", steps: [{ id: "s2", title: "b", status: "pending" }] },
      { isActiveSession: false },
      idle.sink
    );
    expect(idle.calls).toHaveLength(0);
  });

  it("suspended 生成审批卡片并按 actionId 去重", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    const ev = {
      type: "suspended",
      actionId: "act-1",
      toolName: "write_file",
      args: { path: "a.ts" },
      timeoutMs: 60000,
    } as const;
    applyStreamEvent(turn, ev, { isActiveSession: true }, sink);
    applyStreamEvent(turn, ev, { isActiveSession: true }, sink);
    expect(turn.cards).toHaveLength(1);
    expect(turn.cards![0].type).toBe("approval");
    expect(turn.cards![0].data.status).toBe("pending");
    expect(turn.cards![0].data.expiresInSec).toBe(60);
  });

  it("resumed 以 note/reason 更新审批卡片决策状态", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(
      turn,
      { type: "suspended", actionId: "act-1", toolName: "x", args: {}, timeoutMs: 60000 },
      { isActiveSession: true },
      sink
    );
    applyStreamEvent(
      turn,
      { type: "resumed", actionId: "act-1", payload: { approved: true, note: "没问题" } },
      { isActiveSession: true },
      sink
    );
    expect(turn.cards![0].data.status).toBe("approved");
    expect(turn.cards![0].data.reason).toBe("没问题");
  });

  it("事件源 ui_code_diff / ui_terminal_log / ui_metric_chart 生成对应卡片", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(
      turn,
      { type: "ui_code_diff", file: "a.ts", oldCode: "1", newCode: "2" },
      { isActiveSession: true },
      sink
    );
    applyStreamEvent(
      turn,
      { type: "ui_terminal_log", title: "t", lines: [{ text: "$ ls", kind: "cmd" }] },
      { isActiveSession: true },
      sink
    );
    applyStreamEvent(
      turn,
      { type: "ui_metric_chart", title: "m", points: [{ time: "10:00", value: 3 }] },
      { isActiveSession: true },
      sink
    );
    expect(turn.cards!.map((c) => c.type)).toEqual(["diff", "terminal", "metric"]);
    // 事件源 metric 卡片：points 映射为 series
    expect(turn.cards![2].data.series[0]).toEqual({ label: "10:00", value: 3 });
  });

  it("tool_call_result 仅 bash_run 走终端卡片直渲", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(
      turn,
      { type: "tool_call_result", toolName: "read_file", toolCallId: "c1", status: "done", data: { rendered: false } },
      { isActiveSession: true },
      sink
    );
    expect(turn.cards).toHaveLength(0);
    applyStreamEvent(
      turn,
      { type: "tool_call_result", toolName: "bash_run", toolCallId: "c2", status: "done", data: "ok" },
      { isActiveSession: true },
      sink
    );
    expect(turn.cards).toHaveLength(1);
    expect(turn.cards![0].type).toBe("terminal");
  });
});

describe("工具调用链生命周期（TASK-004 渐进渲染）", () => {
  const start = {
    type: "tool_call_start",
    messageId: "m",
    toolCallId: "c1",
    toolName: "read_file",
  } as const;

  it("start 创建 toolcall 卡片，args_delta 实时回填半截参数", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(turn, start, { isActiveSession: true }, sink);
    expect(turn.cards).toHaveLength(1);
    expect(turn.cards![0].type).toBe("toolcall");
    expect(turn.cards![0].data.status).toBe("streaming");

    applyStreamEvent(
      turn,
      { type: "tool_call_args_delta", toolCallId: "c1", partialArgs: { path: "src/a" } },
      { isActiveSession: true },
      sink
    );
    expect(turn.cards![0].data.args).toEqual({ path: "src/a" });
  });

  it("executing 收敛完整参数，result 收敛状态/结果/耗时", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(turn, start, { isActiveSession: true }, sink);
    applyStreamEvent(
      turn,
      { type: "tool_call_executing", toolCallId: "c1", toolName: "read_file", args: { path: "src/a.ts" } },
      { isActiveSession: true },
      sink
    );
    expect(turn.cards![0].data.status).toBe("executing");

    applyStreamEvent(
      turn,
      { type: "tool_call_result", toolCallId: "c1", toolName: "read_file", status: "done", data: "file content" },
      { isActiveSession: true },
      sink
    );
    expect(turn.cards![0].data.status).toBe("done");
    expect(turn.cards![0].data.result).toBe("file content");
    expect(typeof turn.cards![0].data.duration).toBe("number");
  });

  it("result error 收敛错误态（非 bash_run 的 UI 工具仍分发实体卡片）", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(turn, start, { isActiveSession: true }, sink);
    applyStreamEvent(
      turn,
      {
        type: "tool_call_result",
        toolCallId: "c1",
        toolName: "ui_code_diff",
        status: "done",
        data: { rendered: true, component: "ui_code_diff", props: { fileName: "a.ts", oldText: "1", newText: "2" } },
      },
      { isActiveSession: true },
      sink
    );
    // 调用链卡片收敛 + diff 实体卡片并存
    expect(turn.cards).toHaveLength(2);
    expect(turn.cards![0].type).toBe("toolcall");
    expect(turn.cards![0].data.status).toBe("done");
    expect(turn.cards![1].type).toBe("diff");
  });

  it("start 事件重放去重（断线重连场景）", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(turn, start, { isActiveSession: true }, sink);
    applyStreamEvent(turn, start, { isActiveSession: true }, sink);
    expect(turn.cards).toHaveLength(1);
  });
});

describe("applyUiComponentResult — UI 工具结果 → 卡片分发", () => {
  it("ui_code_diff 工具结果映射为 diff 卡片（fileName/oldText/newText/layout）", () => {
    const turn = makeTurn();
    applyUiComponentResult(
      turn,
      {
        rendered: true,
        component: "ui_code_diff",
        props: { fileName: "src/auth.ts", oldText: "old", newText: "new", layout: "side" },
      },
      "call-1",
      makeSink().sink
    );
    expect(turn.cards).toHaveLength(1);
    const card = turn.cards![0];
    expect(card.type).toBe("diff");
    expect(card.id).toBe("diff-call-1");
    expect(card.data).toMatchObject({ file: "src/auth.ts", oldCode: "old", newCode: "new", view: "side" });
  });

  it("ui_metric_chart 工具结果映射为 metric 卡片", () => {
    const turn = makeTurn();
    applyUiComponentResult(
      turn,
      { rendered: true, component: "ui_metric_chart", props: { title: "QPS", series: [{ label: "a", value: 1 }] } },
      "call-2",
      makeSink().sink
    );
    expect(turn.cards![0]).toMatchObject({ type: "metric", id: "metric-call-2", data: { title: "QPS" } });
  });

  it("ui_agent_plan 工具结果直接同步 planSteps（不生成卡片）", () => {
    const turn = makeTurn();
    const { calls, sink } = makeSink();
    applyUiComponentResult(
      turn,
      {
        rendered: true,
        component: "ui_agent_plan",
        props: { steps: [{ id: "s1", title: "步骤一", status: "done" }] },
      },
      "call-3",
      sink
    );
    expect(turn.cards).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].title).toBe("步骤一");
  });

  it("ui_file_tree / ui_trajectory 分别映射为 tree / trajectory 卡片", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyUiComponentResult(
      turn,
      { rendered: true, component: "ui_file_tree", props: { title: "文件树", tree: [{ path: "src" }] } },
      "call-4",
      sink
    );
    applyUiComponentResult(
      turn,
      { rendered: true, component: "ui_trajectory", props: { events: [{ id: "e1", lane: "tool", role: "tool", title: "t", turn: 1 }] } },
      "call-5",
      sink
    );
    expect(turn.cards!.map((c) => c.type)).toEqual(["tree", "trajectory"]);
    expect(turn.cards![0].id).toBe("tree-call-4");
    expect(turn.cards![1].id).toBe("traj-call-5");
  });

  it("ui_approval_card 工具结果不生成卡片（HITL 流负责）", () => {
    const turn = makeTurn();
    applyUiComponentResult(
      turn,
      { rendered: true, component: "ui_approval_card", props: { title: "x" } },
      "call-6",
      makeSink().sink
    );
    expect(turn.cards).toHaveLength(0);
  });

  it("同一 toolCallId 的工具结果重放自动去重", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    const payload = {
      rendered: true,
      component: "ui_metric_chart",
      props: { title: "QPS", series: [] },
    };
    applyUiComponentResult(turn, payload, "call-dup", sink);
    applyUiComponentResult(turn, payload, "call-dup", sink);
    expect(turn.cards).toHaveLength(1);
  });

  it("无 component 的非法载荷安全忽略", () => {
    const turn = makeTurn();
    applyUiComponentResult(turn, { foo: 1 }, "call-7", makeSink().sink);
    applyUiComponentResult(turn, null, "call-8", makeSink().sink);
    applyUiComponentResult(turn, undefined, "call-9", makeSink().sink);
    expect(turn.cards).toHaveLength(0);
  });
});

describe("输出时序块 blocks（审批卡回到发生位置）", () => {
  it("suspended 卡片插入文本流，后续 text_delta 归入新文本块", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(turn, { type: "text_delta", delta: "先分析", messageId: "m" }, { isActiveSession: true }, sink);
    applyStreamEvent(
      turn,
      { type: "suspended", actionId: "a1", toolName: "bash_run", args: {}, timeoutMs: 60000 },
      { isActiveSession: true },
      sink
    );
    applyStreamEvent(
      turn,
      { type: "resumed", actionId: "a1", payload: { approved: true } },
      { isActiveSession: true },
      sink
    );
    applyStreamEvent(turn, { type: "text_delta", delta: "再继续", messageId: "m" }, { isActiveSession: true }, sink);

    expect(turn.content).toBe("先分析再继续");
    expect(turn.blocks).toEqual([
      { kind: "text", content: "先分析" },
      { kind: "card", cardId: "a1" },
      { kind: "text", content: "再继续" },
    ]);
  });

  it("连续 text_delta 合并进同一文本块；toolcall 卡片也按位置入块", () => {
    const turn = makeTurn();
    const { sink } = makeSink();
    applyStreamEvent(turn, { type: "text_delta", delta: "A", messageId: "m" }, { isActiveSession: true }, sink);
    applyStreamEvent(turn, { type: "text_delta", delta: "B", messageId: "m" }, { isActiveSession: true }, sink);
    applyStreamEvent(
      turn,
      { type: "tool_call_start", messageId: "m", toolCallId: "c1", toolName: "fs_read" },
      { isActiveSession: true },
      sink
    );
    expect(turn.blocks).toEqual([
      { kind: "text", content: "AB" },
      { kind: "card", cardId: "call-c1" },
    ]);
  });

  it("无块信息的旧数据由视图回退 content+cards 两段式（blocks 为 undefined 不报错）", () => {
    const turn = makeTurn();
    delete (turn as Partial<MessageTurn>).blocks;
    const { sink } = makeSink();
    applyStreamEvent(turn, { type: "text_delta", delta: "x", messageId: "m" }, { isActiveSession: true }, sink);
    expect(turn.blocks).toEqual([{ kind: "text", content: "x" }]);
  });
});
