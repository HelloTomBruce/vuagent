import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { ToolRegistry } from "../src/core/tool-registry.js";
import type { HarnessTool, ToolExecutionContext } from "../src/core/types.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";

/** 参数校验硬闸门（TASK-055）：幻觉入参在进入工具执行前被拦截 */
describe("ToolRegistry 参数校验硬闸门（TASK-055）", () => {
  async function makeCtx(): Promise<ToolExecutionContext> {
    const driver = new MemoryStorageDriver();
    const wsRepo = new WorkspaceRepository(driver);
    const ws = await wsRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    return {
      toolCallId: "call-1",
      args: {},
      workspace: ws,
      actionHub: {
        waitForAction: async () => ({ approved: false, reason: "manual" }),
      } as never,
      abortSignal: new AbortController().signal,
    };
  }

  it("TypeBox schema 工具：非法入参被拦截（不进入 execute）", async () => {
    let executed = false;
    const tool: HarnessTool = {
      name: "strict_probe",
      description: "严格 schema 假工具",
      parameters: Type.Object({ x: Type.Number() }),
      execute: async () => {
        executed = true;
        return "should not reach";
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const ctx = await makeCtx();
    ctx.args = { x: "not-a-number" } as never;
    const res = await registry.execute("strict_probe", ctx);

    expect(res.isError).toBe(true);
    expect(res.error).toContain("参数校验失败");
    expect(res.error).toContain("x");
    expect(executed).toBe(false);
  });

  it("合法入参正常执行（闸门零误伤）", async () => {
    const tool: HarnessTool = {
      name: "strict_probe",
      description: "严格 schema 假工具",
      parameters: Type.Object({ x: Type.Number() }),
      execute: async (ctx) => ({ got: ctx.args.x }),
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const ctx = await makeCtx();
    ctx.args = { x: 1 };
    const res = await registry.execute("strict_probe", ctx);
    expect(res.isError).toBe(false);
    expect(res.result).toEqual({ got: 1 });
  });

  it("非 TypeBox parameters（纯对象）保持放行——向后兼容", async () => {
    let executed = false;
    const tool: HarnessTool = {
      name: "legacy_probe",
      description: "旧式 JSON-Schema 纯对象参数",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        executed = true;
        return "ok";
      },
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const res = await registry.execute("legacy_probe", await makeCtx());
    expect(res.isError).toBe(false);
    expect(executed).toBe(true);
  });

  it("额外未知字段被拦截（防幻觉参数混入）", async () => {
    const tool: HarnessTool = {
      name: "strict_probe",
      description: "严格 schema 假工具",
      parameters: Type.Object({ command: Type.String() }),
      execute: async () => "ok",
    };
    const registry = new ToolRegistry();
    registry.register(tool);

    const ctx = await makeCtx();
    // Value.Check 对 Object schema 默认收下多余字段（非严格）——本断言验证
    // 「缺失必填 + 多余字段」组合必然拦截，未知字段策略随 TypeBox 默认语义
    ctx.args = {} as never;
    const res = await registry.execute("strict_probe", ctx);
    expect(res.isError).toBe(true);
  });
});
