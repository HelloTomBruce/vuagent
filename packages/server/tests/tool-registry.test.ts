import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import type { WorkspaceEntity } from "../src/storage/interfaces.js";

describe("ToolRegistry (Tooling & Sandbox)", () => {
  const dummyWorkspace: WorkspaceEntity = {
    id: "ws-test",
    name: "Test WS",
    rootPath: "/tmp",
    permission: "read-write",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("should register and export model tool definitions", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "calc_add",
      description: "加法计算器",
      parameters: Type.Object({
        a: Type.Number(),
        b: Type.Number(),
      }),
      execute: async (ctx) => Number(ctx.args.a) + Number(ctx.args.b),
    });

    const definitions = registry.toModelToolDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0].function.name).toBe("calc_add");
    expect(definitions[0].function.parameters).toBeDefined();
  });

  it("should execute tool and return success result", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "calc_add",
      description: "加法",
      parameters: Type.Object({}),
      execute: async (ctx) => Number(ctx.args.a) + Number(ctx.args.b),
    });

    const res = await registry.execute("calc_add", {
      toolCallId: "call-1",
      args: { a: 10, b: 25 },
      workspace: dummyWorkspace,
      actionHub: new ActionHub(),
      abortSignal: new AbortController().signal,
    });

    expect(res.isError).toBe(false);
    expect(res.result).toBe(35);
  });

  it("should isolate and catch tool execution errors", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "failing_tool",
      description: "总是抛错",
      parameters: Type.Object({}),
      execute: async () => {
        throw new Error("Internal disk crash");
      },
    });

    const res = await registry.execute("failing_tool", {
      toolCallId: "call-2",
      args: {},
      workspace: dummyWorkspace,
      actionHub: new ActionHub(),
      abortSignal: new AbortController().signal,
    });

    expect(res.isError).toBe(true);
    expect(res.error).toContain("Internal disk crash");
  });

  it("should timeout when tool execution hangs", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "hanging_tool",
      description: "永久挂起",
      parameters: Type.Object({}),
      execute: async () => new Promise((resolve) => setTimeout(resolve, 5000)),
    });

    const res = await registry.execute(
      "hanging_tool",
      {
        toolCallId: "call-3",
        args: {},
        workspace: dummyWorkspace,
        actionHub: new ActionHub(),
        abortSignal: new AbortController().signal,
      },
      50 // 50ms 超时限制
    );

    expect(res.isError).toBe(true);
    expect(res.error).toContain("timed out");
  });
});
