import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { resolveLivePermissionMode } from "../src/core/permissions.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import { FsReadTool, FsWriteTool } from "../src/tools/system/fs-tools.js";
import { BashRunTool } from "../src/tools/system/bash-tool.js";
import { UIMetricChartTool } from "../src/tools/ui/protocol-tools.js";
import type { WorkspaceEntity, SessionEntity } from "../src/storage/interfaces.js";
import type { HarnessStreamEvent, HarnessTool } from "../src/core/types.js";

/**
 * TASK-012 权限矩阵回归（评审 P0-2 修复）
 *
 * 权限仲裁语义：
 * ① read-only 模式：按 HarnessTool.writesWorkspace 声明式元数据拦截（旧字符串黑名单已删除），
 *    修复 fs_write 不在 "write_file/edit_file/..." 黑名单导致的只读静默写绕过；
 * ② review 模式：requiresApproval/riskLevel 判定维持不变（HITL 挂起）；
 * ③ auto 模式：跳过审批，但 read-only 工作区硬闸门依然拦截写工具；
 * ④ 请求级 req.permission 与会话级 session.permission 取交集，更严者生效。
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("权限矩阵（auto/review/read-only × fs_read/fs_write/bash_run/ui_metric_chart）", () => {
  /** 全部内置工具的元数据契约：写工具必须显式声明 writesWorkspace=true */
  it("tool metadata contract: fs_write/bash_run=true, fs_read/ui_metric_chart=false", () => {
    expect(FsWriteTool.writesWorkspace).toBe(true);
    expect(BashRunTool.writesWorkspace).toBe(true);
    expect(FsReadTool.writesWorkspace).toBe(false);
    expect(UIMetricChartTool.writesWorkspace).toBe(false);
  });

  interface SetupOptions {
    workspacePermission: "read-only" | "read-write" | "danger";
    sessionPermission?: string;
  }

  async function setup(opts: SetupOptions) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vuagent-perm-"));
    tmpDirs.push(dir);

    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const toolRegistry = new ToolRegistry();
    const actionHub = new ActionHub();
    const mockDriver = new MockDriver();

    const ws = await workspaceRepo.create({
      name: "Perm Workspace",
      rootPath: dir,
      permission: opts.workspacePermission,
    });
    const session = await sessionRepo.create({
      workspaceId: ws.id,
      title: "Perm Session",
      permission: opts.sessionPermission,
    });
    await settingsRepo.createProfile({
      id: "test-model",
      name: "Test Model",
      provider: "openai",
      model: "test-mock-model",
      isDefault: true,
    });

    // 注册真实内置工具，让 writesWorkspace 元数据真正参与仲裁
    const tools: HarnessTool[] = [FsReadTool, FsWriteTool, BashRunTool, UIMetricChartTool];
    for (const t of tools) toolRegistry.register(t);

    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry,
      actionHub,
      modelDriver: mockDriver,
    });

    return { ws, session, loop, mockDriver, actionHub, sessionRepo, dir };
  }

  /** 驱动一次单工具调用的 turn，返回完整事件流 */
  async function runToolTurn(
    loop: AgentLoop,
    mockDriver: MockDriver,
    ws: WorkspaceEntity,
    session: SessionEntity,
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    permission?: "auto" | "review" | "read-only" | "readonly",
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

  // ─────────────── read-only 模式 ───────────────

  it("read-only × fs_write: 拦截写操作（修复 P0-2 绕过），文件不得落盘", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-w-1", name: "fs_write", arguments: { filePath: "leak.txt", content: "should not exist" } },
      "read-only"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("只读模式限制");
    expect(result.error).toContain("fs_write");

    // 无 HITL 挂起（直接拦截，而非挂起等审批）
    expect(events.some((e) => e.type === "suspended")).toBe(false);

    // 关键副作用断言：文件确实没有写入磁盘
    await expect(fs.access(path.join(dir, "leak.txt"))).rejects.toThrow();

    // turn 正常收敛
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  it("read-only × bash_run: 仍拦截，且不进入 HITL 挂起", async () => {
    const { ws, session, loop, mockDriver } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-b-1", name: "bash_run", arguments: { command: "echo pwned > pwned.txt" } },
      "read-only"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("只读模式限制");
    expect(result.error).toContain("bash_run");
    expect(events.some((e) => e.type === "suspended")).toBe(false);
    expect(events.some((e) => e.type === "turn_end")).toBe(true);
  });

  it("read-only × fs_read: 放行", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({ workspacePermission: "read-write" });
    await fs.writeFile(path.join(dir, "note.txt"), "hello perm", "utf-8");

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-r-1", name: "fs_read", arguments: { filePath: "note.txt" } },
      "read-only"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect((result.data as any).content).toBe("hello perm");
  });

  it("read-only × ui_metric_chart: 契约渲染工具放行", async () => {
    const { ws, session, loop, mockDriver } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-u-1", name: "ui_metric_chart", arguments: { title: "t", chartType: "bar", series: [] } },
      "read-only"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect((result.data as any).rendered).toBe(true);
  });

  it("read-only 别名 readonly × fs_write: 同样拦截", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-w-2", name: "fs_write", arguments: { filePath: "alias.txt", content: "x" } },
      "readonly"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("只读模式限制");
    await expect(fs.access(path.join(dir, "alias.txt"))).rejects.toThrow();
  });

  // ─────────────── auto 模式 ───────────────

  it("auto × fs_write (read-write 工作区): 免审批直接落盘", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-w-3", name: "fs_write", arguments: { filePath: "auto.txt", content: "auto-written" } },
      "auto"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect(events.some((e) => e.type === "suspended")).toBe(false);
    expect(await fs.readFile(path.join(dir, "auto.txt"), "utf-8")).toBe("auto-written");
  });

  it("auto × bash_run (read-write 工作区): 免审批直接执行", async () => {
    const { ws, session, loop, mockDriver } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-b-2", name: "bash_run", arguments: { command: "echo vuagent-ok" } },
      "auto"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect((result.data as any).stdout).toContain("vuagent-ok");
    expect(events.some((e) => e.type === "suspended")).toBe(false);
  });

  it("auto × fs_write (read-only 工作区): 工作区硬闸门依然拦截，文件不落盘", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({ workspacePermission: "read-only" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-w-4", name: "fs_write", arguments: { filePath: "blocked.txt", content: "nope" } },
      "auto"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("工作区权限限制");
    expect(events.some((e) => e.type === "suspended")).toBe(false);
    await expect(fs.access(path.join(dir, "blocked.txt"))).rejects.toThrow();
  });

  // ─────────────── review 模式（审批流回归不变）───────────────

  it("review × fs_write: requiresApproval=false 直接执行（维持现状）", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-w-5", name: "fs_write", arguments: { filePath: "review.txt", content: "review-ok" } },
      "review"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect(events.some((e) => e.type === "suspended")).toBe(false);
    expect(await fs.readFile(path.join(dir, "review.txt"), "utf-8")).toBe("review-ok");
  });

  it("review × bash_run: HITL 挂起 → 批准后执行", async () => {
    const { ws, session, loop, mockDriver, actionHub } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-b-3", name: "bash_run", arguments: { command: "echo approved-run" } },
      "review",
      (actionId) => {
        expect(actionHub.getSuspended(actionId)).toBeDefined();
        actionHub.resolveAction(actionId, { approved: true, note: "通过审批" });
      }
    );

    expect(events.some((e) => e.type === "suspended")).toBe(true);
    expect(events.some((e) => e.type === "resumed")).toBe(true);
    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect((result.data as any).stdout).toContain("approved-run");
  });

  it("review × bash_run: HITL 挂起 → 驳回后走 errorMessage 通道", async () => {
    const { ws, session, loop, mockDriver, actionHub } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-b-4", name: "bash_run", arguments: { command: "echo denied-run" } },
      "review",
      (actionId) => {
        actionHub.resolveAction(actionId, { approved: false, note: "不允许执行该命令" });
      }
    );

    expect(events.some((e) => e.type === "suspended")).toBe(true);
    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("操作被用户驳回");
    expect((result.data as any).approved).toBe(false);
  });

  it("review × ui_metric_chart: 低风险契约工具直接放行", async () => {
    const { ws, session, loop, mockDriver } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-u-2", name: "ui_metric_chart", arguments: { title: "m", chartType: "line", series: [] } },
      "review"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect(events.some((e) => e.type === "suspended")).toBe(false);
  });

  it("review（缺省 permission）× bash_run: 默认进入 review 审批", async () => {
    const { ws, session, loop, mockDriver, actionHub } = await setup({ workspacePermission: "read-write" });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-b-5", name: "bash_run", arguments: { command: "echo default-review" } },
      undefined,
      (actionId) => {
        // 缺省 permission 必须等价于 review：出现挂起即证明。
        // 及时批准以收敛 turn（ActionHub 默认 180s 超时，不 resolve 会导致用例挂死）
        actionHub.resolveAction(actionId, { approved: true, note: "默认审批通过" });
      }
    );

    expect(events.some((e) => e.type === "suspended")).toBe(true);
    expect(events.some((e) => e.type === "resumed")).toBe(true);
    expect(getResultEvent(events).status).toBe("done");
  });

  // ─────────────── 请求级 × 会话级权限交集（更严者生效）───────────────

  it("交集: req=auto + session=readonly → fs_write 拦截（会话更严生效）", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({
      workspacePermission: "read-write",
      sessionPermission: "readonly",
    });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-i-1", name: "fs_write", arguments: { filePath: "i1.txt", content: "x" } },
      "auto"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    expect(result.error).toContain("只读模式限制");
    await expect(fs.access(path.join(dir, "i1.txt"))).rejects.toThrow();
  });

  it("交集: req=read-only + session=auto → fs_write 拦截（请求更严生效）", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({
      workspacePermission: "read-write",
      sessionPermission: "auto",
    });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-i-2", name: "fs_write", arguments: { filePath: "i2.txt", content: "x" } },
      "read-only"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("error");
    await expect(fs.access(path.join(dir, "i2.txt"))).rejects.toThrow();
  });

  it("交集: req=auto + session=auto (read-write 工作区) → fs_write 放行", async () => {
    const { ws, session, loop, mockDriver, dir } = await setup({
      workspacePermission: "read-write",
      sessionPermission: "auto",
    });

    const events = await runToolTurn(
      loop,
      mockDriver,
      ws,
      session,
      { id: "call-i-3", name: "fs_write", arguments: { filePath: "i3.txt", content: "ok" } },
      "auto"
    );

    const result = getResultEvent(events);
    expect(result.status).toBe("done");
    expect(await fs.readFile(path.join(dir, "i3.txt"), "utf-8")).toBe("ok");
  });

  // ─────────────── 运行中改档（用户反馈：输出进行中改权限模式，当前轮次要能感知） ───────────────

  it("review 轮次中途收紧为 read-only → 第二个写工具被拦截", async () => {
    const { ws, session, loop, mockDriver, sessionRepo, dir } = await setup({
      workspacePermission: "read-write",
      sessionPermission: "review",
    });

    mockDriver.setScript({
      steps: [
        [{ type: "tool_call", id: "c1", name: "fs_write", arguments: { filePath: "before.txt", content: "ok" } }],
        [{ type: "tool_call", id: "c2", name: "fs_write", arguments: { filePath: "after.txt", content: "no" } }],
        [{ type: "text", text: "turn finished" }],
      ],
    });

    const events: HarnessStreamEvent[] = [];
    let tightened = false;
    for await (const evt of loop.runTurn({
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "连跑两个写工具",
      permission: "review",
    })) {
      events.push(evt);
      // 第一个工具出结果后模拟用户在界面改档（UI 即 PATCH 会话，与前端 onSelectPermission 同构）
      if (evt.type === "tool_call_result" && !tightened) {
        tightened = true;
        await sessionRepo.update(session.id, { permission: "read-only" });
      }
    }

    expect(tightened).toBe(true);
    const results = events.filter((e) => e.type === "tool_call_result") as Extract<
      HarnessStreamEvent,
      { type: "tool_call_result" }
    >[];
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("done");
    expect(await fs.readFile(path.join(dir, "before.txt"), "utf-8")).toBe("ok");
    // 改档后的第二个写调用被只读闸门拦截
    expect(results[1].status).toBe("error");
    expect(results[1].error).toContain("只读模式限制");
    expect(await fs.readFile(path.join(dir, "after.txt"), "utf-8").then(() => true, () => false)).toBe(false);
  });

  it("review 轮次中途放宽为 auto → 高风险工具不再挂起审批，直接执行", async () => {
    const { ws, session, loop, mockDriver, sessionRepo } = await setup({
      workspacePermission: "read-write",
      sessionPermission: "review",
    });

    mockDriver.setScript({
      steps: [
        [{ type: "tool_call", id: "c1", name: "fs_read", arguments: { filePath: "a.txt" } }],
        [{ type: "tool_call", id: "c2", name: "bash_run", arguments: { command: "echo mid-run-ok" } }],
        [{ type: "text", text: "turn finished" }],
      ],
    });

    const events: HarnessStreamEvent[] = [];
    let loosened = false;
    for await (const evt of loop.runTurn({
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "跑一个高风险工具",
      permission: "review",
    })) {
      events.push(evt);
      if (evt.type === "tool_call_result" && !loosened) {
        loosened = true;
        await sessionRepo.update(session.id, { permission: "auto" });
      }
    }

    expect(loosened).toBe(true);
    // 放宽前若仍是 review，bash_run（high + requiresApproval）必然挂起；
    // 放宽后整个轮次不应出现 suspended，第二个调用直接执行完成
    expect(events.some((e) => e.type === "suspended")).toBe(false);
    const results = events.filter((e) => e.type === "tool_call_result") as Extract<
      HarnessStreamEvent,
      { type: "tool_call_result" }
    >[];
    const bashResult = results.find((r) => r.toolCallId === "c2");
    expect(bashResult?.status).toBe("done");
  });
});

/* ==========================================================================
   运行中改档：resolveLivePermissionMode 纯函数矩阵
   （集成用例见上方权限矩阵 describe 内的「运行中改档」段落）
   ========================================================================== */
describe("运行中改档 resolveLivePermissionMode", () => {
  it("纯函数：会话档未变化 → 维持轮次起点解析", () => {
    expect(resolveLivePermissionMode("review", "review", "review")).toBe("review");
    expect(resolveLivePermissionMode("read-only", undefined, undefined)).toBe("read-only");
    expect(resolveLivePermissionMode("auto", " auto ", "auto")).toBe("auto");
  });

  it("纯函数：会话档变化 → 以最新会话档为准（收紧与放宽都生效，别名兼容）", () => {
    expect(resolveLivePermissionMode("review", "review", "read-only")).toBe("read-only");
    expect(resolveLivePermissionMode("review", "review", "auto")).toBe("auto");
    expect(resolveLivePermissionMode("review", "review", "readonly")).toBe("read-only");
    // 改档后清空会话档 → 回落请求级缺省 review 语义（安全降级）
    expect(resolveLivePermissionMode("auto", "auto", undefined)).toBe("review");
  });
});
