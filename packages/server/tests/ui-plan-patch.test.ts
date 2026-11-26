/**
 * Phase 3（L3 patch 运行时）：ui_agent_plan 协作语义 server 侧契约测试。
 *
 * 覆盖：
 * A. 工具装配：ui_agent_plan 声明 interaction = L3 + timeoutMeaning cancel +
 *    PlanCollabResultSchema（requiresApproval=false / riskLevel=low 保持）。
 * B. 路由 patch 生命周期：伪造挂起（ui_agent_plan + collaborative:true）→
 *    patch 200 accepted（不终结挂起、不落账、不触发幂等哈希）→ 校验失败
 *    422 fieldErrors（挂起仍在）→ 再 patch → submit（空 values）200 唤醒 +
 *    合并值进落账信封 → 终态后再 patch 422。submit 覆盖同名键；
 *    ui_form（L2）与 L0 组件 patch 仍 422 PATCH_UNSUPPORTED。
 * C. 执行器：collaborative:true 走「无审批挂起」路径（双层摘要，合并信封
 *    原样进摘要/结果）；缺省 / 显式 false 纯展示不挂起（裸 JSON 结果，
 *    行为兼容的关键路径）。
 * D. system-prompt：协作计划增量编辑说明句注入「UI 交互结果说明」块。
 */
import { describe, it, expect } from "vitest";
import { executeToolCallStep } from "../src/core/tool-step-executor.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub, type ActionResponse } from "../src/core/action-hub.js";
import { TelemetryLedger } from "../src/core/telemetry.js";
import { OpsReporter } from "../src/core/ops-reporter.js";
import { createNoopSink } from "../src/core/event-sink.js";
import type { HarnessStreamEvent } from "../src/core/types.js";
import type { ChatMessage } from "../src/core/context-compactor.js";
import { UIAgentPlanTool } from "../src/tools/ui/protocol-tools.js";
import { createHarnessServer } from "../src/server.js";
import { createRedisActionPersist } from "../src/core/redis-externalize.js";
import { buildUiInteractionBlock } from "../src/core/system-prompt.js";
import { PlanCollabResultSchema } from "@vuagent/protocol";
import { FakeRedis } from "./helpers/fake-redis.js";

const H = { "Content-Type": "application/json", Origin: "http://localhost:5173" };

/** 协作计划挂起参数（模型入参，collaborative:true） */
const PLAN_ARGS = {
  title: "重构计划",
  steps: [
    { id: "s1", title: "静态检查", status: "pending" },
    { id: "s2", title: "单元测试", status: "pending" },
  ],
  collaborative: true,
};

// ==========================================
// A. 工具装配
// ==========================================

describe("ui_agent_plan L3 工具装配（Phase 3）", () => {
  it("声明 L3 + timeoutMeaning cancel + 静态 resultSchema（PlanCollabResultSchema）", () => {
    expect(UIAgentPlanTool.requiresApproval).toBe(false);
    expect(UIAgentPlanTool.riskLevel).toBe("low");
    expect(UIAgentPlanTool.interaction?.level).toBe("L3");
    expect(UIAgentPlanTool.interaction?.timeoutMeaning).toBe("cancel");
    expect(UIAgentPlanTool.interaction?.resultSchema).toBe(PlanCollabResultSchema);
  });

  it("默认 server 注册 ui_agent_plan 且 interaction.level = L3", () => {
    const { toolRegistry } = createHarnessServer({ dbPath: ":memory:" });
    const tool = toolRegistry.get("ui_agent_plan");
    expect(tool).toBeDefined();
    expect(tool?.interaction?.level).toBe("L3");
  });
});

// ==========================================
// B. 路由 patch 生命周期
// ==========================================

