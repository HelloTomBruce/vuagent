import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildSystemPrompt,
  buildEnvironmentBlock,
  buildPermissionBlock,
  buildDisciplineBlock,
  collectRuntimeEnv,
  type RuntimeEnvInfo,
} from "../src/core/system-prompt.js";
import { resolveEffectivePermissionMode } from "../src/core/permissions.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { SettingsRepository } from "../src/storage/repositories/settings.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub } from "../src/core/action-hub.js";
import { AgentLoop } from "../src/core/agent-loop.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { HarnessConfigRepository } from "../src/storage/repositories/harness-config.repository.js";
import { ConfigResolver } from "../src/core/config-resolver.js";
import { MockDriver } from "../src/adapters/mock-driver.js";
import type { ModelDriverRequest } from "../src/adapters/model-driver.js";
import type { WorkspaceEntity } from "../src/storage/interfaces.js";
import type { HarnessStreamEvent } from "../src/core/types.js";

/**
 * TASK-014 系统提示词三层机制回归：
 * ① 运行时环境披露（平台/OS/shell/cwd/git/当前日期——不靠模型猜）
 * ② 权限与审批模式声明（与 permissions.ts 仲裁逻辑同源）
 * ③ 操作纪律（失败重试上限/不虚构执行结果/非交互优先/先搜再读再改）
 * 工具执行契约在 schema 层的回归见 bash-tool.test.ts
 */

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

