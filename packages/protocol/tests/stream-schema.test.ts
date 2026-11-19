import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  HarnessStreamEventSchemas,
  HarnessStreamEventSchema,
  validateHarnessStreamEvent,
  getHarnessStreamEventErrors,
  type HarnessStreamEvent,
} from "../src/index.js";

/** 全部事件类型的 happy-path 样本（与 HarnessStreamEventSchemas 注册表一一对应） */
const HAPPY_SAMPLES: Record<string, HarnessStreamEvent> = {
  thought_delta: { type: "thought_delta", delta: "思考中" },
  text_delta: { type: "text_delta", messageId: "msg-1", delta: "你好" },
  ui_agent_plan: {
    type: "ui_agent_plan",
    title: "执行计划",
    steps: [{ id: "s1", title: "检查", status: "running", startedAt: 1 }],
  },
  ui_code_diff: { type: "ui_code_diff", file: "a.ts", oldCode: "1", newCode: "2", additions: 1, deletions: 1 },
  ui_terminal_log: { type: "ui_terminal_log", title: "t", lines: [{ text: "$ ls", kind: "cmd" }] },
  ui_metric_chart: { type: "ui_metric_chart", title: "c", points: [{ time: "10:00", value: 1 }] },
  tool_call_start: { type: "tool_call_start", messageId: "m", toolCallId: "c1", toolName: "fs_read" },
  tool_call_args_delta: { type: "tool_call_args_delta", toolCallId: "c1", partialArgs: { filePath: "a" } },
  tool_call_executing: { type: "tool_call_executing", toolCallId: "c1", toolName: "fs_read", args: {} },
  tool_call_result: { type: "tool_call_result", toolCallId: "c1", toolName: "fs_read", status: "done", data: {} },
  usage: {
    type: "usage",
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    contextWindow: 128000,
    parts: [{ id: "system", label: "系统提示", tokens: 10, kind: "system" }],
  },
  suspended: { type: "suspended", actionId: "a1", toolName: "bash_run", args: {}, timeoutMs: 180000 },
  traj: {
    type: "traj",
    event: {
      id: "e1",
      at: 1,
      lane: "tool",
      role: "tool",
      title: "fs_read",
      result: "ok",
      turn: 1,
      durationMs: 12,
    },
  },
  resumed: { type: "resumed", actionId: "a1", payload: { approved: true } },
  turn_end: { type: "turn_end", stepCount: 2, durationMs: 1500 },
  turn_start: { type: "turn_start", turnId: "turn-1", startedAt: 1 },
  aborted: { type: "aborted", turnId: "turn-1", reason: "user" },
  error: { type: "error", message: "boom", code: "MODEL_RATE_LIMIT" },
};

/** 契约内期望的事件全集：新增/删除事件必须同步更新此处（防漏卡口） */
const EXPECTED_EVENT_TYPES = [
  "thought_delta",
  "text_delta",
  "ui_agent_plan",
  "ui_code_diff",
  "ui_terminal_log",
  "ui_metric_chart",
  "tool_call_start",
  "tool_call_args_delta",
  "tool_call_executing",
  "tool_call_result",
  "usage",
  "suspended",
  "traj",
  "resumed",
  "turn_end",
  "turn_start",
  "aborted",
  "error",
] as const;

describe("HarnessStreamEventSchema（TASK-053 契约运行时化）", () => {
  it("注册表覆盖期望的事件全集（新增/删除/改名在此失败）", () => {
    expect(Object.keys(HarnessStreamEventSchemas).sort()).toEqual([...EXPECTED_EVENT_TYPES].sort());
  });

  it.each(Object.keys(HAPPY_SAMPLES))("happy path: %s 通过校验", (type) => {
    const event = HAPPY_SAMPLES[type];
    expect(validateHarnessStreamEvent(event)).toBe(true);
  });

  it.each(Object.keys(HAPPY_SAMPLES))("非法变体: %s 被拒绝", (type) => {
    // 通用非法变体：type 字段不存在于该事件成员 → union 匹配失败
    const broken = { ...HAPPY_SAMPLES[type], type: "__no_such_event__" };
    expect(validateHarnessStreamEvent(broken)).toBe(false);
  });

  it("每事件的针对性非法变体被拒绝（字段级漂移卡口）", () => {
    const invalids: Array<Record<string, unknown>> = [
      { type: "text_delta", delta: 123 }, // messageId 缺失 + delta 类型错
      { type: "thought_delta" }, // delta 缺失
      { type: "tool_call_result", toolCallId: "c", toolName: "t", status: "running" }, // status 非法
      { type: "usage", promptTokens: "10", completionTokens: 5, totalTokens: 15 }, // tokens 类型错
      { type: "usage", promptTokens: 1, completionTokens: 1, totalTokens: 2, parts: [{ id: "x", label: "l", tokens: 1, kind: "file" }] }, // parts.kind 越界
      { type: "suspended", actionId: "a", toolName: "t", args: {}, timeoutMs: "180" }, // timeoutMs 类型错
      { type: "turn_end", stepCount: 1 }, // durationMs 缺失
      { type: "error" }, // message 缺失
      { type: "traj", event: { id: "e", at: 1, lane: "oops", role: "tool", title: "t", turn: 1 } }, // lane 越界
      { type: "resumed" }, // actionId/payload 缺失
      { type: "turn_start" }, // turnId/startedAt 缺失
      { type: "aborted", reason: "mystery" }, // reason 越界
    ];
    for (const bad of invalids) {
      expect(validateHarnessStreamEvent(bad)).toBe(false);
    }
  });

  it("非严格语义：多余字段前向兼容（服务端先增字段不破坏旧校验器）", () => {
    const withExtra = { ...HAPPY_SAMPLES.turn_end, futureField: "whatever" };
    expect(validateHarnessStreamEvent(withExtra)).toBe(true);
  });

  it("可选字段缺省通过（usage 无 parts / thought_delta 无 messageId / traj 无 endAt）", () => {
    expect(
      validateHarnessStreamEvent({ type: "usage", promptTokens: 1, completionTokens: 1, totalTokens: 2 })
    ).toBe(true);
    expect(validateHarnessStreamEvent({ type: "thought_delta", delta: "x" })).toBe(true);
  });

  it("getHarnessStreamEventErrors 已知事件名时给出字段级路径", () => {
    const errors = getHarnessStreamEventErrors({ type: "usage", promptTokens: "x", completionTokens: 1, totalTokens: 2 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.path.includes("promptTokens") || e.message.includes("promptTokens"))).toBe(true);
  });

  it("getHarnessStreamEventErrors 未知事件名回落 union 级（根路径）", () => {
    const errors = getHarnessStreamEventErrors({ type: "__nope__" });
    expect(errors.length).toBeGreaterThan(0);
    expect(typeof errors[0].path).toBe("string");
    expect(typeof errors[0].message).toBe("string");
  });

  it("非对象输入被拒绝", () => {
    expect(validateHarnessStreamEvent(null)).toBe(false);
    expect(validateHarnessStreamEvent("text")).toBe(false);
    expect(validateHarnessStreamEvent(42)).toBe(false);
  });

  it("Static 推导类型与手写样本互相兼容（编译期即校验，此处运行时兜底）", () => {
    const samples = Object.values(HAPPY_SAMPLES) as HarnessStreamEvent[];
    for (const s of samples) {
      expect(Value.Check(HarnessStreamEventSchema, s)).toBe(true);
    }
  });
});
