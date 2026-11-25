/**
 * TASK-094：工具并行执行
 *
 * - 双独立工具桩并发执行（执行期并发计数 max=2 为确定性证据；墙钟佐证留 ≥40% 余量）；
 * - 同名工具互斥串行（max 并发=1，总耗时 = 两者之和）；
 * - 评审 #3：写类工具（writesWorkspace=true）与任何工具零重叠（执行期 max 并发=1），
 *   纯读批次仍并行；
 * - 评审 C3：并行分支执行器抛错 → 生成器正常终止（Promise.race 超时保护）、
 *   已完成工具事件保留在事件流、原始错误重抛；
 * - parallelTools=false 回退全串行（事件序 = call 序）；
 * - 结果消息按 call 序归位（Phase C）——完成序 ≠ 消息序时的确定性断言；
 * - 事件按完成时序流出（快工具不等慢工具）。
 */
import { describe, expect, it } from "vitest";
import { executeToolCallStep } from "../src/core/tool-step-executor.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { TelemetryLedger } from "../src/core/telemetry.js";
import { OpsReporter } from "../src/core/ops-reporter.js";
import { createNoopSink } from "../src/core/event-sink.js";
import { Type } from "@sinclair/typebox";
import type {
  HarnessTool,
  HarnessStreamEvent,
  ToolExecutionContext,
} from "../src/core/types.js";
import type { ChatMessage } from "../src/core/context-compactor.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 执行期并发计数器：进入/退出工具执行时计数并记录最大并发（#3/C3 的确定性证据源） */
function createConcurrencyTracker() {
  let active = 0;
  let max = 0;
  return {
    get max(): number {
      return max;
    },
    enter(): void {
      active++;
      max = Math.max(max, active);
    },
    exit(): void {
      active--;
    },
  };
}

type ConcurrencyTracker = ReturnType<typeof createConcurrencyTracker>;

function slowTool(
  name: string,
  ms: number,
  result: string,
  tracker?: ConcurrencyTracker
): HarnessTool {
  return {
    name,
    description: "slow stub tool",
    parameters: Type.Object({}),
    riskLevel: "low",
    requiresApproval: false,
    writesWorkspace: false,
    execute: async () => {
      tracker?.enter();
      try {
        await sleep(ms);
        return result;
      } finally {
        tracker?.exit();
      }
    },
  };
}

/** 写类桩工具（#3）：writesWorkspace=true 声明，行为同 slowTool */
function trackedWriteTool(
  name: string,
  ms: number,
  result: string,
  tracker: ConcurrencyTracker
): HarnessTool {
  return {
    ...slowTool(name, ms, result, tracker),
    description: "tracked write stub tool",
    writesWorkspace: true,
  };
}

async function setup() {
  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const ws = await workspaceRepo.create({
    name: "w",
    rootPath: process.cwd(),
    permission: "read-write",
  });
  const session = await sessionRepo.create({ workspaceId: ws.id, permission: "auto" });
  return { driver, sessionRepo, ws, session, toolConfigRepo: new ToolConfigRepository(driver) };
}

async function runStep(opts: {
  tools: HarnessTool[];
  calls: Array<{ id: string; name: string; argumentsStr: string }>;
  parallelTools?: boolean;
}) {
  const { sessionRepo, ws, session, toolConfigRepo } = await setup();
  const registry = new ToolRegistry();
  for (const t of opts.tools) registry.register(t);
  const ops = new OpsReporter(createNoopSink(), { sessionId: session.id, turnId: "t1" });
  const messages: ChatMessage[] = [];
  const events: HarnessStreamEvent[] = [];
  for await (const evt of executeToolCallStep(
    {
      toolConfigRepo,
      sessionRepo,
      toolRegistry: registry,
      actionHub: new ActionHub(),
      ops,
    },
    {
      calls: opts.calls,
      runSignal: new AbortController().signal,
      workspace: ws,
      sessionId: session.id,
      effectiveMode: "auto",
      sessionPermissionAtStart: session.permission,
      approvalTimeoutMs: 1_000,
      bashTimeoutCeilingMs: 10_000,
      getContentLength: () => 0,
      accumulatedCards: [],
      messages,
      telemetry: new TelemetryLedger("t1"),
      parallelTools: opts.parallelTools,
    }
  )) {
    events.push(evt);
  }
  return { events, messages };
}

