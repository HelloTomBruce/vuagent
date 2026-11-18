import { Hono } from "hono";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { IStorageDriver } from "./storage/drivers/base.driver.js";
import { applySecurityBaseline, BYO_FORBIDDEN_MESSAGE, isProfileSelectionOnly, resolveSecurityConfig, sanitizeModelProfile } from "./security.js";
import type { ModelProfileEntity } from "./storage/interfaces.js";

const execAsync = promisify(exec);
import { SQLiteStorageDriver } from "./storage/drivers/sqlite.driver.js";
import { MemoryStorageDriver } from "./storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "./storage/repositories/workspace.repository.js";
import { SessionRepository } from "./storage/repositories/session.repository.js";
import { SettingsRepository } from "./storage/repositories/settings.repository.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { ActionHub } from "./core/action-hub.js";
import { AgentLoop } from "./core/agent-loop.js";
import { ContextCompactor, type ChatMessage } from "./core/context-compactor.js";
import { StreamOrchestrator } from "./core/stream-orchestrator.js";
import { SessionExecutionHub } from "./core/session-execution-hub.js";
import type { CheckpointEntity, TurnEntity } from "./storage/interfaces.js";
import type { IModelDriver } from "./adapters/model-driver.js";
import { OpenAICompatibleDriver } from "./adapters/openai-driver.js";
import { FsReadTool, FsWriteTool } from "./tools/system/fs-tools.js";
import { BashRunTool } from "./tools/system/bash-tool.js";
import { AllBuiltinTools } from "./tools/ui/protocol-tools.js";

export interface ServerOptions {
  storageDriver?: IStorageDriver;
  modelDriver?: IModelDriver;
  dbPath?: string;
  /** 安全基线覆盖项（测试注入用）；缺省走 VUAGENT_* 环境变量 */
  security?: { authToken?: string; allowByoProvider?: boolean; extraOrigins?: string[] };
}