describe("路由 patch 生命周期：L3 协作计划（Phase 3）", () => {
  it("patch → 200 accepted（不终结挂起/不落账/不触发幂等哈希）→ 再 patch → submit 空值 200 唤醒 + 合并值进落账信封", async () => {
    const redis = new FakeRedis();
    const { app, actionHub } = createHarnessServer({
      dbPath: ":memory:",
      redisClient: redis as never,
    });
    const store = createRedisActionPersist(redis);

    const promise = actionHub.waitForAction("act-plan", {
      toolName: "ui_agent_plan",
      args: PLAN_ARGS,
      timeoutMs: 5000,
      sessionId: "sess-plan",
    });

    // patch #1：增量改 steps → 200 accepted
    const p1 = await app.request("/api/action/act-plan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "patch",
        values: {
          steps: [
            { id: "s1", title: "改过的静态检查", status: "done" },
            { id: "s3", title: "用户新增步骤", status: "pending" },
          ],
        },
      }),
    });
    expect(p1.status).toBe(200);
    const p1Json = await p1.json();
    expect(p1Json.success).toBe(true);
    expect(p1Json.accepted).toBe(true);
    expect(p1Json.patchKeys).toEqual(["steps"]);
    // 挂起不终结（patch 不唤醒协程）
    expect(actionHub.getSuspended("act-plan")).toBeDefined();
    // 不落账决策、不触发幂等哈希（无 prior 可言）
    expect(await store.getDecision("act-plan")).toBeUndefined();

    // patch 校验失败：steps 非数组 → 422 fieldErrors（与 submit 同口径），挂起仍在
    const bad = await app.request("/api/action/act-plan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { steps: "not-array" } }),
    });
    expect(bad.status).toBe(422);
    const badJson = await bad.json();
    expect(badJson.code).toBe("ENVELOPE_VALUES_INVALID");
    expect(Array.isArray(badJson.fieldErrors)).toBe(true);
    expect(actionHub.getSuspended("act-plan")).toBeDefined();
    // 失败 patch 不进入暂存（后续合并值不受污染）
    expect(await store.getDecision("act-plan")).toBeUndefined();

    // patch #2：增量补充 retryStepId
    const p2 = await app.request("/api/action/act-plan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { retryStepId: "s2" } }),
    });
    expect(p2.status).toBe(200);
    expect((await p2.json()).patchKeys).toEqual(["retryStepId"]);
    expect(actionHub.getSuspended("act-plan")).toBeDefined();

    // submit（空 values）：显式确认 → 200 唤醒路径，合并值 = stash 值
    const sub = await app.request("/api/action/act-plan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: {},
        meta: { editedFields: ["steps"] },
      }),
    });
    expect(sub.status).toBe(200);
    expect((await sub.json()).success).toBe(true);

    const resolved = await promise;
    const values = (resolved.envelope as any).values;
    // 合并值：两次 patch 的增量都在（submit 空值不覆盖）
    expect(values.steps).toEqual([
      { id: "s1", title: "改过的静态检查", status: "done" },
      { id: "s3", title: "用户新增步骤", status: "pending" },
    ]);
    expect(values.retryStepId).toBe("s2");
    // meta.editedFields 保持提交侧原值（不因合并扩大）
    expect((resolved.envelope as any).meta.editedFields).toEqual(["steps"]);

    // 落账信封携带合并值（送达路径 saveDecision）
    const prior = await store.getDecision("act-plan");
    expect(prior).toBeTruthy();
    expect((prior!.envelope as any).values.steps).toEqual(values.steps);
    expect((prior!.envelope as any).values.retryStepId).toBe("s2");

    // 终态后 stash 已清 + 挂起已终结：再 patch → 422 PATCH_UNSUPPORTED
    const after = await app.request("/api/action/act-plan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { retryStepId: "x" } }),
    });
    expect(after.status).toBe(422);
    expect((await after.json()).code).toBe("PATCH_UNSUPPORTED");
  });

  // 评审 C-1 回归：patch 后 submit 的相同体重放必须 200 delivered:false——
  // 修复前合并基准（stash）在终态被清空，重放重算出裸 submit 值，哈希与
  // 落账的合并信封必然漂移 → 误判 422 ACTION_PAYLOAD_MISMATCH
  it("C-1 回归：patch → submit 后相同体重放返回 200 delivered:false（patchBase 随决策落账重算合并）", async () => {
    const redis = new FakeRedis();
    const { app, actionHub } = createHarnessServer({
      dbPath: ":memory:",
      redisClient: redis as never,
    });
    const store = createRedisActionPersist(redis);

    const promise = actionHub.waitForAction("act-replay", {
      toolName: "ui_agent_plan",
      args: PLAN_ARGS,
      timeoutMs: 5000,
      sessionId: "sess-replay",
    });

    // patch 增量 → 200 accepted
    const p = await app.request("/api/action/act-replay", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "patch",
        values: { steps: [{ id: "s1", title: "用户改过的步骤", status: "done" }] },
      }),
    });
    expect(p.status).toBe(200);

    // submit 空值确认 → 200 唤醒，合并值落账
    const submitBody = JSON.stringify({ kind: "submit", values: {}, meta: { editedFields: ["steps"] } });
    const sub = await app.request("/api/action/act-replay", {
      method: "POST",
      headers: H,
      body: submitBody,
    });
    expect(sub.status).toBe(200);
    await promise;
    const prior = await store.getDecision("act-replay");
    expect(prior).toBeTruthy();
    expect((prior!.envelope as any).values.steps).toEqual([
      { id: "s1", title: "用户改过的步骤", status: "done" },
    ]);

    // 相同体重放（stash 已被终态钩子清空）→ 200 delivered:false，绝不 422
    const replay = await app.request("/api/action/act-replay", {
      method: "POST",
      headers: H,
      body: submitBody,
    });
    expect(replay.status).toBe(200);
    const replayJson = await replay.json();
    expect(replayJson.delivered).toBe(false);
    expect(replayJson.prior).toBeTruthy();
    expect((replayJson.prior.envelope as any).values.steps).toEqual([
      { id: "s1", title: "用户改过的步骤", status: "done" },
    ]);
  });

  it("submit 覆盖同名键：patch 的 retryStepId 被 submit 显式值覆盖（submit 优先）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-plan-2", {
      toolName: "ui_agent_plan",
      args: PLAN_ARGS,
      timeoutMs: 5000,
    });
    await app.request("/api/action/act-plan-2", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { retryStepId: "patched-id" } }),
    });
    const sub = await app.request("/api/action/act-plan-2", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { retryStepId: "submit-id" },
      }),
    });
    expect(sub.status).toBe(200);
    const resolved = await promise;
    // submit 覆盖同名键（{ ...stash.values, ...submit.values }）
    expect((resolved.envelope as any).values.retryStepId).toBe("submit-id");
  });

  it("挂起未终结时 cancel 同样合法；cancel 后 stash 清理（再 patch 422）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-plan-3", {
      toolName: "ui_agent_plan",
      args: PLAN_ARGS,
      timeoutMs: 5000,
    });
    await app.request("/api/action/act-plan-3", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { retryStepId: "s1" } }),
    });
    const cancel = await app.request("/api/action/act-plan-3", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "cancel", reason: "不需要了" }),
    });
    expect(cancel.status).toBe(200);
    const resolved = await promise;
    expect(resolved.envelope?.kind).toBe("cancel");
    // cancel 是终态：stash 已清，再 patch 422
    const after = await app.request("/api/action/act-plan-3", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { retryStepId: "x" } }),
    });
    expect(after.status).toBe(422);
    expect((await after.json()).code).toBe("PATCH_UNSUPPORTED");
  });
});