describe("工具并行执行（TASK-094）", () => {
  it("双独立工具并发：执行窗口重叠（max 并发=2），墙钟 ≈ 较慢者（余量 ≥40%）", async () => {
    const tracker = createConcurrencyTracker();
    const started = Date.now();
    const { events } = await runStep({
      tools: [slowTool("slow_a", 220, "A", tracker), slowTool("slow_b", 220, "B", tracker)],
      calls: [
        { id: "c1", name: "slow_a", argumentsStr: "{}" },
        { id: "c2", name: "slow_b", argumentsStr: "{}" },
      ],
      parallelTools: true,
    });
    const elapsed = Date.now() - started;
    // 确定性证据：两工具执行窗口重叠（串行实现下 max=1 直接失败）
    expect(tracker.max).toBe(2);
    // 墙钟佐证（#12：阈值放宽 ≥40% 防慢 CI 抖动；并发回归由 tracker 断言兜底）
    expect(elapsed).toBeLessThan(Math.ceil((220 + 220) * 1.4));
    const results = events.filter((e) => e.type === "tool_call_result");
    expect(results).toHaveLength(2);
  });

  it("同名工具互斥串行：max 并发=1，总耗时 ≈ 两者之和（下界余量 ≥40%）", async () => {
    const tracker = createConcurrencyTracker();
    const started = Date.now();
    await runStep({
      tools: [slowTool("slow_a", 200, "A1", tracker)],
      calls: [
        { id: "c1", name: "slow_a", argumentsStr: "{}" },
        { id: "c2", name: "slow_a", argumentsStr: "{}" },
      ],
      parallelTools: true,
    });
    expect(tracker.max).toBe(1);
    // 串行下界（#12：放宽 ≥40% 防时钟粒度/慢 CI 抖动；互斥回归由 tracker 断言兜底）
    expect(Date.now() - started).toBeGreaterThanOrEqual(Math.floor((200 + 200) * 0.6));
  });

  it("parallelTools=false 回退全串行（事件序 = call 序）", async () => {
    const { events } = await runStep({
      tools: [slowTool("slow_a", 150, "A"), slowTool("fast_b", 10, "B")],
      calls: [
        { id: "c1", name: "slow_a", argumentsStr: "{}" },
        { id: "c2", name: "fast_b", argumentsStr: "{}" },
      ],
      parallelTools: false,
    });
    const results = events.filter((e) => e.type === "tool_call_result");
    expect((results[0] as { toolName: string }).toolName).toBe("slow_a");
    expect((results[1] as { toolName: string }).toolName).toBe("fast_b");
  });

  it("完成序 ≠ 消息序：快工具先完成，但 tool 消息按 call 序归位", async () => {
    const { events, messages } = await runStep({
      tools: [slowTool("slow_a", 150, "A"), slowTool("fast_b", 10, "B")],
      calls: [
        { id: "c1", name: "slow_a", argumentsStr: "{}" },
        { id: "c2", name: "fast_b", argumentsStr: "{}" },
      ],
      parallelTools: true,
    });
    // 事件按完成时序：fast_b 的结果事件先于 slow_a（并发证据）
    const results = events.filter((e) => e.type === "tool_call_result");
    expect((results[0] as { toolName: string }).toolName).toBe("fast_b");
    expect((results[1] as { toolName: string }).toolName).toBe("slow_a");
    // 消息按 call 序归位（模型侧确定性）
    expect(messages.map((m) => (m as { name?: string }).name)).toEqual(["slow_a", "fast_b"]);
    expect((messages[0] as { tool_call_id: string }).tool_call_id).toBe("c1");
    expect((messages[1] as { tool_call_id: string }).tool_call_id).toBe("c2");
  });

  it("#3 含写工具批次：写工具与任何工具零重叠（执行期 max 并发=1）；纯读批次仍并行", async () => {
    // 写+读批次：fs_write（writesWorkspace=true）与 fs_read 不得重叠执行
    const tracker = createConcurrencyTracker();
    const { events } = await runStep({
      tools: [
        trackedWriteTool("fs_write", 90, "W", tracker),
        slowTool("fs_read", 90, "R", tracker),
      ],
      calls: [
        { id: "c1", name: "fs_write", argumentsStr: "{}" },
        { id: "c2", name: "fs_read", argumentsStr: "{}" },
      ],
      parallelTools: true,
    });
    expect(tracker.max).toBe(1); // 写屏障：写执行期间并发恒为 1
    const results = events.filter((e) => e.type === "tool_call_result");
    expect(results).toHaveLength(2);

    // 对照组：纯读批次仍按名字互斥并行（max=2），写屏障不误伤读并行
    const readTracker = createConcurrencyTracker();
    await runStep({
      tools: [
        slowTool("read_a", 90, "A", readTracker),
        slowTool("read_b", 90, "B", readTracker),
      ],
      calls: [
        { id: "c1", name: "read_a", argumentsStr: "{}" },
        { id: "c2", name: "read_b", argumentsStr: "{}" },
      ],
      parallelTools: true,
    });
    expect(readTracker.max).toBe(2);
  });

  it("C3 并行分支失败注入：执行器抛错 → 生成器正常终止（race 超时保护）、已完成工具事件保留、错误重抛", async () => {
    // 注入点：registry.execute（工具执行器边界）——tool.execute 内部抛错会被
    // ToolRegistry.execute 捕获转 isError 结果，只有执行器本身抛错才会走到
    // Promise.all 的拒绝路径（旧实现 .then(close) 在该路径永久卡死 drain）。
    class ThrowingRegistry extends ToolRegistry {
      override async execute(
        toolName: string,
        ctx: ToolExecutionContext,
        timeoutMs?: number
      ) {
        if (toolName === "boom") {
          // 延迟抛错：确保 ok_fast（20ms）先完成并流出事件，再失败——
          // 验证「失败时已完成工具事件保留」；同步抛错会让失败先于一切完成
          await sleep(120);
          throw new Error("sandbox exploded (injected)");
        }
        return super.execute(toolName, ctx, timeoutMs);
      }
    }

    const { sessionRepo, ws, session, toolConfigRepo } = await setup();
    const registry = new ThrowingRegistry();
    registry.register(slowTool("ok_fast", 20, "A")); // 在 boom 抛错前完成
    registry.register(slowTool("boom", 120, "B"));
    const ops = new OpsReporter(createNoopSink(), { sessionId: session.id, turnId: "t1" });
    const messages: ChatMessage[] = [];
    const events: HarnessStreamEvent[] = [];

    // 生成器终止保护：旧实现该场景下 drain 永不结束，Promise.race 超时即 fail
    const outcome = await Promise.race([
      (async () => {
        try {
          for await (const evt of executeToolCallStep(
            {
              toolConfigRepo,
              sessionRepo,
              toolRegistry: registry,
              actionHub: new ActionHub(),
              ops,
            },
            {
              calls: [
                { id: "c1", name: "ok_fast", argumentsStr: "{}" },
                { id: "c2", name: "boom", argumentsStr: "{}" },
              ],
              runSignal: new AbortController().signal,
              workspace: ws,
              sessionId: session.id,
              effectiveMode: "auto",
              sessionPermissionAtStart: session.permission,
              approvalTimeoutMs: 1_000,
              bashTimeoutCeilingMs: 10_000,
              getContentLength: () => 0,
              accumulatedCards: [],
              messages,
              telemetry: new TelemetryLedger("t1"),
              parallelTools: true,
            }
          )) {
            events.push(evt);
          }
          return { kind: "completed" as const };
        } catch (err) {
          return { kind: "threw" as const, err };
        }
      })(),
      sleep(3_000).then(() => ({ kind: "timeout" as const })),
    ]);

    if (outcome.kind === "timeout") {
      throw new Error(
        `[C3 诊断] 生成器 3s 未终止（drain 卡死）。已流出事件: [${
          events.map((e) => e.type).join(", ") || "无"
        }]，messages=${messages.length}`
      );
    }
    expect(outcome.kind).toBe("threw");
    if (outcome.kind !== "threw") return; // TS 收窄（上一断言失败时已终止）
    expect((outcome.err as Error).message).toContain("sandbox exploded (injected)");

    // 已完成工具的事件仍在事件流中（ok_fast 在 boom 抛错前完成并流出）
    const okResults = events.filter(
      (e) =>
        e.type === "tool_call_result" &&
        (e as { toolName?: string }).toolName === "ok_fast"
    );
    expect(okResults).toHaveLength(1);
  });
});
