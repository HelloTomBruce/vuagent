import { describe, it, expect } from "vitest";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { HarnessStreamEvent, HarnessTool } from "../src/core/types.js";

/** find 结果断言收窄（未找到时直接失败） */
function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("card not found");
  return value;
}

describe("AgentLoop 工具卡片持久化（TASK-006）", () => {
  async function setup() {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const toolRegistry = new ToolRegistry();
    const actionHub = new ActionHub();
    const mockDriver = new MockDriver();

    const ws = await workspaceRepo.create({
      name: "Card WS",
      rootPath: "/tmp",
      permission: "read-write",
    });
    const session = await sessionRepo.create({
      workspaceId: ws.id,
      title: "Card Session",
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

    return { ws, session, toolRegistry, mockDriver, loop, sessionRepo };
  }

  async function collect(
    loop: AgentLoop,
    req: { workspaceId: string; sessionId: string; prompt: string }
  ): Promise<HarnessStreamEvent[]> {
    const events: HarnessStreamEvent[] = [];
    for await (const evt of loop.runTurn(req)) {
      events.push(evt);
    }
    return events;
  }

  it("ui_* 契约工具结果持久化为 ui 通用卡 + toolcall 卡（含 contentOffset）", async () => {
    const { ws, session, toolRegistry, mockDriver, loop, sessionRepo } =
      await setup();

    const chartTool: HarnessTool = {
      name: "ui_metric_chart",
      description: "展示统计趋势",
      parameters: { type: "object", properties: {} },
      riskLevel: "low",
      execute: async (ctx) => ({
        rendered: true,
        component: "ui_metric_chart",
        props: (ctx.args as Record<string, unknown>).props ?? { title: "QPS" },
      }),
    };
    toolRegistry.register(chartTool);

    mockDriver.setScript({
      steps: [
        [
          { type: "text", text: "好的，我来展示图表。" },
          {
            type: "tool_call",
            id: "call-chart-1",
            name: "ui_metric_chart",
            arguments: { title: "QPS" },
          },
        ],
        [{ type: "text", text: "图表已展示完毕。" }],
      ],
    });

    await collect(loop, {
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "展示图表",
    });

    const detail = await sessionRepo.get(session.id);
    const turn = detail!.turns[detail!.turns.length - 1];
    const cards = turn.cards ?? [];

    const toolcallCard = must(cards.find((c: any) => c.id === "call-call-chart-1"));
    const uiCard = must(cards.find((c: any) => c.id === "ui-call-chart-1"));

    expect(toolcallCard).toBeDefined();
    expect(toolcallCard.type).toBe("toolcall");
    expect(toolcallCard.data.status).toBe("done");
    expect(toolcallCard.data.toolName).toBe("ui_metric_chart");
    expect(typeof toolcallCard.data.contentOffset).toBe("number");
    expect(toolcallCard.data.contentOffset).toBeGreaterThan(0);
    expect(typeof toolcallCard.data.duration).toBe("number");

    expect(uiCard).toBeDefined();
    expect(uiCard.type).toBe("ui");
    expect(uiCard.data.component).toBe("ui_metric_chart");
    expect(uiCard.data.props).toEqual({ title: "QPS" });
    expect(typeof uiCard.data.contentOffset).toBe("number");
  });

  it("bash_run 结果持久化 terminal 卡，错误时收敛 error 终态", async () => {
    const { ws, session, toolRegistry, mockDriver, loop, sessionRepo } =
      await setup();

    const stubBash: HarnessTool = {
      name: "bash_run",
      description: "执行命令",
      parameters: { type: "object", properties: {} },
      riskLevel: "low",
      execute: async () => "command output text",
    };
    toolRegistry.register(stubBash);

    mockDriver.setScript({
      steps: [
        [
          { type: "text", text: "执行命令。" },
          {
            type: "tool_call",
            id: "call-bash-9",
            name: "bash_run",
            arguments: { command: "echo hi" },
          },
        ],
        [{ type: "text", text: "完成。" }],
      ],
    });

    await collect(loop, {
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "执行",
    });

    const detail = await sessionRepo.get(session.id);
    const turn = detail!.turns[detail!.turns.length - 1];
    const cards = turn.cards ?? [];

    const callCard = must(cards.find((c: any) => c.id === "call-call-bash-9"));
    const termCard = must(cards.find((c: any) => c.id === "term-call-bash-9"));

    expect(callCard).toBeDefined();
    expect(callCard.data.status).toBe("done");
    expect(callCard.data.result).toBe("command output text");

    expect(termCard).toBeDefined();
    expect(termCard.type).toBe("terminal");
    expect(termCard.data.title).toContain("bash_run");
    expect(termCard.data.lines.some((l: any) => l.text.includes("command output text"))).toBe(true);
    expect(typeof termCard.data.contentOffset).toBe("number");
  });

  it("非契约工具（返回非 rendered 对象）不产生 ui 卡", async () => {
    const { ws, session, toolRegistry, mockDriver, loop, sessionRepo } =
      await setup();

    const plainTool: HarnessTool = {
      name: "fs_read",
      description: "读文件",
      parameters: { type: "object", properties: {} },
      riskLevel: "low",
      execute: async () => "plain file content",
    };
    toolRegistry.register(plainTool);

    mockDriver.setScript({
      steps: [
        [
          { type: "text", text: "读取文件。" },
          {
            type: "tool_call",
            id: "call-read-1",
            name: "fs_read",
            arguments: { filePath: "a.txt" },
          },
        ],
        [{ type: "text", text: "读完。" }],
      ],
    });

    await collect(loop, {
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "读",
    });

    const detail = await sessionRepo.get(session.id);
    const turn = detail!.turns[detail!.turns.length - 1];

    expect((turn.cards ?? []).some((c: any) => c.id === "ui-call-read-1")).toBe(false);
    expect((turn.cards ?? []).some((c: any) => c.id === "call-call-read-1")).toBe(true);
    expect((turn.cards ?? []).some((c: any) => c.id.startsWith("term-"))).toBe(false);
  });

  it("fs_edit 成功时自然投影 diff 卡片，无需模型调用 ui_code_diff", async () => {
    const { ws, session, toolRegistry, mockDriver, loop, sessionRepo } =
      await setup();

    const stubEdit: HarnessTool = {
      name: "fs_edit",
      description: "修改文件",
      parameters: { type: "object", properties: {} },
      riskLevel: "low",
      execute: async () => ({ success: true, replaced: 1 }),
    };
    toolRegistry.register(stubEdit);

    mockDriver.setScript({
      steps: [
        [
          { type: "text", text: "修改代码。" },
          {
            type: "tool_call",
            id: "call-edit-1",
            name: "fs_edit",
            arguments: {
              filePath: "src/main.ts",
              oldString: "const a = 1;",
              newString: "const a = 2;",
            },
          },
        ],
        [{ type: "text", text: "修改完毕。" }],
      ],
    });

    await collect(loop, {
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "修改",
    });

    const detail = await sessionRepo.get(session.id);
    const turn = detail!.turns[detail!.turns.length - 1];
    const cards = turn.cards ?? [];

    const diffCard = must(cards.find((c: any) => c.id === "diff-call-edit-1"));
    expect(diffCard).toBeDefined();
    expect(diffCard.type).toBe("diff");
    expect(diffCard.data.file).toBe("src/main.ts");
    expect(diffCard.data.oldCode).toBe("const a = 1;");
    expect(diffCard.data.newCode).toBe("const a = 2;");
    expect(diffCard.data.view).toBe("unified");
    expect(typeof diffCard.data.contentOffset).toBe("number");
  });
});
