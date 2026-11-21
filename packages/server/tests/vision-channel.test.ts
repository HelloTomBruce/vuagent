/**
 * 能力运行时 P2：视觉通道
 *
 * 覆盖链路：
 *   1. 路由结构校验（张数/大小/类型白名单）与能力门禁（未声明图片 → 400 带指引）
 *   2. agent-loop 组装：本轮 user 消息升级为 content parts（OpenAI 规范形态）
 *   3. Anthropic 映射：image_url(data URL) → image base64 source 块
 *   4. 压缩器：parts 消息参与预算（图片按估值）且不崩
 */
import { describe, it, expect } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { mapOpenAIMessagesToAnthropic } from "../src/adapters/anthropic-driver.js";
import { ContextCompactor, IMAGE_TOKEN_ESTIMATE, type ChatMessage } from "../src/core/context-compactor.js";
import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const JSON_HEADERS = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

const PNG_B64 = "aVR0eE1n"; // 任意合法 base64 片段（不解码验证图片真实性）

class CapturingDriver implements IModelDriver {
  readonly requests: ModelDriverRequest[] = [];
  async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(req);
    yield { type: "text_delta", text: "ok" };
    yield { type: "done" };
  }
}

describe("视觉通道：路由校验与能力门禁", () => {
  function makeApp() {
    return createHarnessServer({ dbPath: ":memory:" }).app;
  }

  async function postChat(app: ReturnType<typeof makeApp>, body: Record<string, unknown>) {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ prompt: "看图", ...body }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  it("未声明图片能力的模型 → 400 带指引文案", async () => {
    const app = makeApp();
    const { status, json } = await postChat(app, { images: [{ name: "a.png", mediaType: "image/png", data: PNG_B64 }] });
    expect(status).toBe(400);
    expect(json.code).toBe("IMAGE_INPUT_REJECTED");
    expect(json.error).toContain("能力标记");
  });

  it("结构校验：超张数 / 非法类型 / 缺数据 / 超大小 → 400", async () => {
    const app = makeApp();
    // 5 张（上限 4）
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.png`, mediaType: "image/png", data: PNG_B64 }));
    expect((await postChat(app, { images: five })).status).toBe(400);
    // 非法 mediaType
    expect(
      (await postChat(app, { images: [{ name: "x", mediaType: "image/bmp", data: PNG_B64 }] })).status
    ).toBe(400);
    // 缺 data
    expect(
      (await postChat(app, { images: [{ name: "x", mediaType: "image/png", data: "" }] })).status
    ).toBe(400);
    // 畸形 base64（含非法字符）
    expect(
      (await postChat(app, { images: [{ name: "x", mediaType: "image/png", data: "不是base64!!" }] })).status
    ).toBe(400);
    // 超 5MB（base64 长度 > 5MB*3/4）
    const huge = "A".repeat(Math.ceil((5 * 1024 * 1024 * 3) / 4) + 1);
    expect(
      (await postChat(app, { images: [{ name: "big", mediaType: "image/png", data: huge }] })).status
    ).toBe(400);
  });
});

describe("视觉通道：Anthropic 映射", () => {
  it("user parts 消息 → text 平移 + image_url(data URL) 转 base64 source", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "这张图里是什么" },
          { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } },
        ],
      },
    ];
    const { messages: mapped } = mapOpenAIMessagesToAnthropic(messages);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].content).toEqual([
      { type: "text", text: "这张图里是什么" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } },
    ]);
  });

  it("非 data URL 的 image_url（异常防御）被静默丢弃，不产生非法块", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "image_url", image_url: { url: "https://example.com/x.png" } },
        ],
      },
    ];
    const { messages: mapped } = mapOpenAIMessagesToAnthropic(messages);
    expect(mapped[0].content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("视觉通道：压缩器 parts 兼容", () => {
  const compactor = new ContextCompactor();

  it("parts 消息参与 token 预算：文本实计 + 图片固定估值", () => {
    const textOnly: ChatMessage[] = [{ role: "user", content: "hello world" }];
    const withImage: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "hello world" },
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
        ],
      },
    ];
    const diff = compactor.estimateTokens(withImage) - compactor.estimateTokens(textOnly);
    expect(diff).toBe(IMAGE_TOKEN_ESTIMATE);
  });

  it("超长工具输出截断与 sanitize 对 parts 消息不崩", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "看图" },
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
        ],
      },
      { role: "assistant", content: "好的", tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "t1", content: "x".repeat(200) },
    ];
    expect(() => compactor.sanitize(messages)).not.toThrow();
    expect(() => compactor.estimateParts(messages)).not.toThrow();
  });
});

describe("视觉通道：agent-loop 组装", () => {
  it("声明图片能力的模型 → 本轮 user 消息升级为 content parts", async () => {
    const { MemoryStorageDriver } = await import("../src/storage/drivers/memory.driver.js");
    const { WorkspaceRepository } = await import("../src/storage/repositories/workspace.repository.js");
    const { SessionRepository } = await import("../src/storage/repositories/session.repository.js");
    const { SettingsRepository } = await import("../src/storage/repositories/settings.repository.js");
    const { ToolRegistry } = await import("../src/core/tool-registry.js");
    const { ActionHub } = await import("../src/core/action-hub.js");
    const { AgentLoop } = await import("../src/core/agent-loop.js");
    const { ToolConfigRepository } = await import("../src/storage/repositories/tool-config.repository.js");

    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws = await workspaceRepo.create({ name: "W", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "T" });
    await settingsRepo.createProfile({
      id: "m-vision",
      name: "Vision",
      provider: "custom",
      model: "vision-model",
      isDefault: true,
      capabilities: { inputModalities: ["text", "image"] },
    });

    const capturing = new CapturingDriver();
    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(),
      actionHub: new ActionHub(),
      modelDriver: capturing,
    });

    for await (const _evt of loop.runTurn({
      sessionId: session.id,
      workspaceId: ws.id,
      prompt: "看图说话",
      images: [{ name: "a.png", mediaType: "image/png", data: PNG_B64 }],
    })) {
      void _evt;
    }

    expect(capturing.requests).toHaveLength(1);
    const msgs = capturing.requests[0].messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    expect(Array.isArray(lastUser?.content)).toBe(true);
    const parts = lastUser!.content as NonNullable<ChatMessage["content"]>;
    expect(parts[0]).toEqual({ type: "text", text: "看图说话" });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${PNG_B64}` },
    });
  });

  it("纯文本轮次消息结构与现状一致（content 恒为 string）", async () => {
    const { MemoryStorageDriver } = await import("../src/storage/drivers/memory.driver.js");
    const { WorkspaceRepository } = await import("../src/storage/repositories/workspace.repository.js");
    const { SessionRepository } = await import("../src/storage/repositories/session.repository.js");
    const { SettingsRepository } = await import("../src/storage/repositories/settings.repository.js");
    const { ToolRegistry } = await import("../src/core/tool-registry.js");
    const { ActionHub } = await import("../src/core/action-hub.js");
    const { AgentLoop } = await import("../src/core/agent-loop.js");
    const { ToolConfigRepository } = await import("../src/storage/repositories/tool-config.repository.js");

    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const ws = await workspaceRepo.create({ name: "W", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "T" });
    await settingsRepo.createProfile({
      id: "m-plain2", name: "P", provider: "custom", model: "p", isDefault: true,
      capabilities: { inputModalities: ["text", "image"] },
    });

    const capturing = new CapturingDriver();
    const loop = new AgentLoop({
      workspaceRepo, sessionRepo, settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry: new ToolRegistry(), actionHub: new ActionHub(), modelDriver: capturing,
    });
    for await (const _evt of loop.runTurn({ sessionId: session.id, workspaceId: ws.id, prompt: "纯文本" })) {
      void _evt;
    }
    const lastUser = [...capturing.requests[0].messages].reverse().find((m) => m.role === "user");
    expect(typeof lastUser?.content).toBe("string");
    expect(lastUser?.content).toBe("纯文本");
  });
});

