import { describe, it, expect } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";
import { COMPACT_SUMMARY_MARKER } from "../src/core/context-compactor.js";

/**
 * 捕获型 MockDriver：记录每次 generateStream 收到的完整 messages，
 * 用于断言压缩后下一轮真实发送给模型的上下文（无 1214 类非法消息）。
 * instanceof 检查已移除：显式注入的驱动会被 agent-loop 直接信任（沙箱演示分支不会劫持）。
 */
class CapturingMockDriver extends MockDriver {
  captured: ModelDriverRequest["messages"][] = [];
  override async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    this.captured.push(req.messages);
    yield* super.generateStream(req);
  }
}

/** 发起一轮 chat 并抽干 SSE 流（MockDriver 确定性输出，直接消费完即本轮落库完成） */
async function drainChat(app: ReturnType<typeof createHarnessServer>["app"], body: Record<string, unknown>) {
  const res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return await res.text();
}

describe("POST /api/sessions/:id/compact 手动压缩 (TASK-008)", () => {
  async function setupWithHistory(turnCount: number) {
    const modelDriver = new CapturingMockDriver();
    const harness = createHarnessServer({ dbPath: ":memory:", modelDriver });
    const { app } = harness;

    // 建工作区 + 会话
    const wsRes = await app.request("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "WS", rootPath: "/tmp/ws", permission: "read-write" }),
    });
    const ws = (await wsRes.json()) as { id: string };
    const sessRes = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, title: "长会话" }),
    });
    const session = (await sessRes.json()) as { id: string };

    // 逐轮灌入长历史（每轮 prompt/answer 足够长，压缩收益显著）
    for (let i = 1; i <= turnCount; i++) {
      modelDriver.setScript({
        steps: [[{ type: "text", text: `这是第 ${i} 轮任务的完整回答：${"细节".repeat(120)}` }]],
      });
      await drainChat(app, {
        sessionId: session.id,
        workspaceId: ws.id,
        prompt: `提问 ${i}：${"背景说明".repeat(100)}`,
      });
    }

    return { ...harness, app, ws, session, modelDriver };
  }

  it("长会话压缩:占用断崖回落,compaction checkpoint 落库,仪表口径刷新", async () => {
    const { app, session } = await setupWithHistory(5);

    // keepTokens=2000:尾部 4 块共 1864≤2000,纳入第 5 块累计 2330>2000 → 折叠第 1 轮
    const compactRes = await app.request(`/api/sessions/${session.id}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepTokens: 2000 }),
    });
    expect(compactRes.status).toBe(200);
    const result = (await compactRes.json()) as {
      success: boolean;
      compacted: boolean;
      checkpointId: string;
      beforeTokens: number;
      afterTokens: number;
      freed: number;
      totalTokens: number;
      compactedTurnCount: number;
      parts: Array<{ kind: string; tokens: number }>;
    };

    expect(result.success).toBe(true);
    expect(result.compacted).toBe(true);
    // keepTokens=2000 保留 4 轮 → 折叠 1 轮(按 token 预算,行业 keep.tokens 口径)
    expect(result.compactedTurnCount).toBe(1);
    expect(result.beforeTokens).toBeGreaterThan(result.afterTokens);
    expect(result.freed).toBe(result.beforeTokens - result.afterTokens);
    expect(result.totalTokens).toBe(result.afterTokens);
    expect(result.parts.length).toBeGreaterThan(0);
    expect(result.checkpointId).toMatch(/^cp-compact-/);

    // 压缩记录落库:compaction 元数据 + compaction checkpoint + 仪表水合口径刷新
    const detailRes = await app.request(`/api/sessions/${session.id}`);
    const detail = (await detailRes.json()) as {
      compaction: { compactedTurnCount: number; checkpointId: string; afterTokens: number; summary: string };
      turns: Array<{
        id: string;
        telemetry?: { contextTokens?: number };
        checkpoints: Array<{ id: string; messagesSnapshot: Array<{ role: string; content?: string }> }>;
      }>;
    };
    expect(detail.compaction).toBeDefined();
    expect(detail.compaction.compactedTurnCount).toBe(1);
    expect(detail.compaction.checkpointId).toBe(result.checkpointId);
    expect(detail.compaction.summary.startsWith(COMPACT_SUMMARY_MARKER)).toBe(true);

    const lastTurn = detail.turns[detail.turns.length - 1];
    // 刷新页面后占用显示压缩后的值（selectSession 按 telemetry.contextTokens 水合）
    expect(lastTurn.telemetry?.contextTokens).toBe(result.afterTokens);
    // compaction checkpoint 挂在最近带快照的轮次上,快照 = system + 摘要占位 + 最近轮次
    const compactCp = lastTurn.checkpoints.find((cp) => cp.id === result.checkpointId);
    expect(compactCp).toBeDefined();
    expect(compactCp!.messagesSnapshot[0].role).toBe("system");
    expect(compactCp!.messagesSnapshot[1].role).toBe("user");
    expect(compactCp!.messagesSnapshot[1].content?.startsWith(COMPACT_SUMMARY_MARKER)).toBe(true);
  });

  it("压缩后再追问:模型收到摘要占位而非被折叠轮次原文,消息序列合法", async () => {
    const { app, session, ws, modelDriver } = await setupWithHistory(5);

    await app.request(`/api/sessions/${session.id}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepTokens: 2000 }),
    });

    // 压缩后的下一轮:断言实际发送给模型的上下文
    modelDriver.setScript({ steps: [[{ type: "text", text: "收到，继续处理。" }]] });
    await drainChat(app, {
      sessionId: session.id,
      workspaceId: ws.id,
      prompt: "提问 6：继续",
    });

    const messages = modelDriver.captured[modelDriver.captured.length - 1];
    expect(messages[0].role).toBe("system");
    // 摘要占位消息紧随 system
    expect(messages[1].role).toBe("user");
    expect(String(messages[1].content ?? "").startsWith(COMPACT_SUMMARY_MARKER)).toBe(true);
    const joined = messages.map((m) => m.content || "").join("\n");
    // 被折叠轮次(第 1 轮)的完整原文不再进入上下文(摘要行只保留前 120 字符)
    expect(joined).not.toContain(`提问 1：${"背景说明".repeat(100)}`);
    expect(joined).not.toContain(`这是第 1 轮任务的完整回答：${"细节".repeat(120)}`);
    // 未折叠轮次的完整原文照常保留
    expect(joined).toContain(`提问 2：${"背景说明".repeat(100)}`);
    expect(joined).toContain(`提问 5：${"背景说明".repeat(100)}`);
    // 无孤儿 tool / 空 content(供应商严格校验口径)
    const declared = new Set<string>();
    for (const m of messages) {
      if (m.role === "assistant" && m.tool_calls) for (const tc of m.tool_calls) declared.add(tc.id);
      if (m.role === "tool") expect(declared.has(m.tool_call_id!)).toBe(true);
    }
  });

  it("空会话压缩返回 400 NO_HISTORY", async () => {
    const { app, ws } = await setupWithHistory(0);
    const sessRes = await app.request("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: ws.id, title: "空会话" }),
    });
    const session = (await sessRes.json()) as { id: string };

    const res = await app.request(`/api/sessions/${session.id}/compact`, { method: "POST" });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("NO_HISTORY");
  });

  it("会话执行中压缩返回 409 SESSION_RUNNING,轮次结束后可正常压缩", async () => {
    const { app, session, ws, modelDriver } = await setupWithHistory(2);

    // 发起一轮会挂起等审批的执行（bash_run 高危工具 + review 模式）
    modelDriver.setScript({
      steps: [[{ type: "tool_call", id: "call-busy-1", name: "bash_run", arguments: { command: "echo hi" } }]],
    });
    const streaming = app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        workspaceId: ws.id,
        prompt: "执行一条命令",
        permission: "review",
      }),
    });

    // 等待 HITL 挂起出现
    let actionId = "";
    for (let i = 0; i < 40; i++) {
      const suspendedRes = await app.request("/api/action/suspended");
      const list = (await suspendedRes.json()) as Array<{ actionId: string }>;
      if (list.length > 0) {
        actionId = list[0].actionId;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(actionId).toBeTruthy();

    // 执行中压缩被拒
    const busyRes = await app.request(`/api/sessions/${session.id}/compact`, { method: "POST" });
    expect(busyRes.status).toBe(409);
    const busyJson = (await busyRes.json()) as { code: string };
    expect(busyJson.code).toBe("SESSION_RUNNING");

    // 驳回审批让轮次收尾落库
    await app.request(`/api/action/${actionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: false, note: "测试驳回" }),
    });
    const text = await (await streaming).text();
    expect(text).toContain("turn_end");

    // 结束后压缩恢复正常
    // keepTokens=2000:尾部 4 块共 1864≤2000,纳入第 5 块累计 2330>2000 → 折叠第 1 轮
    const compactRes = await app.request(`/api/sessions/${session.id}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepTokens: 2000 }),
    });
    expect(compactRes.status).toBe(200);
    const result = (await compactRes.json()) as { success: boolean };
    expect(result.success).toBe(true);
  });

  it("历史不足以折叠时返回 compacted:false 与原占用", async () => {
    // 2 轮 < 默认保留 4 轮 → 无可折叠轮次
    const { app, session } = await setupWithHistory(2);
    const res = await app.request(`/api/sessions/${session.id}/compact`, { method: "POST" });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      compacted: boolean;
      freed: number;
      beforeTokens: number;
      afterTokens: number;
    };
    expect(result.compacted).toBe(false);
    expect(result.freed).toBe(0);
    expect(result.afterTokens).toBe(result.beforeTokens);
  });

  it("沙箱演示轮次(无 API Key)的 checkpoint 快照含 assistant 回复，历史可完整重建", async () => {
    // 演示分支条件：未注入模型驱动且无任何 API Key——测试期间摘除环境变量兜底凭据
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      // 未注入模型驱动 + 无 API Key → 沙箱演示分支（不触达任何真实模型驱动）
      const { app, sessionRepo } = createHarnessServer({ dbPath: ":memory:" });

      const wsRes = await app.request("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Demo WS", rootPath: "/tmp/demo-ws", permission: "read-write" }),
      });
      const ws = (await wsRes.json()) as { id: string };
      const sessRes = await app.request("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, title: "演示会话" }),
      });
      const session = (await sessRes.json()) as { id: string };

      await drainChat(app, {
        sessionId: session.id,
        workspaceId: ws.id,
        prompt: "演示提问：快照应含回复",
      });

      const stored = await sessionRepo.get(session.id);
      expect(stored?.turns).toHaveLength(1);
      const cp = stored!.turns[0].checkpoints[0];
      expect(cp).toBeDefined();
      const snapshot = cp.messagesSnapshot as Array<{ role: string; content?: string }>;
      const last = snapshot[snapshot.length - 1];
      // 快照末尾是本轮 assistant 演示回复（而非止步于 user 提问）
      expect(last.role).toBe("assistant");
      expect(last.content).toContain("演示提问：快照应含回复");
    } finally {
      if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    }
  });
});