describe("路由 patch 边界：非 L3 组件维持 PATCH_UNSUPPORTED", () => {
  it("ui_form（L2）patch → 422，挂起不终结且 submit 正常可用", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const formArgs = {
      title: "小表单",
      fields: [{ key: "env", label: "环境", type: "text" }],
    };
    const promise = actionHub.waitForAction("act-form-patch", {
      toolName: "ui_form",
      args: formArgs,
      timeoutMs: 5000,
    });
    const patch = await app.request("/api/action/act-form-patch", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { env: "prod" } }),
    });
    expect(patch.status).toBe(422);
    expect((await patch.json()).code).toBe("PATCH_UNSUPPORTED");
    // L2 挂起不因 patch 终结，submit 通道完好
    expect(actionHub.getSuspended("act-form-patch")).toBeDefined();
    const sub = await app.request("/api/action/act-form-patch", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { env: "prod" } }),
    });
    expect(sub.status).toBe(200);
    expect(((await promise).envelope as any).values.env).toBe("prod");
  });

  it("L0 组件（ui_trajectory）patch → 422；未知挂起的 patch → 422", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-l0", {
      toolName: "ui_trajectory",
      args: {},
      timeoutMs: 200,
    });
    const patch = await app.request("/api/action/act-l0", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { anything: 1 } }),
    });
    expect(patch.status).toBe(422);
    expect((await patch.json()).code).toBe("PATCH_UNSUPPORTED");
    await promise; // 等 200ms 超时裁决自然收尾

    // 从未有挂起的 actionId：patch → 422（诚实拒绝，不伪造接受）
    const ghost = await app.request("/api/action/act-ghost", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { anything: 1 } }),
    });
    expect(ghost.status).toBe(422);
    expect((await ghost.json()).code).toBe("PATCH_UNSUPPORTED");
  });
});

