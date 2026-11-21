import { Hono } from "hono";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { IStorageDriver } from "./storage/drivers/base.driver.js";
import type { RedisLike } from "./storage/drivers/redis.driver.js";
import { TurnLeaseManager } from "./core/turn-lease.js";
import type { LeaseOptions } from "./core/session-execution-hub.js";
import { applySecurityBaseline, BYO_FORBIDDEN_MESSAGE, isProfileSelectionOnly, resolveSecurityConfig, sanitizeModelProfile, sanitizeProvider, secureEqual } from "./security.js";
import { MetricsRegistry, createOpsMetricsSink } from "./core/metrics-registry.js";
import { createOtlpSink } from "./core/otlp-sink.js";
import { createAdmissionPipeline } from "./core/admission.js";
import { buildFileTree } from "./core/workspace-files.js";
import type { ModelProfileEntity } from "./storage/interfaces.js";
import { isProviderKind } from "./storage/interfaces.js";
import type { ModelCapabilities, ProviderEntity, ProviderKind } from "./storage/interfaces.js";
import { detectModels } from "./core/model-probe.js";
import { defaultBaseUrlFor, isAnthropicNativeEndpoint } from "./core/provider-defaults.js";
import type { TurnImageInput } from "./core/types.js";

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
      // 分档计价（能力运行时 P1）：缓存命中与推理 token 按各自单价折算
      const costUsd = pricing
        ? computeCostUsd(pricing, entry.promptTokens, entry.completionTokens, {
            cachedPromptTokens: entry.cachedTokens,
            reasoningTokens: entry.reasoningTokens,
          })
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
  // 会话级成本聚合（TASK-056 会话徽标数据源，一次批量避免逐会话 N+1）。
  // 与 summary 同域挂 finops 命名空间；窗口钳制 [1min, 30d]，默认 24h
  app.get("/api/finops/by-session", async (c) => {
    const raw = Number(c.req.query("windowMs"));
    const windowMs =
      Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(Math.floor(raw), 60_000), 30 * 24 * 3_600_000) : 86_400_000;
    return c.json({ windowMs, bySession: await costRepo.sumWindowBySession(windowMs) });
  });

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

    // 视觉通道（能力运行时 P2）：结构硬校验 + 能力门禁。
    // 保守策略：生效档案未声明 inputModalities 含 image → 400 带指引文案，
    // 不猜能力（宁可拒收，不传图后吃 provider 400）。
    let turnImages: TurnImageInput[] | undefined;
    if (body.images !== undefined && body.images !== null) {
      const structCheck = pickTurnImages(body.images);
      if ("error" in structCheck) {
        return c.json({ error: structCheck.error, code: "IMAGE_INPUT_REJECTED" }, 400);
      }
      if (structCheck.images.length > 0) {
        const sessionForModel = body.sessionId
          ? await sessionRepo.get(String(body.sessionId))
          : null;
        // 与 agent-loop 的 resolve 同参（含 BYO override），保证门禁判断的就是
        // 实际执行的档案——否则 BYO 模式下门禁按默认档案误判放行/拒绝
        const effProfile = await settingsRepo.resolveEffectiveSettings(
          modelProfileId || sessionForModel?.activeModelProfileId,
          modelOverride
        );
        const mods = effProfile.capabilities?.inputModalities;
        if (!Array.isArray(mods) || !mods.includes("image")) {
          return c.json(
            {
              error: `当前模型「${effProfile.name}」未声明支持图片输入：请在「模型设置 → 能力标记」勾选图片后重试`,
              code: "IMAGE_INPUT_REJECTED",
            },
            400
          );
        }
        turnImages = structCheck.images;
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
          // 能力运行时 P1：推理档位（字符串档名；合法性由 agent-loop 按能力声明裁决）
          reasoningEffort:
            typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim() || undefined : undefined,
          // 能力运行时 P2：图片附件（路由层已完成结构与能力校验）
          images: turnImages,
          // TASK-050：附件元数据（回显用，白名单校验，不参与请求构造）
          attachments: pickAttachmentMeta(body.attachments),
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

  // TASK-052 成本台账查询出口：滚动窗口累计与按模型聚合（TASK-075 起由前端用量面板消费）
  // 两种窗口形态：windowMs（滚动至此刻）或 since+until（自定义日期区间，毫秒时间戳，[since, until)）
  app.get("/api/finops/summary", async (c) => {
    const sinceQ = Number(c.req.query("since"));
    const untilQ = Number(c.req.query("until"));
    const hasRange =
      Number.isFinite(sinceQ) && Number.isFinite(untilQ) && sinceQ > 0 && untilQ > sinceQ;

    if (hasRange) {
      const [usage, byModel] = await Promise.all([
        costRepo.sumWindowBetween(sinceQ, untilQ),
        costRepo.sumWindowByModelBetween(sinceQ, untilQ),
      ]);
      return c.json({ windowMs: untilQ - sinceQ, since: sinceQ, until: untilQ, ...usage, byModel });
    }

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

  // 供应商层（P0 模型设置重构）：端点/凭证在此存一份，1:N 挂载多个模型

  /**
   * 供应商入参白名单（**部分更新语义**：只返回 body 里实际出现的键）。
   *
   * 不能直接 {...body} 透传：createProvider 的签名允许传入 id，前端若传一个
   * 已存在的 id 就会静默覆盖另一个供应商（含其凭证）。
   *
   * 也不能用「未传字段填默认值」的做法：PATCH 只改 baseUrl 时会把 name 填成空串，
   * 等于顺手清空名称。所以这里只 pick 出现过的字段，由调用方决定新建时的默认值。
   */
  const pickProviderPatch = (body: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    if ("name" in body) out.name = typeof body.name === "string" ? body.name.trim() : "";
    if ("provider" in body) out.provider = isProviderKind(body.provider) ? body.provider : "custom";
    if ("baseUrl" in body) {
      out.baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() || undefined : undefined;
    }
    if ("apiKey" in body) out.apiKey = typeof body.apiKey === "string" ? body.apiKey || undefined : undefined;
    if ("parameters" in body) {
      out.parameters =
        body.parameters && typeof body.parameters === "object"
          ? (body.parameters as Record<string, unknown>)
          : undefined;
    }
    return out;
  };

  /** 模型入参白名单（同理：不允许前端指定 id / 时间戳；providerId 由路径决定） */
  const pickModelPatch = (body: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    if ("name" in body) out.name = typeof body.name === "string" ? body.name.trim() : "";
    if ("model" in body) out.model = typeof body.model === "string" ? body.model.trim() : "";
    // baseUrl/apiKey 仅在「旧路由改遗留内联配置」时可用；
    // 在供应商下建模型时由调用方显式丢弃，凭证始终继承 provider。
    if ("baseUrl" in body) {
      out.baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() || undefined : undefined;
    }
    if ("apiKey" in body) out.apiKey = typeof body.apiKey === "string" ? body.apiKey || undefined : undefined;
    if ("contextWindow" in body) {
      out.contextWindow = typeof body.contextWindow === "number" ? body.contextWindow : undefined;
    }
    if ("capabilities" in body) {
      out.capabilities =
        body.capabilities && typeof body.capabilities === "object"
          ? (body.capabilities as Record<string, unknown>)
          : undefined;
    }
    if ("parameters" in body) {
      out.parameters =
        body.parameters && typeof body.parameters === "object"
          ? (body.parameters as Record<string, unknown>)
          : undefined;
    }
    // 兼容旧前端：顶层 temperature 由 repository 归一到 parameters.temperature
    if ("temperature" in body) {
      out.temperature = typeof body.temperature === "number" ? body.temperature : undefined;
    }
    if ("isDefault" in body) out.isDefault = body.isDefault === true;
    return out;
  };

  /* ---------- 视觉通道入参校验（能力运行时 P2） ---------- */
  const MAX_TURN_IMAGES = 4;
  /** base64 字符数上限：解码后 ≈5MB（×3/4） */
  const MAX_IMAGE_BASE64_LENGTH = Math.ceil((5 * 1024 * 1024 * 3) / 4);
  const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  /** 结构校验：张数 / 大小 / 类型白名单；能力门禁在路由内按生效档案另行判断 */
  const pickTurnImages = (raw: unknown): { images: TurnImageInput[] } | { error: string } => {
    if (!Array.isArray(raw)) return { error: "images 必须是数组" };
    if (raw.length === 0) return { images: [] };
    if (raw.length > MAX_TURN_IMAGES) return { error: `单轮最多携带 ${MAX_TURN_IMAGES} 张图片` };
    const images: TurnImageInput[] = [];
    for (const item of raw) {
      const o = (item ?? {}) as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name : "";
      const mediaType = typeof o.mediaType === "string" ? o.mediaType : "";
      const data = typeof o.data === "string" ? o.data : "";
      if (!IMAGE_MEDIA_TYPES.has(mediaType)) {
        return { error: `不支持的图片类型：${mediaType || "(空)"}（支持 png/jpeg/webp/gif）` };
      }
      if (!data) return { error: `图片「${name || mediaType}」缺少 base64 数据` };
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        return { error: `图片「${name}」的 base64 数据不合法` };
      }
      if (data.length > MAX_IMAGE_BASE64_LENGTH) return { error: `图片「${name}」超过 5MB 上限` };
      images.push({ name, mediaType: mediaType as TurnImageInput["mediaType"], data });
    }
    return { images };
  };

  /** 附件元数据校验（TASK-050 回显）：只收 name/kind/size，其余字段丢弃，≤6 条 */
  const pickAttachmentMeta = (
    raw: unknown
  ): Array<{ name: string; kind: "image" | "file"; size: number }> | undefined => {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const out: Array<{ name: string; kind: "image" | "file"; size: number }> = [];
    for (const item of raw.slice(0, 6)) {
      const o = (item ?? {}) as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.slice(0, 200) : "";
      const kind = o.kind === "image" ? "image" : "file";
      const size = typeof o.size === "number" && Number.isFinite(o.size) ? Math.max(0, Math.floor(o.size)) : 0;
      if (!name) continue;
      out.push({ name, kind, size });
    }
    return out.length > 0 ? out : undefined;
  };

  /** 只接受 http(s)：provider.baseUrl 会被服务端拿去发请求，file:// 等协议须挡在门外 */
  const isHttpUrl = (raw: string): boolean => {
    try {
      const u = new URL(raw);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };

  app.get("/api/settings/providers", async (c) => {
    const providers = await settingsRepo.providers.listProviders();
    const models = await settingsRepo.listProfiles();
    return c.json(
      providers.map((p) => ({
        ...sanitizeProvider(p),
        models: models
          .filter((m) => m.providerId === p.id)
          .map((m) => sanitizeModelProfile(m)),
      }))
    );
  });

  app.post("/api/settings/providers", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = pickProviderPatch(body);
    if (!fields.name) return c.json({ error: "供应商名称不能为空" }, 400);
    if (typeof fields.baseUrl === "string" && !isHttpUrl(fields.baseUrl)) {
      return c.json({ error: "API 基础地址只支持 http(s) 协议" }, 400);
    }
    const provider = await settingsRepo.providers.createProvider({
      name: fields.name as string,
      provider: (fields.provider as ProviderKind) ?? "custom",
      baseUrl: fields.baseUrl as string | undefined,
      apiKey: fields.apiKey as string | undefined,
      parameters: fields.parameters as ProviderEntity["parameters"],
    });
    return c.json(sanitizeProvider(provider), 201);
  });

  app.patch("/api/settings/providers/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = pickProviderPatch(body);
    // 与 POST 同规：显式传了 name 就必须是非空字符串（防 number 等脏类型被
    // pick 归一成 "" 后静默清空名称）
    if ("name" in body && !fields.name) {
      return c.json({ error: "供应商名称不能为空" }, 400);
    }
    if (typeof fields.baseUrl === "string" && !isHttpUrl(fields.baseUrl)) {
      return c.json({ error: "API 基础地址只支持 http(s) 协议" }, 400);
    }
    const updated = await settingsRepo.providers.updateProvider(id, fields);
    if (!updated) return c.json({ error: "Provider not found" }, 404);
    return c.json(sanitizeProvider(updated));
  });

  app.delete("/api/settings/providers/:id", async (c) => {
    const id = c.req.param("id");
    const cascade = c.req.query("cascade") === "true";
    const result = await settingsRepo.providers.deleteProvider(id, { cascade });
    if (!result.deleted) {
      if (result.reason === "not_found") return c.json({ error: "Provider not found" }, 404);
      // 仍挂着模型：提示前端确认后再带 cascade 重试，避免静默级联删除
      return c.json(
        {
          success: false,
          reason: result.reason,
          boundModels: result.boundModels,
          error: `该供应商下仍有 ${result.boundModels ?? "若干"} 个模型，请先迁移或显式级联删除`,
        },
        409
      );
    }
    return c.json({ success: true, removedModels: result.removedModels });
  });

  /**
   * 在指定供应商下新增模型：provider 类型与端点一律取自供应商，
   * 前端无法借建模型绕过凭证归层（也避免同一 provider 下模型各自带 baseUrl 的漂移）。
   */
  app.post("/api/settings/providers/:id/models", async (c) => {
    const providerId = c.req.param("id");
    const provider = await settingsRepo.providers.getProvider(providerId);
    if (!provider) return c.json({ error: "Provider not found" }, 404);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = pickModelPatch(body);
    if (!fields.name || !fields.model) {
      return c.json({ error: "模型名称与模型标识不能为空" }, 400);
    }
    const model = await settingsRepo.createProfile({
      name: fields.name as string,
      model: fields.model as string,
      providerId,
      provider: provider.provider,
      contextWindow: fields.contextWindow as number | undefined,
      capabilities: fields.capabilities as ModelCapabilities | undefined,
      parameters: fields.parameters as ModelProfileEntity["parameters"],
      isDefault: fields.isDefault as boolean | undefined,
    });
    return c.json(sanitizeModelProfile(model), 201);
  });

  /**
   * 拉取供应商可用模型列表（GET {baseUrl}/models）。
   *
   * 安全：端点取自服务端已存的 provider（不接受前端传入的 URL），凭证明文不出服务端；
   * 仅允许 http(s) 协议，避免被用作 file:// 或非 HTTP 协议的探测器。
   */
  app.get("/api/settings/providers/:id/models/discover", async (c) => {
    const providerId = c.req.param("id");
    const provider = await settingsRepo.providers.getProvider(providerId);
    if (!provider) return c.json({ error: "Provider not found" }, 404);

    // 默认端点取共享映射（provider-defaults）：完整覆盖各家官方端点，
    // 不再把 anthropic/deepseek/qwen 兜到 OpenAI 上
    const baseUrl = (provider.baseUrl || defaultBaseUrlFor(provider.provider)).replace(/\/+$/, "");

    if (!isHttpUrl(baseUrl)) {
      return c.json({ ok: false, endpoint: baseUrl, error: "API 基础地址只支持 http(s) 协议" }, 200);
    }
    const endpoint = `${baseUrl}/models`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (provider.apiKey) {
        // Anthropic 官方端点（默认或显式指向 anthropic.com）用 x-api-key；
        // 走自定义网关的 anthropic 兼容端点仍用 Bearer
        if (isAnthropicNativeEndpoint(baseUrl)) {
          headers["x-api-key"] = provider.apiKey;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers.Authorization = `Bearer ${provider.apiKey}`;
        }
      }
      const res = await fetch(endpoint, { headers, signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return c.json(
          { ok: false, endpoint, error: `HTTP ${res.status} ${text.slice(0, 200)}` },
          200
        );
      }
      const json = await res.json();
      // 能力探测：不同供应商的 /models 信息量差异极大（智谱只有 id，Kimi 带
      // context_length/supports_image_in/think_efforts），统一归一化后一并回传，
      // 前端选中模型即可自动填充能力标记，不必让用户手抄上下文窗口。
      const detected = detectModels(json);
      return c.json({
        ok: true,
        endpoint,
        /** 兼容字段：纯 id 列表（旧前端/脚本用） */
        models: detected.map((d) => d.id),
        /** 详细条目：含 displayName 与探测到的 capabilities */
        items: detected,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, endpoint, error: msg }, 200);
    } finally {
      clearTimeout(timeout);
    }
  });

  /**
   * 能力验证（TASK-057）：对档案勾选的能力逐项发最小探测请求，实测声明与
   * 端点真实行为是否一致（防手勾漂移）。信任边界与 discover/models-test 同源：
   * 服务端代发、端点取自已存配置、凭据不出服务端；用户显式点击才触发
   * （探测产生真实 API 费用，请求均带 max_tokens=1 压成本）。串行、单项 15s。
   */
  app.post("/api/settings/models/:id/verify-capabilities", async (c) => {
    const id = c.req.param("id");
    const raw = await settingsRepo.getProfile(id);
    if (!raw) return c.json({ error: "Profile not found" }, 404);
    const profile = await settingsRepo.hydrateProfile(raw);

    const baseUrl = (profile.baseUrl || defaultBaseUrlFor(profile.provider)).replace(/\/+$/, "");
    const isAnthropic = isAnthropicNativeEndpoint(baseUrl);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(profile.apiKey
        ? isAnthropic
          ? { "x-api-key": profile.apiKey, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${profile.apiKey}` }
        : {}),
    };
    const chatBody = (extra: Record<string, unknown>) =>
      isAnthropic
        ? { model: profile.model, max_tokens: 1, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], ...extra }
        : { model: profile.model, max_tokens: 1, messages: [{ role: "user", content: "hi" }], ...extra };

    /** 单项探测：ok（端点接受）/ fail（4xx 参数类拒绝 → 声明与实际不符）/ inconclusive（鉴权/网络，不代表能力） */
    const probe = async (
      capability: string,
      extra: Record<string, unknown>,
      rejectHint: RegExp
    ): Promise<{ capability: string; ok: boolean | null; detail: string }> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${baseUrl}${isAnthropic ? "/v1/messages" : "/chat/completions"}`, {
          method: "POST",
          headers,
          body: JSON.stringify(chatBody(extra)),
          signal: controller.signal,
        });
        if (res.ok) return { capability, ok: true, detail: "端点接受该能力参数" };
        const text = (await res.text().catch(() => "")).slice(0, 200);
        if (res.status === 401 || res.status === 403) {
          return { capability, ok: null, detail: `鉴权失败（${res.status}），无法判定能力：${text}` };
        }
        if (res.status >= 400 && res.status < 500 && rejectHint.test(text)) {
          return { capability, ok: false, detail: `端点拒绝该能力参数（HTTP ${res.status}）：建议取消勾选。${text}` };
        }
        return { capability, ok: null, detail: `HTTP ${res.status}：${text || "无响应体"}` };
      } catch (err: unknown) {
        return { capability, ok: null, detail: `探测失败：${err instanceof Error ? err.message : String(err)}` };
      } finally {
        clearTimeout(timer);
      }
    };

    const results: Array<{ capability: string; ok: boolean | null; detail: string }> = [];
    // 图片：发 1×1 PNG（OpenAI image_url / Anthropic image base64）
    if (profile.capabilities?.inputModalities?.includes("image")) {
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
      results.push(
        await probe(
          "image",
          isAnthropic
            ? { messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image", source: { type: "base64", media_type: "image/png", data: png } }] }] }
            : { messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } }] }] },
          /image|vision|modalit|multimodal|content.*type/i
        )
      );
    }
    // 推理档位：最低档 effort（effort 关键词被拒 → 声明与实际不符）
    const efforts = profile.capabilities?.reasoning?.supported
      ? profile.capabilities.reasoning.supportedEfforts
      : undefined;
    if (efforts?.length) {
      results.push(
        await probe("reasoning", isAnthropic ? { thinking: { type: "enabled", budget_tokens: 1024 } } : { reasoning_effort: efforts[0] }, /effort|reasoning|thinking|unsupported.*param|unknown.*parameter/i)
      );
    }
    if (results.length === 0) {
      return c.json({ results, note: "未勾选可探测能力（输出上限无法低成本验证），未发起请求" });
    }
    return c.json({ results });
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

    // 模型层探测：profileId 指向的模型可能把凭证存在所属供应商上，
    // 因此必须先 hydrate 再取 baseUrl/apiKey，否则从 provider 新建的模型一定探测失败。
    const rawProfile = body.profileId
      ? await settingsRepo.getProfile(String(body.profileId))
      : null;
    const storedProfile = rawProfile ? await settingsRepo.hydrateProfile(rawProfile) : null;

    // 供应商层探测：直接测该端点连通性（未指定模型时用列表首个模型或探测默认）
    const storedProvider = body.providerId
      ? await settingsRepo.providers.getProvider(String(body.providerId))
      : null;

    const endpoint = String(
      body.baseUrl ||
        storedProfile?.baseUrl ||
        storedProvider?.baseUrl ||
        process.env.OPENAI_BASE_URL ||
        "https://api.openai.com/v1"
    );
    const apiKey =
      body.apiKey ||
      storedProfile?.apiKey ||
      storedProvider?.apiKey ||
      process.env.OPENAI_API_KEY;
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
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const fields = pickModelPatch(body);
    // 显式传了 name/model 就必须非空（与 POST /providers/:id/models 同规）
    if (("name" in body && !fields.name) || ("model" in body && !fields.model)) {
      return c.json({ error: "模型名称与模型标识不能为空" }, 400);
    }
    const updated = await settingsRepo.updateProfile(id, fields);
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
