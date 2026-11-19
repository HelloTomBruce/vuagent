import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { validateHarnessStreamEvent, getHarnessStreamEventErrors } from "@vuagent/protocol";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import type { HarnessStreamEvent, HarnessTool } from "../src/core/types.js";

/**
 * 线上契约回归（TASK-053）：真实 AgentLoop emit 的每个事件必须通过
 * protocol 的运行时 schema 校验。服务端事件形状漂移在此拦截，
 * 而不是等前端 reducer 静默错乱。
 */
describe("流事件契约回归（server emit → protocol schema）", () => {
  it("MockDriver 轮次（文本 + 工具调用 + HITL 审批）全事件通过运行时校验", async () => {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);

    const ws = await workspaceRepo.create({ name: "ws", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "s" });
    await settingsRepo.createProfile({
      id: "p1",
      name: "P",
      provider: "openai",
      model: "m",
      apiKey: "sk-test",
      isDefault: true,
    });

    // 需审批的假工具（触发 suspended/resumed 链路）
    const gatedTool: HarnessTool = {
      name: "gated_probe",
      description: "高危假工具：触发 HITL",
      parameters: Type.Object({ x: Type.Number() }),
      riskLevel: "high",
      execute: async () => ({ ok: true }),
    };
    const registry = new ToolRegistry();
    registry.register(gatedTool);

    const actionHub = new ActionHub();
    const mock = new MockDriver();
    mock.setScript({
      steps: [
        // ReAct 首步：文本 + 工具调用（有工具调用循环才继续消耗下一 script 条目）
        [
          { type: "text", text: "先检查再回复" },
          { type: "tool_call", id: "call-1", name: "gated_probe", arguments: { x: 1 } },
        ],
        // 工具结果回填后的收尾步
        [{ type: "text", text: "审批后继续" }],
      ],
    });

    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: registry,
      actionHub,
      modelDriver: mock,
    });

    const events: HarnessStreamEvent[] = [];
    const consumption = (async () => {
      for await (const ev of loop.runTurn(
        { sessionId: session.id, workspaceId: ws.id, prompt: "走完整链路", permission: "review" },
        undefined
      )) {
        events.push(ev);
        // 命中审批挂起即批准，驱动 suspended→resumed→执行→后续步
        if (ev.type === "suspended") {
          actionHub.resolveAction(ev.actionId, { approved: true, reason: "manual", note: "测试批准" });
        }
      }
    })();

    await consumption;

    // 覆盖面自检：本轮应至少产出 text/traj/tool_call_*/suspended/resumed/turn_end
    const types = new Set(events.map((e) => e.type));
    for (const expected of ["text_delta", "traj", "tool_call_start", "tool_call_executing", "tool_call_result", "suspended", "resumed", "turn_end"]) {
      expect(types.has(expected as never), `缺少事件类型 ${expected}`).toBe(true);
    }

    // 核心：每个事件通过运行时 schema 校验
    for (const ev of events) {
      expect(validateHarnessStreamEvent(ev), `${ev.type} 校验失败: ${JSON.stringify(getHarnessStreamEventErrors(ev))}`).toBe(true);
    }

    // 轮次正常收尾落库
    const after = await sessionRepo.get(session.id);
    expect(after!.turns[0].status).toBe("done");
  });
});
