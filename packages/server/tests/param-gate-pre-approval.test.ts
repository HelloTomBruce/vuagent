import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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
import { FsReadTool, FsWriteTool } from "../src/tools/system/fs-tools.js";
import { BashRunTool } from "../src/tools/system/bash-tool.js";
import type { WorkspaceEntity, SessionEntity } from "../src/storage/interfaces.js";
import type { HarnessStreamEvent, HarnessTool } from "../src/core/types.js";

/**
 * TASK-059 入参闸门前移：幻觉入参在 HITL 挂起判断前被 ToolRegistry.validateParams
 * 拦截——不产生审批卡（无 suspended/resumed 事件）、不占用人工注意力，
 * 非法入参直接走 isError 路径回喂模型（附校验错误文案）。
 * 对照组：合法入参的 review 审批流不回退（permission-matrix 既有矩阵同步回归）。
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vuagent-gate-"));
  tmpDirs.push(dir);

  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const settingsRepo = new SettingsRepository(driver);
  const toolRegistry = new ToolRegistry();
  const actionHub = new ActionHub();
  const mockDriver = new MockDriver();

  const ws = await workspaceRepo.create({
    name: "Gate Workspace",
    rootPath: dir,
    permission: "read-write",
  });
  const session = await sessionRepo.create({
    workspaceId: ws.id,
    title: "Gate Session",
  });
  await settingsRepo.createProfile({
    id: "test-model",
    name: "Test Model",
    provider: "openai",
    model: "test-mock-model",
    isDefault: true,
  });

  for (const t of [FsReadTool, FsWriteTool, BashRunTool]) toolRegistry.register(t);

  const loop = new AgentLoop({
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolConfigRepo: new ToolConfigRepository(driver),
    toolRegistry,
    actionHub,
    modelDriver: mockDriver,
  });

  return { ws, session, loop, mockDriver, actionHub, sessionRepo, toolRegistry, dir };
}

/** 驱动一次单工具调用的 turn，返回完整事件流 */
async function runToolTurn(
  loop: AgentLoop,
  mockDriver: MockDriver,
  ws: WorkspaceEntity,
  session: SessionEntity,
  toolCall: { id: string; name: string; arguments: Record<string, unknown> },
  permission?: "auto" | "review" | "read-only",
  onSuspended?: (actionId: string) => void
): Promise<HarnessStreamEvent[]> {
  mockDriver.setScript({
    steps: [
      [
        {
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      ],
      [{ type: "text", text: "turn finished" }],
    ],
  });

  const events: HarnessStreamEvent[] = [];
  for await (const evt of loop.runTurn({
    workspaceId: ws.id,
    sessionId: session.id,
    prompt: "执行工具",
    permission,
  })) {
    events.push(evt);
    if (evt.type === "suspended") {
      onSuspended?.(evt.actionId);
    }
  }
  return events;
}

function getResultEvent(events: HarnessStreamEvent[]) {
  const evt = events.find((e) => e.type === "tool_call_result");
  expect(evt).toBeDefined();
  return evt as Extract<HarnessStreamEvent, { type: "tool_call_result" }>;
}

describe("TASK-059 入参闸门前移（幻觉参数不占人工审批）", () => {
  it("review × bash_run 非法入参（缺 command）：无 suspended/resumed，直接 tool_call_result error", async () => {
    const { ws, session, loop, mockDriver, actionHub } = await setup();

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      // 幻觉入参：缺少必填 command，且编造了 schema 不支持的 timeout 字段名
      { id: "call-bad-1", name: "bash_run", arguments: { timeout: "10s" } },
      "review",
      () => {
        throw new Error("非法入参不应触发 HITL 挂起");
      }
    );

    // 核心断言①：全程无审批卡（不占人工注意力）
    expect(events.some((e) => e.type === "suspended")).toBe(false);
    expect(events.some((e) => e.type === "resumed")).toBe(false);
    expect(actionHub.listSuspended()).toHaveLength(0);

    // 核心断言②：直接走 isError 路径，错误文案指导模型修参
    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("参数校验失败");
    expect(result.error).toContain("command");

    // turn 正常收敛（错误回喂模型后 ReAct 继续，第二幕文本收尾）
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  it("review × bash_run 非法入参：不产生审批卡（持久化 turn.cards 无 approval 卡）", async () => {
    const { ws, session, loop, mockDriver, sessionRepo } = await setup();

    await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-bad-2", name: "bash_run", arguments: {} },
      "review"
    );

    const detail = await sessionRepo.get(session.id);
    const turn = detail!.turns[detail!.turns.length - 1];
    const cards = (turn.cards ?? []) as Array<{ id: string; type: string }>;
    // 调用链卡照常落（审计轨迹），审批卡不存在
    expect(cards.some((c) => c.type === "approval")).toBe(false);
    expect(cards.some((c) => c.id === "call-call-bad-2" && c.type === "toolcall")).toBe(true);
  });

  it("review × fs_write（免审批工具）非法入参：同样前置拦截，无 suspended", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup();

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      // content 应为 string，幻觉成 number
      { id: "call-bad-3", name: "fs_write", arguments: { filePath: "x.txt", content: 42 } },
      "review"
    );

    expect(events.some((e) => e.type === "suspended")).toBe(false);
    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("参数校验失败");
    // 副作用断言：文件不落盘
    await expect(fs.access(path.join(dir, "x.txt"))).rejects.toThrow();
  });

  it("auto × bash_run 非法入参：error 路径与改动前一致（无挂起、文案相同）", async () => {
    const { ws, session, loop, mockDriver } = await setup();

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-bad-4", name: "bash_run", arguments: {} },
      "auto"
    );

    expect(events.some((e) => e.type === "suspended")).toBe(false);
    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("参数校验失败");
  });

  it("对照组 review × bash_run 合法入参：审批流不回退（suspended → 批准 → done）", async () => {
    const { ws, session, loop, mockDriver, actionHub } = await setup();

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-ok-1", name: "bash_run", arguments: { command: "echo gate-ok" } },
      "review",
      (actionId) => {
        expect(actionHub.getSuspended(actionId)).toBeDefined();
        actionHub.resolveAction(actionId, { approved: true, note: "通过" });
      }
    );

    expect(events.some((e) => e.type === "suspended")).toBe(true);
    expect(events.some((e) => e.type === "resumed")).toBe(true);
    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect((result.data as any).stdout).toContain("gate-ok");
  });
});

