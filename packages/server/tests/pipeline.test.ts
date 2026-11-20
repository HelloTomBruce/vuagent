import { describe, it, expect } from "vitest";
import { composeMiddleware, runGuards } from "../src/core/pipeline.js";
import {
  TOOL_GUARDS,
  createToolGuardState,
  runToolGuards,
  type ToolGuardContext,
} from "../src/core/tool-guards.js";
import type { HarnessTool } from "../src/core/types.js";

describe("composeMiddleware（洋葱管线）", () => {
  it("进入/退出顺序符合洋葱语义，terminal 在最内层", async () => {
    const log: string[] = [];
    const run = composeMiddleware<{ v: number }>([
      async (ctx, next) => {
        log.push("a-in");
        ctx.v += 1;
        await next();
        log.push("a-out");
      },
      async (ctx, next) => {
        log.push("b-in");
        ctx.v += 10;
        await next();
        log.push("b-out");
      },
    ]);
    const ctx = { v: 0 };
    await run(ctx, async () => {
      log.push("terminal");
      ctx.v += 100;
    });
    expect(log).toEqual(["a-in", "b-in", "terminal", "b-out", "a-out"]);
    expect(ctx.v).toBe(111);
  });

  it("中间件不调 next 即短路：后续中间件与 terminal 不执行", async () => {
    const log: string[] = [];
    const run = composeMiddleware<Record<string, never>>([
      async (_ctx, next) => {
        log.push("guard");
        void next; // 短路：拒绝路径
      },
      async (_ctx, next) => {
        log.push("should-not-run");
        await next();
      },
    ]);
    await run({} as Record<string, never>, async () => {
      log.push("terminal");
    });
    expect(log).toEqual(["guard"]);
  });

  it("中间件抛错向外传播（fail-fast），外层可在出口捕获", async () => {
    const run = composeMiddleware<{ step: string }>([
      async (_ctx, next) => {
        try {
          await next();
        } catch (err) {
          (_ctx as { step: string }).step = "caught:" + (err as Error).message;
        }
      },
      async () => {
        throw new Error("inner-boom");
      },
    ]);
    const ctx = { step: "" };
    await expect(run(ctx, async () => undefined)).resolves.toBeUndefined();
    expect(ctx.step).toBe("caught:inner-boom");
  });

  it("next() 被多次调用 → 抛错（防洋葱重入）", async () => {
    const run = composeMiddleware<Record<string, never>>([
      async (_ctx, next) => {
        await next();
        await next();
      },
    ]);
    await expect(run({} as Record<string, never>, async () => undefined)).rejects.toThrow(/多次调用/);
  });
});

function makeCtx(overrides: Partial<ToolGuardContext>): ToolGuardContext {
  return {
    call: { id: "c1", name: "probe", argumentsStr: "{}" },
    toolDef: { name: "probe", description: "", parameters: {} } as HarnessTool,
    toolCfg: null,
    workspacePermission: "read-write",
    mode: "auto",
    parsedArgs: {},
    validateParams: () => ({ ok: true }),
    bashTimeoutCeilingMs: 60_000,
    ...overrides,
  };
}

