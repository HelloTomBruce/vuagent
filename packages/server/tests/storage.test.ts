import { describe, it, expect } from "vitest";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { SQLiteStorageDriver } from "../src/storage/drivers/sqlite.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import type { CheckpointEntity } from "../src/storage/interfaces.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";

describe("Storage Layer (Workspace, Session, Settings)", () => {
  it("should enforce safe workspace boundaries and reject path traversal", async () => {
    const driver = new MemoryStorageDriver();
    const wsRepo = new WorkspaceRepository(driver);

    const ws = await wsRepo.create({
      name: "App Project",
      rootPath: "/var/app/project",
      permission: "read-write",
    });

    // 允许内部路径
    const safeInside = await wsRepo.resolveSafePath(ws.id, "src/index.ts");
    expect(safeInside).toBe("/var/app/project/src/index.ts");

    // 严厉拒绝 ../ 越界读取
    await expect(
      wsRepo.resolveSafePath(ws.id, "../../etc/passwd")
    ).rejects.toThrow(/outside workspace boundary/);
  });

  it("should record turns and checkpoints in SessionRepository", async () => {
    const driver = new SQLiteStorageDriver(":memory:");
    const sessRepo = new SessionRepository(driver);

    const session = await sessRepo.create({
      workspaceId: "ws-1",
      title: "Feature Chat",
    });

    expect(session.id).toBeDefined();

    await sessRepo.appendTurn(session.id, {
      id: "turn-1",
      sessionId: session.id,
      prompt: "Hello",
      status: "done",
      stepCount: 1,
      checkpoints: [
        {
          id: "cp-1",
          turnId: "turn-1",
          stepIndex: 1,
          messagesSnapshot: [{ role: "user", content: "Hello" }],
          snapshotAt: Date.now(),
        } as CheckpointEntity,
      ],
      createdAt: Date.now(),
    });

    const reloaded = await sessRepo.get(session.id);
    expect(reloaded?.turns).toHaveLength(1);
    expect(reloaded?.turns[0].checkpoints).toHaveLength(1);
  });

  it("should cascade resolve effective model settings", async () => {
    const driver = new MemoryStorageDriver();
    const settingsRepo = new SettingsRepository(driver);

    await settingsRepo.createProfile({
      id: "global-default",
      name: "Global Default Profile",
      provider: "openai",
      model: "gpt-4o",
      parameters: { temperature: 0.2 },
      isDefault: true,
    });

    await settingsRepo.createProfile({
      id: "creative-claude",
      name: "Creative Claude",
      provider: "anthropic",
      model: "claude-3-7-sonnet",
      parameters: { temperature: 0.9 },
    });

    // 1. 无指定时走全局默认
    const effective1 = await settingsRepo.resolveEffectiveSettings();
    expect(effective1.model).toBe("gpt-4o");
    expect(effective1.parameters?.temperature).toBe(0.2);

    // 2. 指定 profile
    const effective2 = await settingsRepo.resolveEffectiveSettings("creative-claude");
    expect(effective2.model).toBe("claude-3-7-sonnet");
    expect(effective2.parameters?.temperature).toBe(0.9);

    // 3. 请求级临时覆盖
    const effective3 = await settingsRepo.resolveEffectiveSettings("creative-claude", {
      parameters: { temperature: 0.5 },
    });
    expect(effective3.parameters?.temperature).toBe(0.5);
  });
});