function fakeWorkspace(overrides: Partial<WorkspaceEntity> = {}): WorkspaceEntity {
  return {
    id: "ws-1",
    name: "Demo Workspace",
    rootPath: "/tmp/demo",
    permission: "read-write",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function fakeEnv(overrides: Partial<RuntimeEnvInfo> = {}): RuntimeEnvInfo {
  return {
    platform: "darwin",
    osRelease: "24.1.0",
    arch: "arm64",
    shell: "/bin/zsh",
    nodeVersion: "v22.11.0",
    homeDir: "/Users/demo",
    timezone: "Asia/Shanghai",
    now: new Date("2026-11-18T11:56:42+08:00"),
    isGitRepo: true,
    ...overrides,
  };
}

describe("resolveEffectivePermissionMode：请求级∩会话级取更严者", () => {
  it("未声明时默认 review", () => {
    expect(resolveEffectivePermissionMode(undefined, undefined)).toBe("review");
  });

  it("仅请求级生效（会话未声明不参与交集）", () => {
    expect(resolveEffectivePermissionMode("auto", undefined)).toBe("auto");
    expect(resolveEffectivePermissionMode("read-only", undefined)).toBe("read-only");
    expect(resolveEffectivePermissionMode("auto", "  ")).toBe("auto");
  });

  it("请求级未声明按 review 兜底：会话声明只能更严、不能放宽安全默认", () => {
    // TASK-012 既定语义：req 未声明 = review（安全默认），session=auto 无法放宽；
    // session 声明比默认更严（read-only）时生效
    expect(resolveEffectivePermissionMode(undefined, "auto")).toBe("review");
    expect(resolveEffectivePermissionMode(undefined, "read-only")).toBe("read-only");
  });

  it("交集取更严者（read-only > review > auto）", () => {
    expect(resolveEffectivePermissionMode("auto", "read-only")).toBe("read-only");
    expect(resolveEffectivePermissionMode("read-only", "auto")).toBe("read-only");
    expect(resolveEffectivePermissionMode("auto", "review")).toBe("review");
    expect(resolveEffectivePermissionMode("review", "auto")).toBe("review");
  });

  it("readonly 别名与未识别值安全降级", () => {
    expect(resolveEffectivePermissionMode("readonly", undefined)).toBe("read-only");
    expect(resolveEffectivePermissionMode("bogus", undefined)).toBe("review");
  });
});

describe("① 运行时环境披露块", () => {
  it("包含平台/架构/shell/Node/HOME/工作区/git/当前时间", () => {
    const block = buildEnvironmentBlock(fakeWorkspace(), fakeEnv());
    expect(block).toContain("darwin (macOS 24.1.0)");
    expect(block).toContain("arm64");
    expect(block).toContain("/bin/zsh");
    expect(block).toContain("v22.11.0");
    expect(block).toContain("/Users/demo");
    expect(block).toContain("Demo Workspace");
    expect(block).toContain("/tmp/demo");
    expect(block).toContain("Git 仓库: 是");
    expect(block).toContain("Asia/Shanghai");
    expect(block).toContain("2026-11-18");
  });

  it("非 git 工作区如实声明", () => {
    const block = buildEnvironmentBlock(fakeWorkspace(), fakeEnv({ isGitRepo: false }));
    expect(block).toContain("Git 仓库: 否");
  });

  it("collectRuntimeEnv 实测采集：git 探测与平台字段", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vuagent-env-"));
    tmpDirs.push(dir);

    expect(collectRuntimeEnv(dir).isGitRepo).toBe(false);
    await fs.mkdir(path.join(dir, ".git"));
    expect(collectRuntimeEnv(dir).isGitRepo).toBe(true);

    const env = collectRuntimeEnv(dir);
    expect(env.platform).toBe(process.platform);
    expect(env.arch).toBe(process.arch);
    expect(env.nodeVersion).toBe(process.version);
    expect(env.timezone.length).toBeGreaterThan(0);
  });
});

describe("② 权限与审批模式声明块", () => {
  it("review 模式声明挂起审批语义", () => {
    const block = buildPermissionBlock(fakeWorkspace(), "review");
    expect(block).toContain("review");
    expect(block).toContain("挂起");
    expect(block).toContain("read-write");
  });

  it("read-only 模式声明写工具拦截", () => {
    const block = buildPermissionBlock(fakeWorkspace(), "read-only");
    expect(block).toContain("read-only");
    expect(block).toContain("拦截");
  });

  it("auto 模式声明免审批", () => {
    const block = buildPermissionBlock(fakeWorkspace(), "auto");
    expect(block).toContain("auto");
    expect(block).toContain("不经过人工审批");
  });

  it("read-only 工作区声明硬闸门（含 auto 也拦）", () => {
    const block = buildPermissionBlock(fakeWorkspace({ permission: "read-only" }), "auto");
    expect(block).toContain("硬闸门");
  });
});

describe("③ 操作纪律块", () => {
  it("包含失败重试上限/不虚构/非交互优先/先搜再读再改", () => {
    const block = buildDisciplineBlock();
    expect(block).toContain("2~3 次");
    expect(block).toContain("停止重试");
    expect(block).toContain("绝不谎称执行过命令");
    expect(block).toContain("非交互式");
    expect(block).toContain("先搜索定位");
    expect(block).toContain("非零退出码不代表工具故障");
  });
});

describe("buildSystemPrompt 完整组装", () => {
  it("四段齐备，自定义指令置后", () => {
    const prompt = buildSystemPrompt({
      workspace: fakeWorkspace({ systemInstruction: "优先使用 pnpm" }),
      effectiveMode: "review",
      sessionSystemContext: "当前在做 TASK-014",
      env: fakeEnv(),
    });

    expect(prompt).toContain("高级智能体助手");
    expect(prompt).toContain("## 运行环境");
    expect(prompt).toContain("## 权限与审批模式");
    expect(prompt).toContain("## 操作纪律");
    expect(prompt).toContain("## 工作区自定义指令\n优先使用 pnpm");
    expect(prompt).toContain("## 会话上下文\n当前在做 TASK-014");

    // 自定义指令在内置块之后（用户显式配置优先级最高）
    expect(prompt.indexOf("## 工作区自定义指令")).toBeGreaterThan(
      prompt.indexOf("## 操作纪律")
    );
  });

  it("无自定义指令时不出现对应小节", () => {
    const prompt = buildSystemPrompt({
      workspace: fakeWorkspace(),
      effectiveMode: "auto",
      env: fakeEnv(),
    });
    expect(prompt).not.toContain("## 工作区自定义指令");
    expect(prompt).not.toContain("## 会话上下文");
  });
});

describe("AgentLoop 端到端：系统提示词注入与模式声明同源", () => {
  /** 记录模型请求的 MockDriver（isMock 分支会用注入的 driver 实例） */
  class RecordingMockDriver extends MockDriver {
    lastRequest?: ModelDriverRequest;
    override async *generateStream(req: ModelDriverRequest) {
      this.lastRequest = req;
      yield* super.generateStream(req);
    }
  }

  async function runAndCaptureSystemPrompt(permission?: "auto" | "review" | "read-only") {
    const driver = new MemoryStorageDriver();
    const workspaceRepo = new WorkspaceRepository(driver);
    const sessionRepo = new SessionRepository(driver);
    const settingsRepo = new SettingsRepository(driver);
    const toolRegistry = new ToolRegistry();
    const actionHub = new ActionHub();
    const mockDriver = new RecordingMockDriver();

    const ws = await workspaceRepo.create({
      name: "Prompt Workspace",
      rootPath: "/tmp",
      permission: "read-write",
    });
    const session = await sessionRepo.create({
      workspaceId: ws.id,
      title: "Prompt Session",
    });
    await settingsRepo.createProfile({
      id: "test-model",
      name: "Test Model",
      provider: "openai",
      model: "test-mock-model",
      isDefault: true,
    });

    mockDriver.setScript({ steps: [[{ type: "text", text: "收到" }]] });

    const loop = new AgentLoop({
      workspaceRepo,
      sessionRepo,
      settingsRepo,
      toolConfigRepo: new ToolConfigRepository(driver),
      toolRegistry,
      actionHub,
      modelDriver: mockDriver,
    });

    const events: HarnessStreamEvent[] = [];
    for await (const evt of loop.runTurn({
      workspaceId: ws.id,
      sessionId: session.id,
      prompt: "hi",
      permission,
    })) {
      events.push(evt);
    }

    const systemMsg = mockDriver.lastRequest?.messages?.[0];
    return { systemMsg, events };
  }

  it("system 消息含环境披露/权限声明/操作纪律三段", async () => {
    const { systemMsg } = await runAndCaptureSystemPrompt();
    expect(systemMsg?.role).toBe("system");
    const content = String(systemMsg?.content ?? "");
    expect(content).toContain("## 运行环境");
    expect(content).toContain("Prompt Workspace");
    expect(content).toContain("## 权限与审批模式");
    expect(content).toContain("## 操作纪律");
  });

  it("声明的模式与请求级权限一致（auto）", async () => {
    const { systemMsg } = await runAndCaptureSystemPrompt("auto");
    const content = String(systemMsg?.content ?? "");
    expect(content).toContain("本轮生效模式: auto");
  });

  it("声明的模式与请求级权限一致（read-only）", async () => {
    const { systemMsg } = await runAndCaptureSystemPrompt("read-only");
    const content = String(systemMsg?.content ?? "");
    expect(content).toContain("本轮生效模式: read-only");
  });
});

describe("提示词层可配置（TASK-027：prompt 命名空间接线）", () => {
  it("customInstructions 作为「用户自定义指令」块追加在所有内置块之后", () => {
    const prompt = buildSystemPrompt({
      workspace: fakeWorkspace({ systemInstruction: "优先使用 pnpm" }),
      effectiveMode: "review",
      sessionSystemContext: "当前在做 TASK-027",
      env: fakeEnv(),
      promptConfig: { customInstructions: "始终用中文回答，先给结论" },
    });

    expect(prompt).toContain("## 用户自定义指令\n始终用中文回答，先给结论");
    // 位置：在内置块与工作区/会话指令之后（只能追加，不能覆盖内置块）
    expect(prompt.indexOf("## 用户自定义指令")).toBeGreaterThan(
      prompt.indexOf("## 操作纪律")
    );
    expect(prompt.indexOf("## 用户自定义指令")).toBeGreaterThan(
      prompt.indexOf("## 会话上下文")
    );
  });

  it("customInstructions 为空/纯空白 → 不追加该块", () => {
    const prompt = buildSystemPrompt({
      workspace: fakeWorkspace(),
      effectiveMode: "auto",
      env: fakeEnv(),
      promptConfig: { customInstructions: "   " },
    });
    expect(prompt).not.toContain("## 用户自定义指令");
  });

  it("块开关关闭后对应块不出现（环境块/权限块），操作纪律块保留", () => {
    const prompt = buildSystemPrompt({
      workspace: fakeWorkspace(),
      effectiveMode: "review",
      env: fakeEnv(),
      promptConfig: { includeEnvironmentBlock: false, includePermissionBlock: false },
    });
    expect(prompt).not.toContain("## 运行环境");
    expect(prompt).not.toContain("## 权限与审批模式");
    expect(prompt).toContain("## 操作纪律");
    expect(prompt).toContain("高级智能体助手");
  });

  it("默认配置与历史硬编码行为严格等价（不传 promptConfig === 全默认 promptConfig）", () => {
    const base = {
      workspace: fakeWorkspace({ systemInstruction: "优先使用 pnpm" }),
      effectiveMode: "review" as const,
      sessionSystemContext: "ctx",
      env: fakeEnv(),
    };
    const legacy = buildSystemPrompt(base);
    const withDefaults = buildSystemPrompt({
      ...base,
      promptConfig: {
        customInstructions: "",
        includeEnvironmentBlock: true,
        includePermissionBlock: true,
      },
    });
    expect(withDefaults).toBe(legacy);
  });

  it("超长自定义指令经配置中心写路径截断到 4000 字符", async () => {
    const { createHarnessServer } = await import("../src/server.js");
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/config/prompt", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "x".repeat(5_000) }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.values.customInstructions).toHaveLength(4_000);
  });

  describe("AgentLoop 端到端：prompt 命名空间经 resolver 生效", () => {
    class RecordingMockDriver2 extends MockDriver {
      lastRequest?: ModelDriverRequest;
      override async *generateStream(req: ModelDriverRequest) {
        this.lastRequest = req;
        yield* super.generateStream(req);
      }
    }

    async function runWithPromptConfig(promptPatch?: Record<string, unknown>) {
      const driver = new MemoryStorageDriver();
      const workspaceRepo = new WorkspaceRepository(driver);
      const sessionRepo = new SessionRepository(driver);
      const settingsRepo = new SettingsRepository(driver);
      const harnessConfigRepo = new HarnessConfigRepository(driver);
      const configResolver = new ConfigResolver(harnessConfigRepo);
      const toolRegistry = new ToolRegistry();
      const actionHub = new ActionHub();
      const mockDriver = new RecordingMockDriver2();

      const ws = await workspaceRepo.create({
        name: "Prompt Cfg Workspace",
        rootPath: "/tmp",
        permission: "read-write",
      });
      const session = await sessionRepo.create({
        workspaceId: ws.id,
        title: "t",
      });
      await settingsRepo.createProfile({
        id: "test-model",
        name: "Test Model",
        provider: "openai",
        model: "test-mock-model",
        isDefault: true,
      });
      if (promptPatch) await harnessConfigRepo.patchNamespace("prompt", promptPatch);

      mockDriver.setScript({ steps: [[{ type: "text", text: "收到" }]] });

      const loop = new AgentLoop({
        workspaceRepo,
        sessionRepo,
        settingsRepo,
        toolConfigRepo: new ToolConfigRepository(driver),
        configResolver,
        toolRegistry,
        actionHub,
        modelDriver: mockDriver,
      });

      for await (const _evt of loop.runTurn({
        workspaceId: ws.id,
        sessionId: session.id,
        prompt: "hi",
        permission: "auto",
      })) {
        // 排空事件流
      }
      return String(mockDriver.lastRequest?.messages?.[0]?.content ?? "");
    }

    it("resolver 在场但无配置记录 → 三段齐备（默认等价）", async () => {
      const content = await runWithPromptConfig();
      expect(content).toContain("## 运行环境");
      expect(content).toContain("## 权限与审批模式");
      expect(content).toContain("## 操作纪律");
      expect(content).not.toContain("## 用户自定义指令");
    });

    it("配置 customInstructions → system 消息末尾出现该块", async () => {
      const content = await runWithPromptConfig({
        customInstructions: "全局规则：所有回复先列行动清单",
      });
      expect(content).toContain("## 用户自定义指令\n全局规则：所有回复先列行动清单");
      expect(content.indexOf("## 用户自定义指令")).toBeGreaterThan(
        content.indexOf("## 操作纪律")
      );
    });

    it("配置关闭环境块/权限块 → system 消息不含对应块", async () => {
      const content = await runWithPromptConfig({
        includeEnvironmentBlock: false,
        includePermissionBlock: false,
      });
      expect(content).not.toContain("## 运行环境");
      expect(content).not.toContain("## 权限与审批模式");
      expect(content).toContain("## 操作纪律");
    });
  });
});
