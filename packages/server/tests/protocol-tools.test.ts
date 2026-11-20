/**
 * ui_* 协议契约工具测试（TASK-077 卡片注册表扩展批）
 * - parameters 与 @vuagent/protocol Schema 同源（单一事实，无本地副本）
 * - 渲染类工具 execute 回显 {rendered, component, props}，供 tool-step-executor 落 "ui" 卡
 */
import { describe, expect, it } from "vitest";
import {
  AllBuiltinTools,
  UITaskBoardTool,
  UIChangeSummaryTool,
  UICommentThreadTool,
  UIAiAnswerTool,
} from "../src/tools/ui/protocol-tools.js";
import type { HarnessTool, ToolExecutionContext } from "../src/core/types.js";
import {
  TaskBoardToolSchema,
  ChangeSummaryToolSchema,
  CommentThreadToolSchema,
  AiAnswerToolSchema,
  VuagentToolSchemas,
} from "@vuagent/protocol";

function ctxOf<T extends Record<string, unknown>>(args: T): ToolExecutionContext<T> {
  return {
    toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
    args,
    workspace: { id: "ws-test", name: "t", rootPath: "/tmp", permission: "read-write", createdAt: 0, updatedAt: 0 },
    actionHub: {} as ToolExecutionContext["actionHub"],
    abortSignal: new AbortController().signal,
  };
}

async function execTool(tool: HarnessTool, args: Record<string, unknown>) {
  return tool.execute(ctxOf(args)) as Promise<Record<string, unknown>>;
}

describe("ui_* 协议工具 - 契约同源（TASK-077）", () => {
  it("parameters 直接引用 protocol Schema（单一事实来源，无本地副本）", () => {
    expect(UITaskBoardTool.parameters).toBe(TaskBoardToolSchema);
    expect(UIChangeSummaryTool.parameters).toBe(ChangeSummaryToolSchema);
    expect(UICommentThreadTool.parameters).toBe(CommentThreadToolSchema);
    expect(UIAiAnswerTool.parameters).toBe(AiAnswerToolSchema);
  });

  it("新增 5 工具注册进 AllBuiltinTools，且 VuagentToolSchemas 同步收录", () => {
    const names = [
      "ui_task_board",
      "ui_change_summary",
      "ui_comment_thread",
      "ui_ai_answer",
    ];
    for (const name of names) {
      expect(AllBuiltinTools.some((t) => t.name === name)).toBe(true);
      expect(VuagentToolSchemas).toHaveProperty(name);
    }
  });

  it("渲染类工具：无需审批、无工作区副作用、execute 回显 {rendered, component, props}", async () => {
    const renderTools = [
      [UITaskBoardTool, { columns: [{ id: "c1", title: "待办" }], tasks: [] }],
      [UIChangeSummaryTool, { files: [{ path: "a.ts", additions: 1 }] }],
      [UICommentThreadTool, { comments: [{ id: "c1", author: "agent", text: "x" }] }],
      [UIAiAnswerTool, { answer: "结论 [1]", sources: [{ id: "1", title: "doc" }] }],
    ] as Array<[HarnessTool, Record<string, unknown>]>;
    for (const [tool, args] of renderTools) {
      expect(tool.requiresApproval).toBe(false);
      expect(tool.writesWorkspace).toBe(false);
      const res = await execTool(tool, args);
      expect(res.rendered).toBe(true);
      expect(res.component).toBe(tool.name);
      expect(res.props).toEqual(args);
    }
  });

});
