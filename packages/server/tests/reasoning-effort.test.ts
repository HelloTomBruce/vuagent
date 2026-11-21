/**
 * 能力运行时 P1：推理档位（reasoningEffort）声明校验与注入
 *
 * 保守策略的完整矩阵（任一条件不满足 = 请求不带 effort 字段，行为与未携带一致）：
 *   声明 supported + 档位在 supportedEfforts → 注入 reasoning_effort
 *   档位不在集合 / 未声明 supported / 集合缺失 / 请求未携带 → 不注入
 * 另覆盖：既有 parameters 不被覆盖；Anthropic 档位 → thinking budget 映射。
 */
import { describe, it, expect } from "vitest";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "../src/adapters/model-driver.js";

/** 记录请求的替身驱动：一轮即收（text → done），把 generateStream 入参全部留证 */
class CapturingDriver implements IModelDriver {
  readonly requests: ModelDriverRequest[] = [];
  async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(req);
    yield { type: "text_delta", text: "ok" };
    yield { type: "done" };
  }
}

async function setup(profileCaps?: Record<string, unknown>, profileParameters?: Record<string, unknown>) {
  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const settingsRepo = new SettingsRepository(driver);

  const ws = await workspaceRepo.create({ name: "W", rootPath: "/tmp", permission: "read-write" });
  const session = await sessionRepo.create({ workspaceId: ws.id, title: "T" });

  await settingsRepo.createProfile({
    id: "m-cap",
    name: "Capable Model",
    provider: "custom",
    model: "capable-model",
    isDefault: true,
    ...(profileCaps ? { capabilities: profileCaps } : {}),
    ...(profileParameters ? { parameters: profileParameters } : {}),
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

  return { loop, capturing, session, ws };
}

async function run(loop: AgentLoop, session: { id: string; workspaceId: string }, reasoningEffort?: string) {
  const events = [];
  for await (const evt of loop.runTurn({
    sessionId: session.id,
    workspaceId: session.workspaceId,
    prompt: "hi",
    reasoningEffort,
  })) {
    events.push(evt);
  }
  return events;
}

describe("推理档位：声明校验（agent-loop 侧）", () => {
  it("声明 supported + 档位在集合内 → parameters 注入 reasoning_effort", async () => {
    const { loop, capturing, session } = await setup({
      reasoning: { supported: true, supportedEfforts: ["low", "high"], defaultEffort: "high" },
    });
    await run(loop, session, "high");
    expect(capturing.requests).toHaveLength(1);
    expect(capturing.requests[0].parameters?.reasoning_effort).toBe("high");
  });

  it("档位不在声明集合 → 不注入（保守降级，不猜）", async () => {
    const { loop, capturing, session } = await setup({
      reasoning: { supported: true, supportedEfforts: ["low", "high"] },
    });
    await run(loop, session, "medium");
    expect(capturing.requests[0].parameters?.reasoning_effort).toBeUndefined();
  });

  it("声明 supported 但集合缺失 → 无法校验，不注入", async () => {
    const { loop, capturing, session } = await setup({
      reasoning: { supported: true },
    });
    await run(loop, session, "high");
    expect(capturing.requests[0].parameters?.reasoning_effort).toBeUndefined();
  });

  it("模型未声明推理能力 → 不注入", async () => {
    const { loop, capturing, session } = await setup();
    await run(loop, session, "high");
    expect(capturing.requests[0].parameters?.reasoning_effort).toBeUndefined();
  });

  it("请求未携带档位 → 行为与现状一致", async () => {
    const { loop, capturing, session } = await setup({
      reasoning: { supported: true, supportedEfforts: ["low", "high"] },
    });
    await run(loop, session);
    expect(capturing.requests[0].parameters?.reasoning_effort).toBeUndefined();
  });

  it("注入档位时保留既有 parameters（不覆盖 temperature 等）", async () => {
    const { loop, capturing, session } = await setup(
      { reasoning: { supported: true, supportedEfforts: ["low"] } },
      { temperature: 0.3, maxTokens: 2048 }
    );
    await run(loop, session, "low");
    const params = capturing.requests[0].parameters as Record<string, unknown>;
    expect(params.reasoning_effort).toBe("low");
    expect(params.temperature).toBe(0.3);
    expect(params.maxTokens).toBe(2048);
  });
});

describe("输出上限（能力运行时 P3）：capabilities.maxOutputTokens", () => {
  it("声明 8192 → 请求注入 max_tokens=8192", async () => {
    const { loop, capturing, session } = await setup({ maxOutputTokens: 8192 });
    await run(loop, session);
    expect((capturing.requests[0].parameters as Record<string, unknown>).max_tokens).toBe(8192);
  });

  it("未声明 → 不发 max_tokens（现状回归）", async () => {
    const { loop, capturing, session } = await setup();
    await run(loop, session);
    expect((capturing.requests[0].parameters as Record<string, unknown>).max_tokens).toBeUndefined();
  });

  it("与推理档位共存：effort + max_tokens 同请求携带", async () => {
    const { loop, capturing, session } = await setup({
      reasoning: { supported: true, supportedEfforts: ["low"] },
      maxOutputTokens: 4096,
    });
    await run(loop, session, "low");
    const params = capturing.requests[0].parameters as Record<string, unknown>;
    expect(params.reasoning_effort).toBe("low");
    expect(params.max_tokens).toBe(4096);
  });
});