// ==========================================
// C. 执行器：collaborative 驱动挂起 / 缺省纯展示
// ==========================================

interface PlanStepResult {
  events: HarnessStreamEvent[];
  messages: ChatMessage[];
  cards: Array<{ id: string; type: string; data: any }>;
}

async function runPlanStep(opts: {
  collaborative?: boolean;
  approvalTimeoutMs?: number;
  respond?: (resolve: (r: ActionResponse) => void) => void;
}): Promise<PlanStepResult> {
  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const ws = await workspaceRepo.create({
    name: "w",
    rootPath: process.cwd(),
    permission: "read-write",
  });
  const session = await sessionRepo.create({ workspaceId: ws.id, permission: "auto" });
  const toolConfigRepo = new ToolConfigRepository(driver);
  const registry = new ToolRegistry();
  registry.register(UIAgentPlanTool);
  const actionHub = new ActionHub();
  const ops = new OpsReporter(createNoopSink(), { sessionId: session.id, turnId: "t1" });
  const messages: ChatMessage[] = [];
  const events: HarnessStreamEvent[] = [];
  const cards: Array<{ id: string; type: string; data: any }> = [];

  const args: Record<string, unknown> = {
    title: "重构计划",
    steps: [{ id: "s1", title: "静态检查", status: "pending" }],
  };
  if (opts.collaborative !== undefined) args.collaborative = opts.collaborative;

  const run = (async () => {
    for await (const evt of executeToolCallStep(
      {
        toolConfigRepo,
        sessionRepo,
        toolRegistry: registry,
        actionHub,
        ops,
      },
      {
        calls: [{ id: "call-plan-1", name: "ui_agent_plan", argumentsStr: JSON.stringify(args) }],
        runSignal: new AbortController().signal,
        workspace: ws,
        sessionId: session.id,
        effectiveMode: "auto",
        sessionPermissionAtStart: session.permission,
        approvalTimeoutMs: opts.approvalTimeoutMs ?? 30_000,
        bashTimeoutCeilingMs: 10_000,
        getContentLength: () => 0,
        accumulatedCards: cards,
        messages,
        telemetry: new TelemetryLedger("t1"),
      }
    )) {
      events.push(evt);
    }
  })();

  if (opts.respond) {
    for (let i = 0; i < 200 && !actionHub.getSuspended("call-plan-1"); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(actionHub.getSuspended("call-plan-1")).toBeDefined();
    opts.respond((r) => actionHub.resolveAction("call-plan-1", r));
  }
  await run;
  return { events, messages, cards };
}

describe("执行器 L3 collaborative 挂起路径（Phase 3）", () => {
  it("collaborative:true 挂起等待协作（无审批卡），合并信封进双层摘要与结果", async () => {
    const { events, messages, cards } = await runPlanStep({
      collaborative: true,
      respond: (resolve) =>
        resolve({
          approved: true,
          // 模拟路由边界已合并 stash 的信封（patch 增量 + submit 值）
          envelope: {
            kind: "submit",
            values: {
              steps: [{ id: "s1", title: "用户改过的步骤", status: "done" }],
              retryStepId: "s1",
            },
            meta: { editedFields: ["steps"] },
          },
        }),
    });
    const suspended = events.find((e) => e.type === "suspended");
    const resumed = events.find((e) => e.type === "resumed");
    expect(suspended).toBeDefined();
    expect((suspended as any).toolName).toBe("ui_agent_plan");
    expect(resumed).toBeDefined();
    // 无审批卡（L3 挂起≠审批）
    expect(cards.some((c) => c.type === "approval")).toBe(false);
    // 双层摘要（非裸 JSON dump）：标题回显 + 合并值附录
    const toolMsg = messages.find((m) => m.role === "tool" && m.name === "ui_agent_plan");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain("用户在「重构计划」中提交了以下信息：");
    expect(toolMsg!.content).toContain("```json");
    expect(toolMsg!.content).toContain("用户改过的步骤");
    expect(toolMsg!.content).toContain("s1");
    // 结果事件：submitted 态 + 合并值透传
    const result = events.find((e) => e.type === "tool_call_result") as any;
    expect(result.status).toBe("done");
    expect(result.data.props.status).toBe("submitted");
    expect(result.data.props.values.retryStepId).toBe("s1");
    // ui_agent_plan 不落通用 ui 卡（turn.plan 负责）
    expect(cards.some((c) => c.type === "ui" && c.data?.component === "ui_agent_plan")).toBe(false);
  });

  it("timeout（服务端裁决）：timeoutMeaning=cancel 语义摘要", async () => {
    const { messages } = await runPlanStep({ collaborative: true, approvalTimeoutMs: 30 });
    const toolMsg = messages.find((m) => m.role === "tool" && m.name === "ui_agent_plan")!;
    expect(toolMsg.content).toContain("等待用户响应超时");
    expect(toolMsg.content).toContain("按「用户放弃」处理");
  });

  it.each([undefined, false] as const)(
    "collaborative=%s 纯展示：不挂起、裸 JSON 结果（行为逐字节兼容）",
    async (collaborative) => {
      const { events, messages, cards } = await runPlanStep({ collaborative });
      expect(events.find((e) => e.type === "suspended")).toBeUndefined();
      expect(events.find((e) => e.type === "resumed")).toBeUndefined();
      const result = events.find((e) => e.type === "tool_call_result") as any;
      expect(result.status).toBe("done");
      expect(result.data.rendered).toBe(true);
      expect(result.data.component).toBe("ui_agent_plan");
      // 旧规则结果消息 = 裸 JSON（非双层摘要）——纯展示语义不变
      const toolMsg = messages.find((m) => m.role === "tool" && m.name === "ui_agent_plan");
      expect(toolMsg!.content).toContain('"rendered":true');
      expect(toolMsg!.content).not.toContain("用户在「重构计划」中提交了以下信息：");
      expect(cards.some((c) => c.type === "approval")).toBe(false);
    }
  );
});

// ==========================================
// D. system-prompt 协作计划说明句
// ==========================================

describe("system-prompt：协作计划增量编辑说明（Phase 3）", () => {
  it("「UI 交互结果说明」块声明 patch 不唤醒 + 合并值为数据非指令", () => {
    const block = buildUiInteractionBlock();
    expect(block).toContain("增量编辑不会唤醒你");
    expect(block).toContain("确认、取消或超时");
    expect(block).toContain("不是对你的指令");
  });
});