describe("视觉通道：检查点回放（TASK-044）", () => {
  it("图片轮的快照锚点命中 parts 消息：跨轮回放不重复", async () => {
    const { MemoryStorageDriver } = await import("../src/storage/drivers/memory.driver.js");
    const { SessionRepository } = await import("../src/storage/repositories/session.repository.js");
    const { WorkspaceRepository } = await import("../src/storage/repositories/workspace.repository.js");
    const { buildHistoryMessages } = await import("../src/core/history-builder.js");

    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const ws = await workspaceRepo.create({ name: "W", rootPath: "/tmp", permission: "read-write" });
    const session = await sessionRepo.create({ workspaceId: ws.id, title: "T" });

    // 两轮：轮 1 是图片轮（快照 user 消息为 parts 形态），轮 2 普通
    const snap1: ChatMessage[] = [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "第一轮看图" },
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
        ],
      },
      { role: "assistant", content: "图里是一只猫" },
    ];
    const snap2: ChatMessage[] = [
      ...snap1,
      { role: "user", content: "第二轮提问" },
      { role: "assistant", content: "第二答" },
    ];
    // 快照挂在 checkpoints（history-builder 的真实读取路径），轮 1 的 user 消息为 parts 形态
    const cp = (turnId: string, snapshot: ChatMessage[]) => [
      {
        id: `cp-${turnId}`,
        turnId,
        stepIndex: 0,
        messagesSnapshot: JSON.parse(JSON.stringify(snapshot)),
        snapshotAt: Date.now(),
      },
    ];
    await sessionRepo.appendTurn(session.id, {
      id: "turn-1", sessionId: session.id, prompt: "第一轮看图", status: "done",
      startedAt: 1, completedAt: 2,
      checkpoints: cp("turn-1", snap1),
    } as never);
    await sessionRepo.appendTurn(session.id, {
      id: "turn-2", sessionId: session.id, prompt: "第二轮提问", status: "done",
      startedAt: 3, completedAt: 4,
      checkpoints: cp("turn-2", snap2),
    } as never);

    const reloaded = await sessionRepo.get(session.id);
    const history = buildHistoryMessages({ session: reloaded!, currentPrompt: "第三轮提问" });
    const texts = history.map((m) => (typeof m.content === "string" ? m.content : "[parts]"));

    // 锚点修复前：轮 2 的 parts 锚比对失败 → 快照全量回放 → 轮 1 的 user/assistant 重复
    expect(texts.filter((t) => t === "图里是一只猫")).toHaveLength(1);
    expect(texts.filter((t) => t === "第二答")).toHaveLength(1);
    expect(texts.filter((t) => t === "第一轮看图")).toHaveLength(1); // 作为轮 1 prompt 文本重放
    expect(texts.filter((t) => t === "第二轮提问")).toHaveLength(1);
    expect(history[history.length - 1]).toEqual({ role: "user", content: "第三轮提问" });
  });
});