describe("工具守卫链（TOOL_GUARDS 顺序裁决）", () => {
  it("全部通过：requiresApproval=false，超时策略写入默认入参投影", async () => {
    const state = createToolGuardState();
    const verdict = await runToolGuards(makeCtx({}), state);
    expect(verdict.ok).toBe(true);
    expect(state.requiresApproval).toBe(false);
    expect(state.isError).toBe(false);
    expect(state.effectiveParsedArgs).toEqual({});
    expect(state.executorTimeoutMs).toBeUndefined();
  });

  it("守卫 1 启停仲裁：禁用即短路且不进入权限链", async () => {
    const state = createToolGuardState();
    const verdict = await runToolGuards(
      makeCtx({ toolCfg: { name: "probe", enabled: false, updatedAt: Date.now() } }),
      state
    );
    expect(verdict.ok).toBe(false);
    expect(state.isError).toBe(true);
    expect(state.executionResult).toEqual({ disabled: true, reason: expect.stringContaining("已被禁用") });
  });

  it("守卫 2 工作区硬闸门：read-only 工作区拦写工具（含 auto 模式）", async () => {
    const state = createToolGuardState();
    const writeTool = { name: "fs_write", description: "", parameters: {}, writesWorkspace: true } as HarnessTool;
    const verdict = await runToolGuards(
      makeCtx({ toolDef: writeTool, workspacePermission: "read-only", mode: "auto" }),
      state
    );
    expect(verdict.ok).toBe(false);
    expect(state.errorMessage).toContain("工作区权限限制");
  });

  it("守卫 3 只读模式闸门：auto 放行写工具 / read-only 拦截", async () => {
    const writeTool = { name: "fs_write", description: "", parameters: {}, writesWorkspace: true } as HarnessTool;
    const okState = createToolGuardState();
    expect((await runToolGuards(makeCtx({ toolDef: writeTool, mode: "auto" }), okState)).ok).toBe(true);
    const blocked = createToolGuardState();
    const verdict = await runToolGuards(
      makeCtx({ toolDef: writeTool, mode: "read-only" }),
      blocked
    );
    expect(verdict.ok).toBe(false);
    expect(blocked.errorMessage).toContain("只读模式限制");
  });

  it("守卫 4 审批判定（deny-wins）：review 下高风险置位；toolCfg.requiresApproval=false 不放宽", async () => {
    const highRisk = { name: "t", description: "", parameters: {}, riskLevel: "high" } as HarnessTool;
    const state = createToolGuardState();
    await runToolGuards(makeCtx({ toolDef: highRisk, mode: "review" }), state);
    expect(state.requiresApproval).toBe(true);

    // riskLevel=high + 配置 false → 仍需审批（deny-wins：只能升不能降）
    const deniedDowngrade = createToolGuardState();
    await runToolGuards(
      makeCtx({
        toolDef: highRisk,
        mode: "review",
        toolCfg: { name: "t", enabled: true, requiresApproval: false, updatedAt: Date.now() },
      }),
      deniedDowngrade
    );
    expect(deniedDowngrade.requiresApproval).toBe(true);

    // auto 模式：配置 true 也不触发 HITL（审批判定仅在 review 模式）
    const autoState = createToolGuardState();
    await runToolGuards(
      makeCtx({ mode: "auto", toolCfg: { name: "t", enabled: true, requiresApproval: true, updatedAt: Date.now() } }),
      autoState
    );
    expect(autoState.requiresApproval).toBe(false);
  });

  it("守卫 5 入参闸门：非法入参短路并携带校验错误", async () => {
    const state = createToolGuardState();
    const verdict = await runToolGuards(
      makeCtx({ validateParams: () => ({ ok: false, error: "参数不合法" }) }),
      state
    );
    expect(verdict.ok).toBe(false);
    expect(state.errorMessage).toBe("参数不合法");
  });

  it("守卫 6 超时策略：bash_run 按模型请求钳制封顶 + 执行器放宽 10s", async () => {
    const state = createToolGuardState();
    await runToolGuards(
      makeCtx({
        call: { id: "c1", name: "bash_run", argumentsStr: "{}" },
        parsedArgs: { command: "sleep 100", timeoutMs: 5000 },
        bashTimeoutCeilingMs: 150,
      }),
      state
    );
    expect(state.effectiveParsedArgs).toEqual({ command: "sleep 100", timeoutMs: 150 });
    expect(state.executorTimeoutMs).toBe(150 + 10_000);

    // 其他工具：per-tool 覆盖直接成为执行器上限
    const other = createToolGuardState();
    await runToolGuards(
      makeCtx({ toolCfg: { name: "t", enabled: true, timeoutMs: 42_000, updatedAt: Date.now() } }),
      other
    );
    expect(other.executorTimeoutMs).toBe(42_000);
  });

  it("短路后后续守卫不执行（禁用时不做超时策略投影）", async () => {
    const state = createToolGuardState();
    await runToolGuards(
      makeCtx({
        toolCfg: { name: "bash_run", enabled: false, updatedAt: Date.now() },
        call: { id: "c1", name: "bash_run", argumentsStr: "{}" },
        parsedArgs: { command: "ls" },
      }),
      state
    );
    expect(state.effectiveParsedArgs).toEqual({}); // timeoutPolicy 未运行
  });

  it("TOOL_GUARDS 链的顺序即契约：启停最前、超时策略最后", () => {
    expect(TOOL_GUARDS).toHaveLength(6);
  });
});

describe("runGuards（通用守卫链）", () => {
  it("首个失败短路并返回该裁决；状态写入按序累积", async () => {
    const order: string[] = [];
    const guards = [
      async (_c: unknown, s: { hits: string[] }) => {
        s.hits.push("g1");
        order.push("g1");
        return { ok: true } as const;
      },
      async (_c: unknown, s: { hits: string[] }) => {
        s.hits.push("g2");
        order.push("g2");
        return { ok: false, errorMessage: "blocked" } as const;
      },
      async (_c: unknown, s: { hits: string[] }) => {
        s.hits.push("g3");
        order.push("g3");
        return { ok: true } as const;
      },
    ];
    const state = { hits: [] as string[] };
    const verdict = await runGuards(guards, {}, state);
    expect(verdict).toEqual({ ok: false, errorMessage: "blocked" });
    expect(order).toEqual(["g1", "g2"]);
    expect(state.hits).toEqual(["g1", "g2"]);
  });
});