describe("ToolRegistry.validateParams 单元契约", () => {
  function makeRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    const strict: HarnessTool = {
      name: "strict_probe",
      description: "严格 schema 假工具",
      parameters: Type.Object({ x: Type.Number() }),
      execute: async () => "ok",
    };
    const legacy: HarnessTool = {
      name: "legacy_probe",
      description: "旧式 JSON-Schema 纯对象参数",
      parameters: { type: "object", properties: {} },
      execute: async () => "ok",
    };
    registry.register(strict).register(legacy);
    return registry;
  }

  it("合法入参 → ok:true", () => {
    const registry = makeRegistry();
    expect(registry.validateParams("strict_probe", { x: 1 })).toEqual({ ok: true });
  });

  it("非法入参 → ok:false 且文案与 execute 闸门一致", () => {
    const registry = makeRegistry();
    const res = registry.validateParams("strict_probe", { x: "not-a-number" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("参数校验失败");
    expect(res.error).toContain("x");
  });

  it("非 TypeBox parameters（纯对象）→ ok:true（向后兼容放行）", () => {
    const registry = makeRegistry();
    expect(registry.validateParams("legacy_probe", { anything: true })).toEqual({ ok: true });
  });

  it("未注册工具 → ok:false（与 execute 的 not-registered 文案一致）", () => {
    const registry = makeRegistry();
    const res = registry.validateParams("ghost_tool", {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not registered");
  });
});
