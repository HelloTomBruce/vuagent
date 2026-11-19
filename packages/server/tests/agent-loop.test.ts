import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import type { HarnessStreamEvent } from "../src/core/types.js";

describe("AgentLoop (Loop & Lifecycle + HITL)", () => {
  async function setup() {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const toolRegistry = new ToolRegistry();
    const actionHub = new ActionHub();
    const mockDriver = new MockDriver();

    const ws = await workspaceRepo.create({
      name: "Test Workspace",
      rootPath: "/tmp",
      permission: "read-write",
    });

    const session = await sessionRepo.create({
      workspaceId: ws.id,
      title: "Test Session",
    });

    await settingsRepo.createProfile({
      id: "test-model",
      name: "Test Model",
      provider: "openai",
      model: "test-mock-model",
      isDefault: true,
    });

    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry,
      actionHub,
      modelDriver: mockDriver,
    });

    return {
      ws,
      session,
      toolRegistry,
      actionHub,
      mockDriver,
      loop,
      sessionRepo,
    };
  }

  it("should complete simple conversation turn without tool call", async () => {
    const { ws, session, mockDriver, loop } = await setup();

    mockDriver.setScript({
      steps: [
        [
          {
            type: "text",
            text: "你好！我是你的智能助手。",
          },
        ],
      ],
    });

    const events: HarnessStreamEvent[] = [];
    for await (const evt of loop.runTurn({
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "你好",
    })) {
      events.push(evt);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta");
    expect(textDeltas.length).toBeGreaterThan(0);

    const turnEnd = events.find((e) => e.type === "turn_end");
    expect(turnEnd).toBeDefined();
  });

  it("should execute ReAct loop with tool call and return tool result", async () => {
    const { ws, session, toolRegistry, mockDriver, loop } = await setup();

    // 注册测试工具
    toolRegistry.register({
      name: "get_weather",
      description: "查询天气",
      parameters: Type.Object({ city: Type.String() }),
      execute: async (ctx) => ({
        city: ctx.args.city,
        temp: 24,
        condition: "Sunny",
      }),
    });

    // Turn 1 包含两步：第 1 步调用天气工具，第 2 步根据结果做出总结回答
    mockDriver.setScript({
      steps: [
        // 步骤 1: 模型决定调用 get_weather 工具
        [
          {
            type: "tool_call",
            id: "call-weather-1",
            name: "get_weather",
            arguments: { city: "Hangzhou" },
          },
        ],
        // 步骤 2: 模型收到结果后输出总结
        [
          {
            type: "text",
            text: "杭州今天气温 24 度，晴空万里！",
          },
        ],
      ],
    });

    const events: HarnessStreamEvent[] = [];
    for await (const evt of loop.runTurn({
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "杭州天气怎么样？",
    })) {
      events.push(evt);
    }

    expect(events.some((e) => e.type === "tool_call_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_call_executing")).toBe(true);
    const resultEvt = events.find((e) => e.type === "tool_call_result");
    expect(resultEvt).toBeDefined();
    if (resultEvt && resultEvt.type === "tool_call_result") {
      expect(resultEvt.status).toBe("done");
      expect((resultEvt.data as any).temp).toBe(24);
    }

    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  it("should suspend for HITL approval and resume after human decision", async () => {
    const { ws, session, toolRegistry, actionHub, mockDriver, loop } = await setup();

    // 注册高危需要审批的工具
    toolRegistry.register({
      name: "deploy_service",
      description: "上线发布服务",
      parameters: Type.Object({ version: Type.String() }),
      riskLevel: "high",
      requiresApproval: true,
      execute: async (ctx) => ({ deployed: true, version: ctx.args.version }),
    });

    mockDriver.setScript({
      steps: [
        [
          {
            type: "tool_call",
            id: "call-deploy-99",
            name: "deploy_service",
            arguments: { version: "v2.0.0" },
          },
        ],
        [
          {
            type: "text",
            text: "服务已成功发布至线上生产环境！",
          },
        ],
      ],
    });

    const events: HarnessStreamEvent[] = [];

    // 启动异步循环消费
    const runPromise = (async () => {
      for await (const evt of loop.runTurn({
        workspaceId: ws.id,
        sessionId: session.id,
        prompt: "帮我发布 v2.0.0 版本",
      })) {
        events.push(evt);
        if (evt.type === "suspended") {
          // 验证挂起项已在 ActionHub 中就绪
          expect(actionHub.getSuspended("call-deploy-99")).toBeDefined();

          // 模拟用户在前端点击“批准”唤醒
          actionHub.resolveAction("call-deploy-99", {
            approved: true,
            note: "通过审批",
          });
        }
      }
    })();

    await runPromise;

    expect(events.some((e) => e.type === "suspended")).toBe(true);
    expect(events.some((e) => e.type === "resumed")).toBe(true);
    expect(events.some((e) => e.type === "tool_call_result")).toBe(true);
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });
});
