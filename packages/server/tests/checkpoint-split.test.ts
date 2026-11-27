/**
 * W2 checkpoint 拆行端到端回归（T07–T10 集成）：
 * split 模式（服务默认构造 checkpointsRepo）下——
 * - 快照落独立集合，turn 行只剩元数据（详情接口自然瘦身）；
 * - S-based 历史重放：新轮次的模型上下文包含此前轮次的提问与回复；
 * - 新端点：turn checkpoints 元数据列表 / 单条详情（?snapshot=1 显式取大对象）；
 * - 详情响应体积硬门槛 < 1MB（fixture 8 轮）。
 */
import { describe, it, expect } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { MockDriver } from "./helpers/mock-driver.js";
import type { ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";

class CapturingMockDriver extends MockDriver {
  captured: ModelDriverRequest["messages"][] = [];
  override async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    this.captured.push(req.messages);
    yield* super.generateStream(req);
  }
}

async function drainChat(app: ReturnType<typeof createHarnessServer>["app"], body: Record<string, unknown>) {
  const res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return await res.text();
}

async function setup(turnCount: number) {
  const modelDriver = new CapturingMockDriver();
  const harness = createHarnessServer({ dbPath: ":memory:", modelDriver });
  const { app } = harness;

  const wsRes = await app.request("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "WS", rootPath: "/tmp/ws", permission: "read-write" }),
  });
  const ws = (await wsRes.json()) as { id: string };
  const sessRes = await app.request("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: ws.id, title: "拆行回归" }),
  });
  const session = (await sessRes.json()) as { id: string };

  for (let i = 1; i <= turnCount; i++) {
    modelDriver.setScript({
      steps: [[{ type: "text", text: `第 ${i} 轮回答：${"内容".repeat(80)}` }]],
    });
    await drainChat(app, { sessionId: session.id, workspaceId: ws.id, prompt: `提问 ${i}` });
  }
  return { ...harness, app, ws, session, modelDriver };
}

describe("W2 checkpoint 拆行（split 模式端到端）", () => {
  it("快照落独立集合：详情里 turn.checkpoints 是元数据（无快照），详情体积亚 MB", async () => {
    const { app, session } = await setup(3);

    const res = await app.request(`/api/sessions/${session.id}`);
    expect(res.status).toBe(200);
    const bodyText = await res.text();
    const detail = JSON.parse(bodyText) as {
      turns: Array<{
        id: string;
        checkpoints: Array<{ id: string; turnId: string; stepIndex: number; snapshotAt: number; messagesSnapshot?: unknown }>;
        checkpointCount?: number;
        checkpointsSplit?: boolean;
      }>;
    };

    // 体积硬门槛（36.7MB → 亚 MB 量级）
    expect(bodyText.length).toBeLessThan(1024 * 1024);

    for (const turn of detail.turns) {
      expect(turn.checkpoints.length).toBeGreaterThan(0);
      expect(turn.checkpointsSplit).toBe(true);
      expect(turn.checkpointCount).toBe(turn.checkpoints.length);
      // 元数据语义：无快照大对象
      for (const cp of turn.checkpoints) {
        expect(cp.messagesSnapshot).toBeUndefined();
        expect(cp.turnId).toBe(turn.id);
      }
    }
    // 每轮 1 步 1 checkpoint（纯文本完成步也落 cp，TASK-008）
    expect(detail.turns.every((t) => t.checkpoints.length === 1)).toBe(true);
  });

  it("S-based 历史重放：第 3 轮的模型上下文含第 1/2 轮的提问与回复", async () => {
    const { app, ws, session, modelDriver } = await setup(2);

    modelDriver.setScript({ steps: [[{ type: "text", text: "第三轮回答" }]] });
    await drainChat(app, { sessionId: session.id, workspaceId: ws.id, prompt: "提问 3" });

    const messages = modelDriver.captured[modelDriver.captured.length - 1] as Array<{
      role: string;
      content: unknown;
    }>;
    const text = JSON.stringify(messages);
    // 此前轮次的提问与回复都在上下文里（单快照重放的正确性核心）
    expect(text).toContain("提问 1");
    expect(text).toContain("第 1 轮回答");
    expect(text).toContain("提问 2");
    expect(text).toContain("第 2 轮回答");
    expect(text).toContain("提问 3");
    // system 只有一条（快照里的 system 不重复带出）
    expect(messages.filter((m) => m.role === "system")).toHaveLength(1);
    // 轮次提问不重复（快照里的 user 锚点被替换为带注记的 turn prompt，不双发）
    expect(text.split("提问 1").length - 1).toBe(1);
  });

  it("新端点：turn checkpoints 元数据列表（倒序分页）+ 单条详情 snapshot 显式取", async () => {
    const { app, session } = await setup(2);
    const detail = (await (
      await app.request(`/api/sessions/${session.id}`)
    ).json()) as { turns: Array<{ id: string; checkpoints: Array<{ id: string }> }> };

    const firstTurn = detail.turns[0];
    const listRes = await app.request(`/api/sessions/${session.id}/turns/${firstTurn.id}/checkpoints`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      turnId: string;
      total: number;
      checkpoints: Array<{ id: string; turnId: string; snapshotAt: number }>;
    };
    expect(list.turnId).toBe(firstTurn.id);
    expect(list.total).toBe(1);
    expect(list.checkpoints[0].turnId).toBe(firstTurn.id);
    // 元数据不含快照
    expect(list.checkpoints[0]).not.toHaveProperty("messagesSnapshot");

    const cpId = list.checkpoints[0].id;
    // 默认只元数据
    const metaRes = await app.request(`/api/sessions/${session.id}/checkpoints/${cpId}`);
    expect(metaRes.status).toBe(200);
    const meta = (await metaRes.json()) as { id: string; messagesSnapshot?: unknown };
    expect(meta.id).toBe(cpId);
    expect(meta.messagesSnapshot).toBeUndefined();

    // ?snapshot=1 显式取大对象
    const fullRes = await app.request(`/api/sessions/${session.id}/checkpoints/${cpId}?snapshot=1`);
    expect(fullRes.status).toBe(200);
    const full = (await fullRes.json()) as { messagesSnapshot: Array<{ role: string }> };
    expect(Array.isArray(full.messagesSnapshot)).toBe(true);
    expect(full.messagesSnapshot.some((m) => m.role === "assistant")).toBe(true);

    // 不存在的 cpId → 404 JSON
    const miss = await app.request(`/api/sessions/${session.id}/checkpoints/nope`);
    expect(miss.status).toBe(404);
  });

  it("inline 回退开关：VUAGENT_CHECKPOINT_STORE=inline 时快照随 turn 行（旧行为）", async () => {
    const saved = process.env.VUAGENT_CHECKPOINT_STORE;
    process.env.VUAGENT_CHECKPOINT_STORE = "inline";
    try {
      const { app, session } = await setup(1);
      const detail = (await (
        await app.request(`/api/sessions/${session.id}`)
      ).json()) as {
        turns: Array<{ checkpoints: Array<{ messagesSnapshot?: unknown }>; checkpointsSplit?: boolean }>;
      };
      // 旧行为：快照内联 turn 行，无拆行标记
      expect(detail.turns[0].checkpoints[0].messagesSnapshot).toBeDefined();
      expect(detail.turns[0].checkpointsSplit).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.VUAGENT_CHECKPOINT_STORE;
      else process.env.VUAGENT_CHECKPOINT_STORE = saved;
    }
  });
});
