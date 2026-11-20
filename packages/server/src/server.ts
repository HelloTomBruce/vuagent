import { Hono } from "hono";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { IStorageDriver } from "./storage/drivers/base.driver.js";
import type { RedisLike } from "./storage/drivers/redis.driver.js";
import { TurnLeaseManager } from "./core/turn-lease.js";
import type { LeaseOptions } from "./core/session-execution-hub.js";
import { applySecurityBaseline, BYO_FORBIDDEN_MESSAGE, isProfileSelectionOnly, resolveSecurityConfig, sanitizeModelProfile, secureEqual } from "./security.js";
import { MetricsRegistry, createOpsMetricsSink } from "./core/metrics-registry.js";
import { createOtlpSink } from "./core/otlp-sink.js";
import { createAdmissionPipeline } from "./core/admission.js";
import { buildFileTree } from "./core/workspace-files.js";
import type { ModelProfileEntity } from "./storage/interfaces.js";

const execAsync = promisify(exec);
import { SQLiteStorageDriver } from "./storage/drivers/sqlite.driver.js";
import { MemoryStorageDriver } from "./storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "./storage/repositories/workspace.repository.js";
import { SessionRepository } from "./storage/repositories/session.repository.js";
import { SettingsRepository } from "./storage/repositories/settings.repository.js";
import { ToolConfigRepository } from "./storage/repositories/tool-config.repository.js";
import { HarnessConfigRepository } from "./storage/repositories/harness-config.repository.js";
import { CONFIG_SCHEMA, getNamespaceSchema } from "./core/config-schema.js";
import { ConfigResolver, isEnvLocked, resolveNamespaceValues, validateNamespacePatch } from "./core/config-resolver.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { ActionHub } from "./core/action-hub.js";
import { AgentLoop } from "./core/agent-loop.js";
import { ContextCompactor, type ChatMessage } from "./core/context-compactor.js";
import { StreamOrchestrator } from "./core/stream-orchestrator.js";
import { SessionExecutionHub } from "./core/session-execution-hub.js";
import type { CheckpointEntity, TurnEntity } from "./storage/interfaces.js";
import type { IModelDriver } from "./adapters/model-driver.js";
import { OpenAICompatibleDriver } from "./adapters/openai-driver.js";
import { FsEditTool, FsReadTool, FsWriteTool } from "./tools/system/fs-tools.js";
import { BashRunTool } from "./tools/system/bash-tool.js";
import { GlobTool, GrepTool } from "./tools/system/search-tools.js";
import { FinishTaskTool } from "./tools/system/finish-task-tool.js";
import { createWebFetchTool } from "./tools/web/web-tools.js";
import { AllBuiltinTools } from "./tools/ui/protocol-tools.js";
import { recoverInterruptedTurns } from "./core/recovery.js";
import {
  createConsoleNdjsonSink,
  compositeSink,
  type HarnessEventSink,
  type HarnessOpsCode,
} from "./core/event-sink.js";
import { ModelPricingTable, computeCostUsd, type ModelPricing } from "./core/pricing-table.js";
import { CostRecordRepository } from "./storage/repositories/cost-record.repository.js";

export interface ServerOptions {
  storageDriver?: IStorageDriver;
  modelDriver?: IModelDriver;
  dbPath?: string;
  /** 本副本实例标识（Redis 租约形态的归属与清扫目标）；缺省 VUAGENT_INSTANCE_ID > os.hostname() */
  instanceId?: string;
  /** 跨副本轮次租约客户端（Redis 形态）；提供后同会话全集群互斥 + 心跳保活 + 启动清扫 */
  redisClient?: RedisLike;
  /** 安全基线覆盖项（测试注入用）；缺省走 VUAGENT_* 环境变量 */
  security?: { authToken?: string; allowByoProvider?: boolean; extraOrigins?: string[] };
  /** 运维事件出口（TASK-051）：缺省 console NDJSON；测试注入内存 sink 断言事件流 */
  eventSink?: HarnessEventSink;
  /** 计价表来源（TASK-052）：JSON 文件路径或内存表；缺省 `${cwd}/config/model-pricing.json`（缺失=只记量不记钱） */
  pricingPath?: string;
  pricingTable?: Record<string, ModelPricing>;
}