export function createHarnessServer(options: ServerOptions = {}) {
  const app = new Hono();
  // 安全基线（TASK-011）：CORS/Origin 白名单 + 可选 Bearer 鉴权，替代原先 cors() 全开
  const security = resolveSecurityConfig(options.security);
  applySecurityBaseline(app, security);

  // 1. 初始化存储层
  const driver: IStorageDriver =
    options.storageDriver ||
    (options.dbPath === ":memory:"
      ? new MemoryStorageDriver()
      : new SQLiteStorageDriver(options.dbPath || ":memory:"));

  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const settingsRepo = new SettingsRepository(driver);

  // 2. 初始化核心组件
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(FsReadTool);
  toolRegistry.register(FsWriteTool);
  toolRegistry.register(BashRunTool);
  for (const t of AllBuiltinTools) {
    toolRegistry.register(t);
  }

  const actionHub = new ActionHub();
  // TASK-008：压缩器单例，AgentLoop（自动滑动窗口）与会话压缩接口（手动摘要化）共用裁剪口径
  const compactor = new ContextCompactor();
  const modelDriver: IModelDriver =
    options.modelDriver ||
    new OpenAICompatibleDriver(
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
    );

  const agentLoop = new AgentLoop({
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolRegistry,
    actionHub,
    modelDriver,
    compactor,
  });

  const executionHub = new SessionExecutionHub(agentLoop);

  // 3. 注册路由

  // 健康探针
  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: Date.now(),
      registeredToolsCount: toolRegistry.list().length,
      suspendedActionsCount: actionHub.listSuspended().length,
    });
  });

  // 核心对话流式接口 (SSE，委托 SessionExecutionHub 独立生命周期)
  app.post("/api/chat", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    // providerConfig / modelOverride 信任边界（TASK-011）：
    // 默认拒绝前端自备 baseUrl/apiKey（SSRF 面）；BYO 开关显式放行；
    // modelOverride 仅允许切换服务端已登记 profile
    let modelProfileId: string | undefined = body.modelProfileId;
    let modelOverride: Partial<ModelProfileEntity> | undefined;
    const hasProviderConfig = body.providerConfig !== undefined && body.providerConfig !== null;
    const hasModelOverride = body.modelOverride !== undefined && body.modelOverride !== null;

    if (hasProviderConfig || hasModelOverride) {
      if (security.allowByoProvider) {
        // 自备供应商模式：显式开启后透传（行为与历史版本一致）
        modelOverride = body.modelOverride || body.providerConfig;
      } else if (hasProviderConfig) {
        return c.json({ error: BYO_FORBIDDEN_MESSAGE, code: "PROVIDER_OVERRIDE_FORBIDDEN" }, 403);
      } else if (isProfileSelectionOnly(body.modelOverride)) {
        // 走 listProfiles 触发默认 profile 懒播种，避免全新库下误判未登记
        const profiles = await settingsRepo.listProfiles();
        const profile = profiles.find((p) => p.id === body.modelOverride.id);
        if (!profile) {
          return c.json(
            {
              error: `Forbidden: modelOverride.id "${body.modelOverride.id}" 不是服务端已登记的模型 profile`,
              code: "PROVIDER_OVERRIDE_FORBIDDEN",
            },
            403
          );
        }
        // 合法：仅切换服务端已登记 profile，等价于 modelProfileId
        if (!modelProfileId) modelProfileId = body.modelOverride.id;
      } else {
        return c.json({ error: BYO_FORBIDDEN_MESSAGE, code: "PROVIDER_OVERRIDE_FORBIDDEN" }, 403);
      }
    }

    // 默认工作区兜底
    let workspaceId = body.workspaceId;
    if (!workspaceId) {
      const list = await workspaceRepo.list();
      if (list.length > 0) {
        workspaceId = list[0].id;
      } else {
        const defaultWs = await workspaceRepo.create({
          name: "Default Workspace",
          rootPath: process.cwd(),
          permission: "read-write",
        });
        workspaceId = defaultWs.id;
      }
    }

    // 默认会话兜底
    let sessionId = body.sessionId;
    if (!sessionId) {
      const newSess = await sessionRepo.create({
        workspaceId,
        title: prompt.slice(0, 30),
      });
      sessionId = newSess.id;
    }

    // 设置 SSE 流式响应，由 SessionExecutionHub 独立托管后台运行
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let unsub: (() => void) | null = null;
        try {
          const res = await executionHub.startOrAttachTurn(
            {
              sessionId,
              workspaceId,
              prompt,
              permission: body.permission || "review",
              modelProfileId,
              modelOverride,
              maxSteps: body.maxSteps,
              timeoutMs: body.timeoutMs,
            },
            (event) => {
              if (event === "[DONE]") {
                controller.enqueue(encoder.encode(StreamOrchestrator.formatDone()));
                try {
                  controller.close();
                } catch {}
              } else {
                controller.enqueue(encoder.encode(StreamOrchestrator.formatSSE(event)));
              }
            }
          );
          unsub = res.unsubscribe;

          // 当单次 HTTP 请求断开（如前端切换会话），仅退订事件流，后台 Agent 执行绝不中断
          c.req.raw.signal.addEventListener("abort", () => {
            unsub?.();
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(
            encoder.encode(StreamOrchestrator.formatSSE({ type: "error", message: msg }))
          );
          try {
            controller.close();
          } catch {}
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // 中止正在运行的会话轮次
  app.post("/api/chat/abort", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sessionId = body.sessionId;
    const ok = executionHub.abort(sessionId);
    return c.json({ success: ok });
  });

  app.post("/api/sessions/:id/abort", async (c) => {
    const sessionId = c.req.param("id");
    const ok = executionHub.abort(sessionId);
    return c.json({ success: ok });
  });

  // 断点重连 / 切换回会话 / 页面刷新后重新连入会话事件流
  app.get("/api/sessions/:id/stream", async (c) => {
    const sessionId = c.req.param("id");
    const activeRun = executionHub.getActiveRun(sessionId);
    if (!activeRun || activeRun.isDone) {
      return c.json({ isRunning: false }, 200);
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const unsub = executionHub.subscribe(
          sessionId,
          (event) => {
            if (event === "[DONE]") {
              controller.enqueue(encoder.encode(StreamOrchestrator.formatDone()));
              try {
                controller.close();
              } catch {}
            } else {
              controller.enqueue(encoder.encode(StreamOrchestrator.formatSSE(event)));
            }
          },
          0
        );

        c.req.raw.signal.addEventListener("abort", () => {
          unsub?.();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // HITL 交互提交回调
  app.post("/api/action/:actionId", async (c) => {
    const actionId = c.req.param("actionId");
    const payload = await c.req.json().catch(() => ({}));
    // TASK-005：命中挂起索引时按 sessionId 直达目标会话，免除全库 O(N) 扫描
    const indexedSessionId = actionHub.getSessionIdForAction(actionId);
    const ok = actionHub.resolveAction(actionId, payload);

    // 同步更新数据库中历史会话的审批卡片状态，保证切换会话或刷新后状态依然保持
    const updateSessionCards = async (sessionId: string): Promise<void> => {
      const sess = await sessionRepo.get(sessionId);
      if (!sess) return;
      let modified = false;
      for (const turn of sess.turns) {
        if (!turn.cards) continue;
        for (const card of turn.cards) {
          if (card.type === "approval" && card.data?.actionId === actionId) {
            card.data.status = payload.approved ? "approved" : "denied";
            card.data.reason = payload.reason || payload.note;
            modified = true;
          }
        }
      }
      if (modified) {
        await sessionRepo.update(sess.id, { turns: sess.turns });
      }
    };

    try {
      if (indexedSessionId) {
        await updateSessionCards(indexedSessionId);
      } else {
        // 兜底：无索引信息（如进程重启后遗留的 actionId）退回全库扫描
        const allSessions = await sessionRepo.list();
        for (const sess of allSessions) {
          await updateSessionCards(sess.id);
        }
      }
    } catch (e) {
      console.warn("更新会话卡片审批持久化状态失败:", e);
    }

    return c.json({ success: ok }, ok ? 200 : 404);
  });

  // 查询当前挂起的动作列表
  app.get("/api/action/suspended", (c) => {
    return c.json(actionHub.listSuspended());
  });

  // 工作区接口
  app.get("/api/workspaces", async (c) => {
    const list = await workspaceRepo.list();
    return c.json(list);
  });

  app.post("/api/workspaces", async (c) => {
    const body = await c.req.json();
    const ws = await workspaceRepo.create(body);
    return c.json(ws, 201);
  });

  app.delete("/api/workspaces/:id", async (c) => {
    const id = c.req.param("id");
    const ok = await workspaceRepo.delete(id);
    return c.json({ success: ok }, ok ? 200 : 404);
  });

  // 调起操作系统原生文件夹选择器，直接获取绝对路径并创建工作区
  app.post("/api/workspaces/pick-directory", async (c) => {
    try {
      const isMac = process.platform === "darwin";
      const isWin = process.platform === "win32";

      let selectedPath = "";
      if (isMac) {
        const { stdout } = await execAsync(
          `osascript -e 'POSIX path of (choose folder with prompt "请选择一个本地项目文件夹作为工作区")'`
        );
        selectedPath = stdout.trim();
      } else if (isWin) {
        const { stdout } = await execAsync(
          `powershell -Command "Add-Type -AssemblyName System.windows.forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"`
        );
        selectedPath = stdout.trim();
      } else {
        const { stdout } = await execAsync("zenity --file-selection --directory");
        selectedPath = stdout.trim();
      }

      if (!selectedPath) {
        return c.json({ cancelled: true }, 200);
      }

      const name = path.basename(selectedPath) || "workspace";
      const ws = await workspaceRepo.create({
        name,
        rootPath: selectedPath,
        permission: "read-write",
      });

      return c.json(ws, 201);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // 会话接口
  app.get("/api/sessions", async (c) => {
    const workspaceId = c.req.query("workspaceId");
    const list = await sessionRepo.list(workspaceId ? (s) => s.workspaceId === workspaceId : undefined);
    const enriched = list.map((s) => ({
      ...s,
      isRunning: executionHub.isRunning(s.id),
    }));
    return c.json(enriched);
  });

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json();
    const sess = await sessionRepo.create(body);
    return c.json(sess, 201);
  });

  app.patch("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const updated = await sessionRepo.update(id, body);
    if (!updated) return c.json({ error: "Session not found" }, 404);
    return c.json(updated);
  });

  app.get("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const session = await sessionRepo.get(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    const isRunning = executionHub.isRunning(session.id);
    const activeRun = executionHub.getActiveRun(session.id);
    return c.json({
      ...session,
      isRunning,
      activeRun: activeRun
        ? {
            turnId: activeRun.turnId,
            prompt: activeRun.prompt,
            startedAt: activeRun.startedAt,
          }
        : undefined,
    });
  });

  app.delete("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const ok = await sessionRepo.delete(id);
    return c.json({ success: ok }, ok ? 200 : 404);
  });

  // TASK-008 手动压缩：把当前会话历史摘要化折叠（system + 摘要占位 + 最近 keepTokens 原始对话），
  // 上下文占用断崖回落；直接返回新占用（totalTokens/parts）供前端刷新仪表。
  // 与自动滑动窗口裁剪（ContextCompactor.compact，每步生效）互补，此处为用户显式干预入口。
  app.post("/api/sessions/:id/compact", async (c) => {
    const sessionId = c.req.param("id");
    const session = await sessionRepo.get(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);

    // 执行中的会话压缩会与 ReAct 回环竞争上下文状态，拒绝并提示稍后再试
    if (executionHub.isRunning(sessionId)) {
      return c.json(
        { error: "会话正在执行中，请等待本轮结束后再压缩", code: "SESSION_RUNNING" },
        409
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const keepTokens =
      typeof body?.keepTokens === "number" && body.keepTokens >= 1000
        ? Math.floor(body.keepTokens)
        : undefined;

    // 1. 取会话最近 checkpoint 快照作为完整历史（旧数据 checkpoints 可能缺字段，防御式遍历）
    let snapshot: ChatMessage[] | null = null;
    let snapshotTurn: TurnEntity | null = null;
    let snapshotCp: CheckpointEntity | null = null;
    for (let i = session.turns.length - 1; i >= 0; i--) {
      const turn = session.turns[i];
      const cps = Array.isArray(turn.checkpoints) ? turn.checkpoints : [];
      for (let j = cps.length - 1; j >= 0; j--) {
        const cp = cps[j];
        if (cp && Array.isArray(cp.messagesSnapshot) && cp.messagesSnapshot.length > 0) {
          snapshot = cp.messagesSnapshot as ChatMessage[];
          snapshotTurn = turn;
          snapshotCp = cp;
          break;
        }
      }
      if (snapshot) break;
    }

    if (!snapshot || !snapshotTurn) {
      return c.json({ error: "会话暂无可压缩的历史消息", code: "NO_HISTORY" }, 400);
    }

    const beforeTokens = compactor.estimateTokens(snapshot);
    const previousCompacted = session.compaction?.compactedTurnCount ?? 0;

    // 2. 摘要化折叠：保留 system + 摘要占位 + 最近 keepTokens 原始对话（sanitize 保证配对合法）
    const folded = compactor.manualCompact(snapshot, {
      keepTokens,
      previousCompactedTurns: previousCompacted,
    });

    // 历史不足以折叠（无新折叠轮次）：原占用返回，前端提示无需压缩
    if (folded.foldedTurnCount === 0) {
      return c.json({
        success: true,
        compacted: false,
        checkpointId: snapshotCp?.id,
        beforeTokens,
        afterTokens: beforeTokens,
        freed: 0,
        totalTokens: beforeTokens,
        parts: compactor.estimateParts(snapshot),
        compactedTurnCount: previousCompacted,
      });
    }

    const afterMessages = folded.messages;
    const afterTokens = compactor.estimateTokens(afterMessages);
    const parts = compactor.estimateParts(afterMessages);

    // 3. 落 compaction checkpoint（挂在最近带快照的轮次上，可追溯可回滚）
    if (!Array.isArray(snapshotTurn.checkpoints)) {
      snapshotTurn.checkpoints = [];
    }
    const checkpointId = `cp-compact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    snapshotTurn.checkpoints.push({
      id: checkpointId,
      turnId: snapshotTurn.id,
      stepIndex: (snapshotCp?.stepIndex ?? 0) + 1,
      messagesSnapshot: JSON.parse(JSON.stringify(afterMessages)),
      snapshotAt: Date.now(),
    });

    // 4. 前端水合口径：selectSession 按「最后一个带 contextTokens 的 turn」恢复仪表，
    //    同步压缩后的占用，保证刷新页面后显示压缩后的值
    if (snapshotTurn.telemetry) {
      snapshotTurn.telemetry.contextTokens = afterTokens;
    } else {
      snapshotTurn.telemetry = { durationMs: 0, laneEventsCount: 0, contextTokens: afterTokens };
    }

    // 5. 持久化压缩元数据：下一轮 runTurn 重建历史时据此折叠轮次并注入摘要占位
    const compactionRecord = {
      compactedTurnCount: folded.totalCompactedTurns,
      summary: folded.summary,
      checkpointId,
      beforeTokens,
      afterTokens,
      compactedAt: Date.now(),
    };
    session.compaction = compactionRecord;
    await sessionRepo.update(sessionId, {
      turns: session.turns,
      compaction: compactionRecord,
    });

    return c.json({
      success: true,
      compacted: true,
      checkpointId,
      beforeTokens,
      afterTokens,
      freed: Math.max(0, beforeTokens - afterTokens),
      totalTokens: afterTokens,
      parts,
      compactedTurnCount: folded.totalCompactedTurns,
    });
  });

  // 模型配置接口（TASK-011：apiKey 脱敏回显，任何响应不包含明文密钥）
  app.get("/api/settings/models", async (c) => {
    const list = await settingsRepo.listProfiles();
    return c.json(list.map(sanitizeModelProfile));
  });

  // 模型连通性真探测（TASK-005）：用表单配置发起最小 chat 探测，返回真实首响应时延或错误
  // TASK-011：支持 profileId 兜底——编辑已保存配置且未重新输入密钥时，探测走服务端存储的凭据
  app.post("/api/settings/models/test", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const storedProfile = body.profileId
      ? await settingsRepo.getProfile(String(body.profileId))
      : null;
    const endpoint = String(
      body.baseUrl || storedProfile?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
    );
    const apiKey = body.apiKey || storedProfile?.apiKey || process.env.OPENAI_API_KEY;
    const model = String(body.model || storedProfile?.model || "gpt-4o-mini");

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const probeDriver = new OpenAICompatibleDriver(apiKey, endpoint);
      const stream = probeDriver.generateStream({
        model,
        messages: [{ role: "user", content: "ping" }],
        parameters: { max_tokens: 1 },
        abortSignal: controller.signal,
      });
      let firstResponseAt = 0;
      for await (const chunk of stream) {
        if (chunk.type === "text_delta" || chunk.type === "done" || chunk.type === "usage") {
          firstResponseAt = Date.now();
          break; // 探测到首个响应即认为连通，无需完整生成
        }
      }
      if (!firstResponseAt) firstResponseAt = Date.now();
      return c.json({
        ok: true,
        latencyMs: firstResponseAt - startedAt,
        endpoint,
        model,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json(
        { ok: false, latencyMs: Date.now() - startedAt, endpoint, model, error: msg },
        200
      );
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post("/api/settings/models", async (c) => {
    const body = await c.req.json();
    const profile = await settingsRepo.createProfile(body);
    return c.json(sanitizeModelProfile(profile), 201);
  });

  app.patch("/api/settings/models/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const updated = await settingsRepo.updateProfile(id, body);
    if (!updated) return c.json({ error: "Profile not found" }, 404);
    return c.json(sanitizeModelProfile(updated));
  });

  app.delete("/api/settings/models/:id", async (c) => {
    const id = c.req.param("id");
    const ok = await settingsRepo.deleteProfile(id);
    return c.json({ success: ok }, ok ? 200 : 404);
  });

  return {
    app,
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolRegistry,
    actionHub,
    agentLoop,
  };
}
