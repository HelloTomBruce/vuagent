/**
 * 自动折叠判定纯函数单测（TASK-016，TASK-017 反馈修订）
 * 覆盖：shouldCollapseThoughtOnFinish 开关矩阵、
 * toolCardDefaultOpen「跟随 turn 流式状态」的新语义（输出中展开 / 流结束一并收起）
 */
import { describe, expect, it } from "vitest";
import {
  shouldCollapseProcessOnFinish,
  shouldCollapseThoughtOnFinish,
  toolCardDefaultOpen,
} from "../utils/auto-collapse";
import { defaultInteractionSettings } from "../composables/useInteractionSettings";

describe("shouldCollapseProcessOnFinish（统一摘要条折叠）", () => {
  it("两项开关均开（默认）→ 收进「已完成」摘要条", () => {
    expect(shouldCollapseProcessOnFinish(defaultInteractionSettings())).toBe(true);
    expect(
      shouldCollapseProcessOnFinish({ autoCollapseThought: true, autoCollapseToolCards: true })
    ).toBe(true);
  });

  it("任一开关关闭 → 不启用统一摘要条，退回各自独立行为", () => {
    expect(
      shouldCollapseProcessOnFinish({ autoCollapseThought: false, autoCollapseToolCards: true })
    ).toBe(false);
    expect(
      shouldCollapseProcessOnFinish({ autoCollapseThought: true, autoCollapseToolCards: false })
    ).toBe(false);
    expect(
      shouldCollapseProcessOnFinish({ autoCollapseThought: false, autoCollapseToolCards: false })
    ).toBe(false);
  });
});

describe("shouldCollapseThoughtOnFinish", () => {
  it("开关开（默认）→ 流式结束时折叠思考框", () => {
    expect(shouldCollapseThoughtOnFinish(defaultInteractionSettings())).toBe(true);
    expect(shouldCollapseThoughtOnFinish({ autoCollapseThought: true })).toBe(true);
  });

  it("开关关 → 保持现状不折叠", () => {
    expect(shouldCollapseThoughtOnFinish({ autoCollapseThought: false })).toBe(false);
  });
});

describe("toolCardDefaultOpen · 开关开（autoCollapseToolCards: true）", () => {
  const on = { autoCollapseToolCards: true };

  it("输出期间（turnStreaming）任何生命周期状态都保持展开", () => {
    for (const status of ["streaming", "executing", "done", undefined] as const) {
      expect(toolCardDefaultOpen(on, { turnStreaming: true, status })).toBe(true);
    }
  });

  it("turn 流式结束 → 与思考过程一并收起（只留最终结果）", () => {
    expect(toolCardDefaultOpen(on, { turnStreaming: false, status: "done" })).toBe(false);
    expect(toolCardDefaultOpen(on, { turnStreaming: false, status: "executing" })).toBe(false);
    expect(toolCardDefaultOpen(on, { turnStreaming: false, status: undefined })).toBe(false);
  });

  it("error → 不占用 defaultOpen，由 open-on-error 恒展开兜底（运行中与结束后一致）", () => {
    expect(toolCardDefaultOpen(on, { turnStreaming: true, status: "error" })).toBe(false);
    expect(toolCardDefaultOpen(on, { turnStreaming: false, status: "error" })).toBe(false);
  });
});

describe("toolCardDefaultOpen · 开关关（autoCollapseToolCards: false）", () => {
  const off = { autoCollapseToolCards: false };

  it("streaming → 展开（保持原行为）", () => {
    expect(toolCardDefaultOpen(off, { turnStreaming: true, status: "streaming" })).toBe(true);
    expect(toolCardDefaultOpen(off, { turnStreaming: false, status: "streaming" })).toBe(true);
  });

  it("executing → 按组件默认收起（保持原行为）", () => {
    expect(toolCardDefaultOpen(off, { turnStreaming: true, status: "executing" })).toBe(false);
  });

  it("done → 收起", () => {
    expect(toolCardDefaultOpen(off, { turnStreaming: false, status: "done" })).toBe(false);
  });

  it("error → 不占用 defaultOpen，由 open-on-error 恒展开兜底", () => {
    expect(toolCardDefaultOpen(off, { turnStreaming: false, status: "error" })).toBe(false);
  });

  it("未知/缺省状态 → 收起", () => {
    expect(toolCardDefaultOpen(off, { turnStreaming: false, status: undefined })).toBe(false);
    expect(toolCardDefaultOpen(off, { turnStreaming: true, status: "pending" })).toBe(false);
  });
});