export function createHarnessServer(options: ServerOptions = {}) {
  const app = new Hono();
  // TASK-051 运维事件出口：缺省 console NDJSON（error 级走 stderr）
  // 可观测出口（三轨 composite，注入 sink 的宿主/测试仍整链接管）：
  // ① console NDJSON（运维日志）；② Prometheus 指标注册表（GET /metrics 拉取）；
  // ③ 可选 OTLP HTTP JSON 推送（OTEL_EXPORTER_OTLP_ENDPOINT 配置启用）
  const metricsRegistry = new MetricsRegistry();
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const eventSink: HarnessEventSink = options.eventSink ?? compositeSink(
    createConsoleNdjsonSink(),
    createOpsMetricsSink(metricsRegistry),
    ...(otlpEndpoint
      ? [createOtlpSink({ endpoint: otlpEndpoint, serviceName: "vuagent-server" })]
      : [])
  );
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
  const toolConfigRepo = new ToolConfigRepository(driver);
  // 配置中心（TASK-024）：分层配置的存储与解析门面（无缓存，PATCH 即生效）
  const harnessConfigRepo = new HarnessConfigRepository(driver);
  const configResolver = new ConfigResolver(harnessConfigRepo);

  // TASK-052 成本台账：计价表（缺省 config/model-pricing.json，缺失=只记量不记钱）+ 台账仓储
  const costRepo = new CostRecordRepository(driver);
  const pricingTable = new ModelPricingTable(options.pricingTable ?? options.pricingPath);

  // 2. 初始化核心组件
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(FsReadTool);
  toolRegistry.register(FsWriteTool);
  toolRegistry.register(FsEditTool);
  toolRegistry.register(BashRunTool);
  toolRegistry.register(GlobTool);
  toolRegistry.register(GrepTool);
  // 显式终态协议工具：注册进 registry（执行链可见性由 finishTaskMode 推导的
  // hideTools 控制——off 时对模型不可见；enforced 时由 agent-loop 拦截裁决）
  toolRegistry.register(FinishTaskTool);
  // TASK-026：私网放行改走配置中心 security.allowPrivateFetch（env 显式设置时
  // 由 resolver 的 envLock 锁定为 env 值），运行中改档逐次执行即时生效
  toolRegistry.register(
    createWebFetchTool(async () => {
      const sec = await configResolver.resolve("security");
      return sec?.allowPrivateFetch === true;
    })
  );
  for (const t of AllBuiltinTools) {
    toolRegistry.register(t);
  }

  const actionHub = new ActionHub();
  // TASK-008：压缩器单例，AgentLoop（自动滑动窗口）与会话压缩接口（手动摘要化）共用裁剪口径
  const compactor = new ContextCompactor();
  // 模型驱动透传（宿主/测试注入用）；缺省由 AgentLoop 按所选模型档案逐轮构造，
  // 生产路径不再默认构造占位驱动（与 agent-loop 逐档案构造口径一致）
  const modelDriver = options.modelDriver;

  const agentLoop = new AgentLoop({
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolConfigRepo,
    toolRegistry,
    actionHub,
    modelDriver,
    compactor,
    configResolver,
    eventSink,
    // TASK-052 成本记账：turn 收尾按计价表折算 USD 后落账（fail-open）
    costRecorder: async (entry) => {
      const pricing = pricingTable.priceFor(entry.model);
      const costUsd = pricing
        ? computeCostUsd(pricing, entry.promptTokens, entry.completionTokens)
        : undefined;
      await costRepo.record({ ...entry, costUsd });
    },
  });

  // 跨副本租约（Redis 形态，TASK-074）：提供 redisClient 时启用——同会话全集群互斥、
  // ttl/3 心跳保活（连续失败中止本副本轮次防双主）、抽干落库后释放、启动清扫本实例遗留
  const instanceId = options.instanceId ?? process.env.VUAGENT_INSTANCE_ID ?? os.hostname();
  const lease: LeaseOptions | undefined = options.redisClient
    ? {
        manager: new TurnLeaseManager(options.redisClient, instanceId),
        instanceId,
      }
    : undefined;
  const executionHub = new SessionExecutionHub(agentLoop, eventSink, lease);

  // 启动清扫（Redis 形态）：清理本实例上次进程崩溃/重启遗留的租约（fire-and-forget）
  if (lease) {
    void lease.manager.sweepOrphans(instanceId).then((swept: string[]) => {
      if (swept.length > 0) {
        eventSink.emit({
          type: "warn",
          at: Date.now(),
          code: "RECOVERED_LEASES",
          detail: `instanceId=${instanceId} swept=${swept.length} sessions=[${swept.join(",")}]`,
        });
      }
    });
  }

  // TASK-049 进程重启恢复：扫描遗留 running 轮次，诚实标记 error/process_restart。
  // fire-and-forget：createHarnessServer 保持同步签名；恢复完成前极端情况下
  // 新请求读到的仍是 running 行，属可接受的启动竞态窗。
  void recoverInterruptedTurns(sessionRepo)
    .then((recovered) => {
      if (recovered.length > 0) {
        // TASK-051：恢复告警走事件出口（可 grep 的 RECOVERED_TURNS）；
        // TASK-060：去除 console.warn 双发——事件出口是运维日志唯一通道，避免双份噪音
        eventSink.emit({
          type: "warn",
          at: Date.now(),
          code: "RECOVERED_TURNS",
          detail: `${recovered.length} 个中断轮次已标记 process_restart：${recovered.map((r) => `${r.sessionId}/${r.turnId}@${r.checkpointCount}cp`).join(", ")}`,
        });
      }
    })
    .catch(() => {
      // 恢复扫描失败不阻断服务启动
    });

  // 3. 注册路由

  // Prometheus 指标拉取端点（文本格式 v0.0.4）：配置 VUAGENT_TOKEN 时同样要求
  // Bearer 令牌（与 /api/* 同一口径，Prometheus scrape 配置 bearer_token 即可）
  app.get("/metrics", (c) => {
    const security = resolveSecurityConfig(options.security);
    if (security.authToken) {
      const header = c.req.header("Authorization") || "";
      const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
      if (!provided || !secureEqual(provided, security.authToken)) {
        return c.json({ error: "Unauthorized: /metrics 需要 Bearer 令牌（VUAGENT_TOKEN）" }, 401);
      }
    }
    return c.text(metricsRegistry.renderPrometheus(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  // 健康探针
  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: Date.now(),
      registeredToolsCount: toolRegistry.list().length,
      suspendedActionsCount: actionHub.listSuspended().length,
    });
  });

  // 工具配置（TASK-019 启停；TASK-026 per-tool timeoutMs/requiresApproval 覆盖）：
  // registry 元数据 ∪ 全局配置。缺配置记录 = 启用且无覆盖；PATCH 即时生效
  // （agent-loop 逐工具调用实时读）。requiresApproval 返回的是生效值——
  // 覆盖 deny-wins（只能升不能降），存储的 override=false 不放宽推导结果。
  app.get("/api/tools", async (c) => {
    const configs = await toolConfigRepo.list();
    const cfgByName = new Map(configs.map((cfg) => [cfg.name, cfg]));
    const tools = toolRegistry
      .list()
      .map((t) => {
        const cfg = cfgByName.get(t.name);
        const derivedApproval = t.requiresApproval === true || t.riskLevel === "high";
        return {
          name: t.name,
          description: t.description,
          riskLevel: t.riskLevel ?? "medium",
          writesWorkspace: t.writesWorkspace === true,
          requiresApproval: derivedApproval || cfg?.requiresApproval === true,
          enabled: cfg?.enabled !== false,
          timeoutMs: cfg?.timeoutMs ?? null,
          source: "builtin",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return c.json(tools);
  });

  app.patch("/api/tools/:name", async (c) => {
    const name = c.req.param("name");
    if (!toolRegistry.get(name)) {
      return c.json({ error: `Unknown tool [${name}]` }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({ error: "body 必须是 { enabled?, timeoutMs?, requiresApproval? } 对象" }, 400);
    }
    const ALLOWED_KEYS = ["enabled", "timeoutMs", "requiresApproval"] as const;
    const patch: { enabled?: boolean; timeoutMs?: number; requiresApproval?: boolean } = {};
    for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
      if (!(ALLOWED_KEYS as readonly string[]).includes(key)) {
        return c.json({ error: `未知字段 [${key}]（支持 ${ALLOWED_KEYS.join("/")}）` }, 400);
      }
      if (key === "enabled" || key === "requiresApproval") {
        if (typeof raw !== "boolean") return c.json({ error: `body.${key} 需要 boolean` }, 400);
        patch[key] = raw;
      } else {
        // API 下限 1000ms 是 UI 防呆（避免面板误填 50ms 之类自杀值）；
        // 引擎层（agent-loop 对 repo 直写的覆盖）接受 ≥1ms，属有意的分层宽容
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1_000) {
          return c.json({ error: "body.timeoutMs 需要 ≥1000 的有限数值（毫秒）" }, 400);
        }
        patch.timeoutMs = raw;
      }
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "body 至少包含 enabled/timeoutMs/requiresApproval 之一" }, 400);
    }
    const config = await toolConfigRepo.update(name, patch);
    return c.json(config);
  });

  // 配置中心（TASK-024）：CONFIG_SCHEMA 驱动的分层配置。
  // GET 返回 schema + 各命名空间生效值 + isDefault 标记（前端表驱动渲染）；
  // PATCH 严格校验（未知 key/类型不符/env 锁定 → 400，number 钳制、text 截断）；
  // reset 删除记录恢复全默认（缺记录=全默认）。
  app.get("/api/config", async (c) => {
    const namespaces = await Promise.all(
      CONFIG_SCHEMA.map(async (ns) => {
        const stored = await harnessConfigRepo.getNamespace(ns.id);
        return {
          id: ns.id,
          title: ns.title,
          description: ns.description,
          // locked：env 显式设置的部署级强制锁（UI 据此只读展示锁标记，TASK-028）
          fields: ns.fields.map((f) => ({ ...f, locked: isEnvLocked(f) })),
          values: resolveNamespaceValues(ns, stored?.values),
          isDefault: !stored || Object.keys(stored.values).length === 0,
        };
      })
    );
    return c.json({ namespaces });
  });

  app.patch("/api/config/:namespace", async (c) => {
    const ns = getNamespaceSchema(c.req.param("namespace"));
    if (!ns) {
      return c.json({ error: `Unknown config namespace [${c.req.param("namespace")}]` }, 404);
    }
    const body = await c.req.json().catch(() => ({}));
    const validation = validateNamespacePatch(ns, body);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400);
    }
    const entity = await harnessConfigRepo.patchNamespace(ns.id, validation.values);
    // 返回生效值（含 envLock 覆盖与钳制结果），调用方以此为准
    return c.json({
      namespace: ns.id,
      values: resolveNamespaceValues(ns, entity.values),
      updatedAt: entity.updatedAt,
    });
  });

  app.post("/api/config/:namespace/reset", async (c) => {
    const ns = getNamespaceSchema(c.req.param("namespace"));
    if (!ns) {
      return c.json({ error: `Unknown config namespace [${c.req.param("namespace")}]` }, 404);
    }
    await harnessConfigRepo.resetNamespace(ns.id);
    return c.json({
      namespace: ns.id,
      values: resolveNamespaceValues(ns, null),
      isDefault: true,
    });
  });

  // 核心对话流式接口 (SSE，委托 SessionExecutionHub 独立生命周期)
  app.post("/api/chat", async (c) => {    const body = await c.req.json().catch(() => ({}));
    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    // providerConfig / modelOverride 信任边界（TASK-011）：
    // 默认拒绝前端自备 baseUrl/apiKey（SSRF 面）；BYO 开关显式放行；
    // modelOverride 仅允许切换服务端已登记 profile
    // TASK-026：BYO 开关与默认权限模式接入配置中心 security 命名空间
    // （请求时解析，运行中改档即生效；env 显式设置时由 envLock 锁定为 env 值）。
    // options.security.allowByoProvider 显式注入（测试）优先级最高。
    const securityNs = (await configResolver.resolve("security")) ?? {};
    const allowByoProvider =
      options.security?.allowByoProvider ?? securityNs.allowByoProvider === true;
    const defaultPermissionMode =
      typeof securityNs.defaultPermissionMode === "string"
        ? securityNs.defaultPermissionMode
        : "review";

    let modelProfileId: string | undefined = body.modelProfileId;
    let modelOverride: Partial<ModelProfileEntity> | undefined;
    const hasProviderConfig = body.providerConfig !== undefined && body.providerConfig !== null;
    const hasModelOverride = body.modelOverride !== undefined && body.modelOverride !== null;

    if (hasProviderConfig || hasModelOverride) {
      if (allowByoProvider) {
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

    const preempt = body.preempt === true;

    // 准入洋葱管线（TASK-071 自内联提取为可组合中间件，拒绝口径逐字节一致）：
    // 并发门禁 → 配额门禁。maxConcurrentTurns=0 不限；preempt 对目标会话豁免 1
    // （旧轮即将被顶替释放，避免 maxConcurrentTurns=1 时 preempt 永远 429 死锁）。
    // 新增准入策略 = 向 createAdmissionPipeline 追加中间件，不再改动路由主体。
    const execAdmission = await configResolver.resolve("execution");
    const maxConcurrentTurns = Number(execAdmission?.maxConcurrentTurns) || 0;
    const admission = createAdmissionPipeline(
      { executionHub, configResolver, costRepo, eventSink },
      maxConcurrentTurns
    );
    const rejection = await admission({ sessionId: body.sessionId, preempt });
    if (rejection) {
      return c.json(rejection.body, rejection.status);
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

    // TASK-050 并发语义：先做原子开轮声明——会话运行中默认 409 拒绝
    // （错误文案引导停止后重发）；body.preempt:true 顶替语义 = 中止旧轮
    // （new_task 成因）→ 等待抽干落库（上限 10s）→ 开新轮；超时仍 409。
    // claim 在 SSE Response 创建之前完成，使拒绝以正确 HTTP 状态呈现。
    let claim: Awaited<ReturnType<typeof executionHub.claimTurn>>;
    try {
      claim = await executionHub.claimTurn(
        {
          sessionId,
          workspaceId,
          prompt,
          permission: body.permission || defaultPermissionMode,
          modelProfileId,
          modelOverride,
          maxSteps: body.maxSteps,
          timeoutMs: body.timeoutMs,
        },
        { preempt }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
    if (!claim.ok) {
      const code: HarnessOpsCode =
        claim.reason === "running" ? "SESSION_RUNNING_REJECTED" : "PREEMPT_TIMEOUT";
      // TASK-051：准入拒绝运维事件
      eventSink.emit({
        type: "warn",
        at: Date.now(),
        code,
        sessionId,
        detail: claim.reason === "running" ? `prompt: ${prompt.slice(0, 80)}` : "preempt 抽干等待超时",
      });
      const message =
        claim.reason === "running"
          ? "会话正在执行中，请等待当前轮次完成或停止后再发送（也可携带 preempt:true 顶替当前轮次）"
          : "顶替超时：上一轮次未能在限时内完成收尾，请稍后重试";
      return c.json({ error: message, code }, 409);
    }

    // 设置 SSE 流式响应：claim 成功后仅订阅事件流（claim 与订阅之间的
    // 事件缓冲在 run.events 中，subscribe 从头重放保证顺序完整）
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const sub = executionHub.subscribe(
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

        if (!sub) {
          // 极端竞态：claim 后 run 被（另一 preempt 请求）顶替——回退错误事件收尾
          controller.enqueue(
            encoder.encode(
              StreamOrchestrator.formatSSE({
                type: "error",
                message: "会话执行已被新请求顶替，本次连接不承载事件流",
                code: "TURN_PREEMPTED",
              })
            )
          );
          try {
            controller.close();
          } catch {}
          return;
        }

        // 当单次 HTTP 请求断开（如前端切换会话），仅退订事件流，后台 Agent 执行绝不中断
        c.req.raw.signal.addEventListener("abort", () => {
          sub();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // TASK-054：协议版本头（增量重连/跨端协商的锚点）
        "x-vuagent-protocol-version": "1",
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
        "x-vuagent-protocol-version": "1",
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

  // TASK-052 成本台账查询出口：滚动窗口累计与按模型聚合（前端仪表可选接入）
  app.get("/api/finops/summary", async (c) => {
    const raw = Number(c.req.query("windowMs"));
    const windowMs = Number.isFinite(raw) && raw > 0 ? raw : 86_400_000;
    const [usage, byModel] = await Promise.all([
      costRepo.sumWindow(windowMs),
      costRepo.sumWindowByModel(windowMs),
    ]);
    return c.json({ windowMs, ...usage, byModel });
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

  // 工作区文件树（只读、有界：深度 4 / 节点 2000，忽略 node_modules/.git 等目录），
  // 供控制台右栏 VaFileTree 展示当前工作区目录结构
  app.get("/api/workspaces/:id/files", async (c) => {
    const ws = await workspaceRepo.get(c.req.param("id"));
    if (!ws) return c.json({ error: "workspace not found" }, 404);
    try {
      const result = await buildFileTree(ws.rootPath);
      return c.json({ root: ws.rootPath, ...result });
    } catch (e) {
      return c.json({ error: `读取目录失败: ${e instanceof Error ? e.message : String(e)}` }, 500);
    }
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
      // 连通性探测关闭韧性（TASK-048）：探测要如实反映首响应时延与故障，
      // 重试会掩盖失败并扭曲 latencyMs 语义
      const probeDriver = new OpenAICompatibleDriver(apiKey, endpoint, { resilience: false });
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
