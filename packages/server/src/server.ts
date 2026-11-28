import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IStorageDriver } from "./storage/drivers/base.driver.js";
import type { RedisLike } from "./storage/drivers/redis.driver.js";
import { TurnLeaseManager } from "./core/turn-lease.js";
import type { LeaseOptions } from "./core/session-execution-hub.js";
import { pickNativeDirectory } from "./core/native-picker.js";
import { applySecurityBaseline, bearerMatches, BYO_FORBIDDEN_MESSAGE, isProfileSelectionOnly, resolveSecurityConfig, sanitizeForLog, sanitizeModelProfile, sanitizeProvider, secureEqual } from "./security.js";
import type { Context } from "hono";
import { MetricsRegistry, createOpsMetricsSink } from "./core/metrics-registry.js";
import { createRateLimitMiddleware, DEFAULT_RATE_LIMITS } from "./core/rate-limit.js";
import type { RateLimitOptions } from "./core/rate-limit.js";
import { createOtlpSink } from "./core/otlp-sink.js";
import { createOtlpTraceSink } from "./core/otlp-trace-sink.js";
import { createAdmissionPipeline } from "./core/admission.js";
import { buildFileTree } from "./core/workspace-files.js";
import type { ModelProfileEntity, SessionEntity } from "./storage/interfaces.js";
import { isProviderKind, toCheckpointMeta } from "./storage/interfaces.js";
import type { ModelCapabilities, ProviderEntity, ProviderKind } from "./storage/interfaces.js";
import { detectModels } from "./core/model-probe.js";
import { defaultBaseUrlFor, isAnthropicNativeEndpoint } from "./core/provider-defaults.js";
import { setCurrentTraceContext } from "./core/trace-context.js";
import { createSSEResponse } from "./core/sse-response.js";
import { createRedisActionPersist, createRedisEventLog } from "./core/redis-externalize.js";
import { createSqliteActionPersist } from "./storage/sqlite-action-persist.js";
import {
  validateCreateWorkspaceBody,
  validateCreateSessionBody,
  validateUpdateSessionBody,
  validateCreateModelProfileBody,
  isHttpUrl,
} from "./core/http-body-guards.js";
import type { TurnImageInput, HarnessTool, HarnessStreamEvent } from "./core/types.js";

/** 整数 env 读取：非法/缺省回落默认值；≤0 合法（=关闭对应作用域） */
function readIntEnv(key: string, fallback: number): number {
  const raw = Number((process.env[key] || "").trim());
  return Number.isFinite(raw) && raw >= 0 && Number.isInteger(raw) ? raw : fallback;
}

/** 当前协议版本（TASK-054 头；TASK-101 协商锚点） */
const PROTOCOL_VERSION = "1";

/**
 * 协议版本协商（TASK-101 + 审查 Optional 修复）：客户端显式携带 x-vuagent-protocol-version
 * 且与**主版本**不兼容 → 426 + Upgrade 头（RFC 9110 §10.12 建议 426 携带 Upgrade）
 * + 支持版本清单；主版本相同（"1.1" vs "1"）视为兼容放行（为协议升版留轨道）；
 * 未携带头 = 旧客户端，放行（兼容）。
 */
function negotiateProtocolOr426(c: { req: { header: (name: string) => string | undefined } }): Response | null {
  const requested = c.req.header("x-vuagent-protocol-version");
  if (!requested) return null;
  const reqMajor = requested.trim().split(".")[0] ?? "";
  if (reqMajor === PROTOCOL_VERSION.split(".")[0]) return null;
  return new Response(
    JSON.stringify({
      error: `协议版本不兼容：请求 ${requested.trim()}，服务端支持 ${PROTOCOL_VERSION}（主版本须一致）`,
      code: "PROTOCOL_VERSION_MISMATCH",
      supported: [PROTOCOL_VERSION],
    }),
    {
      status: 426,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-vuagent-protocol-version": PROTOCOL_VERSION,
        Upgrade: `vuagent-protocol/${PROTOCOL_VERSION}`,
      },
    }
  );
}

/** SSE 心跳间隔（TASK-090）：注释帧保活防反代空闲超时掐流；0=关闭 */
const SSE_HEARTBEAT_MS = readIntEnv("VUAGENT_SSE_HEARTBEAT_MS", 15_000);

/** SSE 指标回调装配（TASK-097）：连接开/关 + 事件类型计数（闭包持有 registry） */
function sseMetricsOf(registry: MetricsRegistry) {
  return {
    onOpen: () => registry.incCounter("vuagent_sse_active_connections"),
    onClose: () => registry.decGauge("vuagent_sse_active_connections"),
    onEvent: (type: string) => registry.incCounter("vuagent_sse_events_total", { type }),
  };
}

/**
 * HTTP 指标的路由模板归一（TASK-097）：参数化段的实际 id 归一为 ":id"，
 * 防标签基数爆炸（每个会话/工作区 id 一个样本行会撑爆 Prometheus）。
 * 兜底一律归一为常量 "unmatched"（审查 Required 修复：原「未知路由原样返回」
 * 会让扫描器的每个随机 404 路径成为常驻样本——路径稳定 ≠ 基数有界）。
 */
function httpRouteTemplate(c: { req: { path: string; routePath?: unknown } }): string {
  try {
    // hono 4.7：routePath 为 getter 属性（路由模板字符串）
    const rp: unknown = c.req.routePath;
    const routePath = typeof rp === "function" ? (rp as () => string)() : typeof rp === "string" ? rp : undefined;
    if (typeof routePath === "string" && routePath) return routePath;
  } catch {
    // routePath 不可用（极早中间件等）回落静态归一
  }
  const p = c.req.path;
  const dynamicRoots = ["sessions", "workspaces", "action", "actions", "providers", "models", "tools", "config"];
  const segments = p.split("/").filter(Boolean);
  // /api/<root>/<id>[...] → /api/<root>/:id[...]
  if (segments.length >= 3 && segments[0] === "api" && dynamicRoots.includes(segments[1])) {
    return `/api/${segments[1]}/:id${segments.length > 3 ? `/${segments.slice(3).join("/")}` : ""}`;
  }
  // /api/settings/providers/<id>[...] 与 /api/settings/models/<id>[...]
  if (segments.length >= 4 && segments[0] === "api" && segments[1] === "settings") {
    const third = segments[2];
    if (third === "providers" || third === "models") {
      return `/api/settings/${third}/:id${segments.length > 4 ? `/${segments.slice(4).join("/")}` : ""}`;
    }
  }
  // /metrics 与其余未匹配 404 路径：无既有模板可归一 → 常量标签（基数有界）
  return "unmatched";
}

/**
 * 外呼探测错误回显截断：provider 报错语义是能力判定特征（TASK-080 依赖原文
 * 指向被测参数），故保留原文口径不收口——仅封顶长度，防极端响应体撑爆
 * 响应与 NDJSON 日志。与全局 onError 的「内部异常不外泄」口径互补：
 * 这里回显的是**外呼目标**（用户自配 baseUrl）返回的错误，非内部基础设施信息。
 */
function clipExternalError(msg: string, max: number = 500): string {
  return msg.length > max ? `${msg.slice(0, max)}…[+${msg.length - max} 字符]` : msg;
}
import { SQLiteStorageDriver } from "./storage/drivers/sqlite.driver.js";
import { MemoryStorageDriver } from "./storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "./storage/repositories/workspace.repository.js";
import { SessionRepository } from "./storage/repositories/session.repository.js";
import { CheckpointRepository } from "./storage/repositories/checkpoint.repository.js";
import { SettingsRepository } from "./storage/repositories/settings.repository.js";
import { ToolConfigRepository } from "./storage/repositories/tool-config.repository.js";
import { HarnessConfigRepository } from "./storage/repositories/harness-config.repository.js";
import { CONFIG_SCHEMA, getNamespaceSchema } from "./core/config-schema.js";
import { ConfigResolver, isEnvLocked, resolveNamespaceValues, validateNamespacePatch } from "./core/config-resolver.js";
import { ToolRegistry } from "./core/tool-registry.js";
import { ActionHub } from "./core/action-hub.js";
import { AgentLoop } from "./core/agent-loop.js";
import {
  ContextCompactor,
  sanitizeMessagesForCheckpoint,
  type ChatMessage,
} from "./core/context-compactor.js";
// TASK-090：SSE 序列化收口至 core/sse-response.ts（server.ts 不再直接消费 StreamOrchestrator）
import { SessionExecutionHub } from "./core/session-execution-hub.js";
import type { CheckpointEntity, TurnEntity } from "./storage/interfaces.js";
import type { IModelDriver } from "./adapters/model-driver.js";
import { OpenAICompatibleDriver } from "./adapters/openai-driver.js";
import { FsEditTool, FsReadTool, FsWriteTool } from "./tools/system/fs-tools.js";
import { BashRunTool, createBashRunTool } from "./tools/system/bash-tool.js";
import { GlobTool, GrepTool } from "./tools/system/search-tools.js";
import { FinishTaskTool } from "./tools/system/finish-task-tool.js";
import { createWebFetchTool } from "./tools/web/web-tools.js";
import { createWebSearchTool, resolveSearchConfig } from "./tools/web/search-tools.js";
import { McpHostService } from "./core/mcp-host.js";
import { AllBuiltinTools } from "./tools/ui/protocol-tools.js";
import { recoverInterruptedTurns } from "./core/recovery.js";
import {
  createConsoleNdjsonSink,
  compositeSink,
  shouldLog,
  type HarnessEventSink,
  type HarnessOpsCode,
} from "./core/event-sink.js";
import { ModelPricingTable, computeCostUsd, type ModelPricing } from "./core/pricing-table.js";
import { CostRecordRepository } from "./storage/repositories/cost-record.repository.js";
import type { UIComponentDefinition } from "@vuagent/protocol";
import type { UIActionEnvelope } from "@vuagent/protocol";
import { UIComponentRegistry } from "./core/ui-registry.js";
import {
  parseActionEnvelope,
  UIActionParseError,
  validateEnvelopeValues,
  hashEnvelope,
  decisionPayloadHash,
  resolveInteractionResultSchema,
} from "./core/action-envelope.js";
import {
  InMemorySecretStore,
  stripSecretFieldValues,
  type SecretStore,
} from "./core/secret-store.js";
import { PatchStash } from "./core/patch-stash.js";

/**
 * 4 把核心原子系统工具（对齐 Pi coding agent 极简内核）
 */
export const CoreSystemTools = [
  FsReadTool,
  FsWriteTool,
  FsEditTool,
  BashRunTool,
] as const;

export interface ServerOptions {
  storageDriver?: IStorageDriver;
  /**
   * 原生文件夹选择器的实现覆盖（测试注入用）。
   * 默认 `pickNativeDirectory()`：按平台调 osascript / PowerShell / zenity。
   */
  pickDirectory?: () => Promise<import("./core/native-picker.js").PickerOutcome>;
  modelDriver?: IModelDriver;
  dbPath?: string;
  /** 本副本实例标识（Redis 租约形态的归属与清扫目标）；缺省 VUAGENT_INSTANCE_ID > os.hostname() */
  instanceId?: string;
  /** 跨副本轮次租约客户端（Redis 形态）；提供后同会话全集群互斥 + 心跳保活 + 启动清扫 */
  redisClient?: RedisLike;
  /** 安全基线覆盖项（测试注入用）；缺省走 VUAGENT_* 环境变量 */
  security?: { authToken?: string; allowByoProvider?: boolean; extraOrigins?: string[] };
  /** 限流规则覆盖（TASK-088，编程注入优先于 env）；缺省 env > 默认 240/12 每分钟，limit=0 关闭 */
  rateLimit?: RateLimitOptions;
  /** 运维事件出口（TASK-051）：缺省 console NDJSON；测试注入内存 sink 断言事件流 */
  eventSink?: HarnessEventSink;
  /** 计价表来源（TASK-052）：JSON 文件路径或内存表；缺省 `${cwd}/config/model-pricing.json`（缺失=只记量不记钱） */
  pricingPath?: string;
  pricingTable?: Record<string, ModelPricing>;
  /**
   * MCP server 连接配置（0.9.0 W1）：mcp.json 路径（CLI 传 dataDir/config/mcp.json）。
   * 缺省不传 = 不启用 MCP（库形态诚实行为）；文件存在但无 mcpServers = 空配置（懒启动零开销）。
   */
  mcpConfigPath?: string;
  /** 开放场景 UI 组件定义（由 UIComponentRegistry 管理并注册为模型工具与前端卡片契约） */
  customUIComponents?: UIComponentDefinition[];
  /** 自定义 UI 注册中心（可选显式注入） */
  uiRegistry?: UIComponentRegistry;
  /**
   * console 静态托管（0.7.0 CLI 形态）：传入即挂载「/assets/* 长缓存静态 +
   * SPA fallback 回 index.html」；缺省不托管（仅 /api/*，库形态行为不变）。
   * 安全边界：外层绑定闸门（resolveBindPlan）已保证对外绑定必须配 VUAGENT_TOKEN，
   * 本选项不做二次校验——CLI 在 unsafeExempted 时会显著提示 console 已对内网开放。
   */
  console?: {
    /** console 静态资源目录（vite build 产物，须含 index.html） */
    dir: string;
    /** SPA 入口文件，默认 index.html */
    entry?: string;
    /** /assets/* 是否加 immutable 长缓存（vite 产物带内容哈希；默认 true） */
    immutableAssets?: boolean;
  };
  /** 自定义业务动作工具（非 UI 契约的函数/动作工具） */
  customTools?: HarnessTool[];
  /**
   * 敏感值存储（TASK-092，设计文档 §5 宿主注入点）：表单 secret 字段的真实值归属。
   * 缺省进程内存形态（与 ActionHub 内存挂起的单机语义对齐，重启即失效）；
   * Redis 形态（多副本共享/重启可还原）留作后续任务尾巴——实现同一契约即可替换。
   */
  secretStore?: SecretStore;
}

export const defaultSceneComponents: UIComponentDefinition[] = [
  {
    name: "ui_deploy_status",
    title: "微服务部署与巡检卡片",
    description: "渲染微服务部署进展与健康巡检的专用可视化卡片",
    schema: Type.Object({
      serviceName: Type.String({ description: "服务名称，例如 auth-service" }),
      environment: Type.Union([
        Type.Literal("staging"),
        Type.Literal("production"),
        Type.Literal("preview"),
      ], { description: "部署环境" }),
      version: Type.String({ description: "版本号，例如 v2.4.1" }),
      status: Type.Union([
        Type.Literal("deploying"),
        Type.Literal("healthy"),
        Type.Literal("degraded"),
        Type.Literal("failed"),
      ], { description: "服务健康状态" }),
      endpoints: Type.Optional(Type.Array(Type.String(), { description: "服务访问端点列表" })),
      metrics: Type.Optional(
        Type.Object({
          cpu: Type.Optional(Type.String({ description: "CPU 负载" })),
          memory: Type.Optional(Type.String({ description: "内存使用" })),
          replicas: Type.Optional(Type.String({ description: "副本状态，例如 4/4 Ready" })),
        })
      ),
      commit: Type.Optional(
        Type.Object({
          hash: Type.Optional(Type.String({ description: "提交哈希" })),
          message: Type.Optional(Type.String({ description: "提交说明" })),
          author: Type.Optional(Type.String({ description: "提交作者" })),
        })
      ),
    }),
  },
];

export function createHarnessServer(options: ServerOptions = {}) {
  const app = new Hono<{ Variables: { requestId: string } }>();

  // TASK-089：安全响应头（Hono 内建 nosniff / frame 防嵌套等，零配置默认档）
  app.use("*", secureHeaders());

  // TASK-089：请求 ID 生成/透传——贯穿错误信封与服务端日志，客户端报障可对账。
  // 客户端提供的 ID 须过白名单（长度 ≤64、字符集受限）——原样采信可注入任意长
  // 日志噪声与伪造对账 id（审查 Optional 修复）。
  const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
  app.use("/api/*", async (c, next) => {
    const provided = c.req.header("x-request-id") || "";
    const requestId = CLIENT_REQUEST_ID_RE.test(provided) ? provided : `req-${randomUUID().slice(0, 8)}`;
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });

  // TASK-089：全局错误收口——handler 抛错统一 500 信封，err.message 不外泄
  // （原样回传可能携带内部路径/密钥样字符串）；详情进 NDJSON 带 requestId 供排查。
  app.onError((err, c) => {
    const requestId = c.get("requestId") ?? "req-unknown";
    console.error(
      JSON.stringify({
        level: "error",
        code: "UNHANDLED_ERROR",
        requestId,
        method: c.req.method,
        path: c.req.path,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    );
    return c.json({ error: "服务器内部错误（详情见服务端日志）", code: "INTERNAL_ERROR", requestId }, 500);
  });

  // TASK-089：404 统一信封（此前落 Hono 默认 404 text，响应格式不一致）
  app.notFound((c) => c.json({ error: `Not Found: ${c.req.method} ${c.req.path}`, code: "NOT_FOUND" }, 404));
  // TASK-051 运维事件出口：缺省 console NDJSON（error 级走 stderr）
  // 可观测出口（三轨 composite，注入 sink 的宿主/测试仍整链接管）：
  // ① console NDJSON（运维日志）；② Prometheus 指标注册表（GET /metrics 拉取）；
  // ③ 可选 OTLP HTTP JSON 推送（OTEL_EXPORTER_OTLP_ENDPOINT 配置启用）
  const metricsRegistry = new MetricsRegistry();

  // TASK-097：进程级指标——eventloop 延迟周期采样（1s，unref 不阻退出），
  // 内存快照走抓取时采集器（无定时器常驻）
  {
    const eventloopTimer = setInterval(() => {
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const lagMs = Number(process.hrtime.bigint() - start) / 1e6;
        metricsRegistry.setGauge("vuagent_eventloop_lag_ms", Math.round(lagMs * 100) / 100);
      });
    }, 1_000);
    eventloopTimer.unref?.();

    metricsRegistry.setGaugeCollector("vuagent_process_heap_bytes", () => [
      { value: process.memoryUsage().heapUsed },
    ]);
    metricsRegistry.setGaugeCollector("vuagent_process_rss_bytes", () => [
      { value: process.memoryUsage().rss },
    ]);
  }

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  // TASK-098：可选 OTLP traces 推送（独立端点变量；未配置零开销——不创建 sink）
  const otlpTracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const eventSink: HarnessEventSink = options.eventSink ?? compositeSink(
    createConsoleNdjsonSink(),
    createOpsMetricsSink(metricsRegistry),
    ...(otlpEndpoint
      ? [createOtlpSink({ endpoint: otlpEndpoint, serviceName: "vuagent-server" })]
      : []),
    ...(otlpTracesEndpoint
      ? [createOtlpTraceSink({ endpoint: otlpTracesEndpoint, serviceName: "vuagent-server" })]
      : [])
  );
  // 安全基线（TASK-011）：CORS/Origin 白名单 + 可选 Bearer 鉴权，替代原先 cors() 全开。
  // 注意装配顺序：限流与 bodyLimit 先于本函数注册（见下），鉴权失败/超限请求
  // 都必须在中间件层可见。
  const security = resolveSecurityConfig(options.security);

  // 限流（TASK-088 + 审查 Critical 修复）：**必须注册在鉴权之前**——原「鉴权之后
  // 计数」口径下，错令牌被鉴权中间件 401 短路，限流器永远看不到爆破流量；
  // 且旧 key 含请求方令牌指纹，每次错误猜测都是新桶（计数归 1）。现口径：
  // 无效/缺失令牌共享 IP 桶，仅有效令牌进指纹分桶；X-Forwarded-For 默认不采信
  // （直连可伪造），显式 VUAGENT_TRUST_PROXY=1（反代形态）才取 XFF 末段。
  const rateLimits = options.rateLimit ?? {
    global: {
      windowMs: DEFAULT_RATE_LIMITS.global.windowMs,
      limit: readIntEnv("VUAGENT_RATE_LIMIT_GLOBAL", DEFAULT_RATE_LIMITS.global.limit),
    },
    probe: {
      windowMs: DEFAULT_RATE_LIMITS.probe.windowMs,
      limit: readIntEnv("VUAGENT_RATE_LIMIT_PROBE", DEFAULT_RATE_LIMITS.probe.limit),
    },
  };
  app.use(
    "/api/*",
    createRateLimitMiddleware({
      ...rateLimits,
      trustProxy: ["1", "true"].includes((process.env.VUAGENT_TRUST_PROXY || "").trim().toLowerCase()),
      isValidToken: security.authToken
        ? (token) => secureEqual(token, security.authToken)
        : undefined,
    })
  );

  // TASK-087/084：请求体上限（审查 Required 修复：**必须注册在所有路由之前**——
  // Hono 后注册的中间件不包裹先注册的终态 handler，原注册点在 PATCH /api/tools/:name
  // 与 PATCH /api/config/:namespace 之后，两条路由静默绕过 1MB 上限，无界请求体
  // 全量进内存恰是本闸门要堵的 DoS 面）。实例提升为常量（原闭包每请求重建）。
  const globalApiBodyLimit = bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: "请求体过大（上限 1MB）", code: "PAYLOAD_TOO_LARGE" }, 413),
  });
  const chatBodyLimit = bodyLimit({
    maxSize: 32 * 1024 * 1024,
    onError: (c) =>
      c.json(
        { error: "请求体过大（上限 32MB）：请压缩图片或减少单次附件数量", code: "PAYLOAD_TOO_LARGE" },
        413
      ),
  });
  // 其余 /api/* 全局 1MB（解析前拦截）。workspaces/sessions/providers/models/config
  // 等实体路由 payload 均为小 JSON，1MB 已富余；/api/chat* 跳过（下方 32MB 专属
  // 上限接管），避免链式叠加后 1MB 误杀图片大载荷。
  app.use("/api/*", (c, next) => {
    if (c.req.path === "/api/chat" || c.req.path.startsWith("/api/chat/")) return next();
    return globalApiBodyLimit(c, next);
  });
  // /api/chat 请求体硬上限：视觉通道让多 MB base64 载荷常态化（4 张 ×5MB 解码
  // ≈ base64 26.7MB + prompt/JSON 开销），32MB 兼容满载图片请求。
  app.use("/api/chat", chatBodyLimit);

  // 入站 traceparent 解析（TASK-098 基建接线）：写入 AsyncLocalStorage 供出站
  // LLM 请求注入 traceparent 与 otlp-trace-sink 根 span 关联；非法/缺失静默跳过
  app.use("/api/*", (c, next) => {
    setCurrentTraceContext(c.req.header("traceparent"));
    return next();
  });

  applySecurityBaseline(app, security);

  // 统一请求日志中间件 (TASK: 服务端日志增强)
  app.use("/api/*", async (c, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    await next();
    const duration = Date.now() - start;
    const status = c.res.status;
    // TASK-097：HTTP 指标（route 用路由模板防标签基数爆炸）
    const route = httpRouteTemplate(c);
    metricsRegistry.incCounter("vuagent_http_requests_total", {
      method,
      route,
      status: String(status),
    });
    metricsRegistry.observeHistogram("vuagent_http_request_duration_ms", duration, { route });
    // TASK-089/096：日志行携带 requestId，与 x-request-id 响应头对账；LOG_LEVEL 门控
    if (shouldLog("info")) {
      console.log(
        `[Vuagent Server] ${method} ${path} -> ${status} (${duration}ms) req=${c.get("requestId")}`
      );
    }
  });

  // 1. 初始化存储层
  const driver: IStorageDriver =
    options.storageDriver ||
    (options.dbPath === ":memory:"
      ? new MemoryStorageDriver()
      : new SQLiteStorageDriver(options.dbPath || ":memory:"));

  /** 原生选择框单飞标志：两个浏览器标签同时点「新建工作区」不应叠两个系统对话框 */
  let pickerInFlight = false;

  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  // W2 拆行存储：checkpoint 独立集合（append-only 快照），读路径无论写模式都可用
  const checkpointsRepo = new CheckpointRepository(driver);
  const settingsRepo = new SettingsRepository(driver);
  const toolConfigRepo = new ToolConfigRepository(driver);
  // 配置中心（TASK-024）：分层配置的存储与解析门面（无缓存，PATCH 即生效）
  const harnessConfigRepo = new HarnessConfigRepository(driver);
  const configResolver = new ConfigResolver(harnessConfigRepo);

  // TASK-052 成本台账：计价表（缺省 config/model-pricing.json，缺失=只记量不记钱）+ 台账仓储
  const costRepo = new CostRecordRepository(driver);
  const pricingTable = new ModelPricingTable(options.pricingTable ?? options.pricingPath);

  // TASK-093：台账保留策略——启动时修剪过期记录（缺省 30 天，0=不清理；fire-and-forget）
  const costRetentionDays = readIntEnv("VUAGENT_COST_RETENTION_DAYS", 30);
  if (costRetentionDays > 0) {
    void costRepo
      .pruneBefore(Date.now() - costRetentionDays * 24 * 60 * 60 * 1000)
      .catch(() => {
        // fail-open：修剪失败不影响启动
      });
  }

  // 2. 初始化核心组件与工具注册中心
  const toolRegistry = new ToolRegistry();
  for (const t of CoreSystemTools) {
    // TASK-088：bash_run 以下方配置中心驱动的工厂注册（环境策略运行中生效），跳过静态注册
    if (t === BashRunTool) continue;
    toolRegistry.register(t);
  }
  toolRegistry.register(
    createBashRunTool(async () => {
      // envLock 的 env 值不经选项校验直通（config-resolver 口径），此处防御性归一：非法值 fail-closed 回落 safe
      const tools = await configResolver.resolve("tools");
      const raw = tools?.bashEnvPolicy;
      return raw === "inherit" || raw === "strict" ? raw : "safe";
    })
  );
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
  // web_search（0.9.0 W2）：有可用搜索 key（env）才注册——工具不存在就不进
  // 启停页/模型 definitions，比「注册 + hideTools」更诚实；无 key 时 web_fetch
  // 描述里的「如已配置」语义保持准确
  const searchConfig = resolveSearchConfig();
  if (searchConfig) {
    toolRegistry.register(createWebSearchTool(searchConfig.provider));
  }

  // MCP server 接入（0.9.0 W1）：文件存在才构造；连接懒启动（fire-and-forget，
  // 连上即 register 进 registry，definitions 每次 toModelToolDefinitions 现取——
  // 工具稍后出现但不阻塞服务启动）。库形态不传 mcpConfigPath = 不启用 MCP。
  let mcpHost: McpHostService | null = null;
  if (options.mcpConfigPath && fs.existsSync(options.mcpConfigPath)) {
    mcpHost = new McpHostService({
      configPath: options.mcpConfigPath,
      register: (tool) => toolRegistry.register(tool),
      unregister: (name) => toolRegistry.remove(name),
      clientVersion: "0.9.0",
    });
    void mcpHost.ensureConnected().catch(() => {
      // 全体连接失败的兜底：各 server 错误已在 status 里，启动不打断
    });
  }
  for (const t of AllBuiltinTools) {
    toolRegistry.register(t);
  }

  // 开放场景 UI 组件注册中心 (UIComponentRegistry)
  const uiRegistry = options.uiRegistry ?? new UIComponentRegistry();
  for (const def of defaultSceneComponents) {
    uiRegistry.register(def);
  }
  if (options.customUIComponents) {
    for (const def of options.customUIComponents) {
      uiRegistry.register(def);
    }
  }
  for (const t of uiRegistry.toHarnessTools()) {
    toolRegistry.register(t);
  }

  // 业务自定义动作工具（由使用方通过 options.customTools 显式注册）
  const customToolNames = new Set<string>();
  if (options.customTools) {
    for (const t of options.customTools) {
      toolRegistry.register(t);
      customToolNames.add(t.name);
    }
  }

  // TASK-100：Redis 形态外置——挂起持久化（审批跨重启可落账/回写）与事件缓冲 ring；
  // SQLite 单机形态（送达后幂等尾巴）注入决策落账外置（storage/sqlite-action-persist.ts，
  // 挂起维持内存态）——送达后的重复 POST 由 prior 命中幂等返回，不再回落兜底扫描 404。
  const actionPersist = options.redisClient
    ? createRedisActionPersist(options.redisClient)
    : driver instanceof SQLiteStorageDriver
      ? createSqliteActionPersist(driver.database)
      : undefined;
  const actionHub = new ActionHub(actionPersist);
  // Phase 3（L3 patch 运行时）：协作组件增量编辑的内存暂存——patch 不唤醒协程、
  // 不落账、不进模型上下文（设计文档 §3/§8），只在终态（submit/cancel/超时/
  // 孤儿落账）以合并值进入摘要与落账信封。超时裁决路径经 ActionHub 终态钩子
  // 清理（该路径无 HTTP 请求上下文）；其余遗留靠容量逐出惰性兜底。
  const patchStash = new PatchStash();
  actionHub.onPendingSettled = (actionId) => patchStash.delete(actionId);
  // 注意（评审 N-1 的谨慎结论）：secret 明文 purge **不**挂 settle——决策到达时
  // 工具尚未执行，ref 还原消费点在执行时；此处清理会让执行点拿到 undefined。
  // InMemorySecretStore 已提供 purgeByAction(actionId)，宿主可在「轮次终结」
  // 时机（turn 收尾/会话关闭）自行调用；默认实现不自动清理并在文件头声明取舍。
  // TASK-092：敏感值通道（设计文档 §5）——secret 字段真实值的唯一归属，
  // 模型上下文/台账/落库只见 { ref, masked } 占位（路由边界 stripSecretFieldValues 剥离）
  const secretStore: SecretStore = options.secretStore ?? new InMemorySecretStore();
  // TASK-008：压缩器单例，AgentLoop（自动滑动窗口）与会话压缩接口（手动摘要化）共用裁剪口径
  const compactor = new ContextCompactor();
  // 模型驱动透传（宿主/测试注入用）；缺省由 AgentLoop 按所选模型档案逐轮构造，
  // 生产路径不再默认构造占位驱动（与 agent-loop 逐档案构造口径一致）
  const modelDriver = options.modelDriver;

  const agentLoop = new AgentLoop({
    workspaceRepo,
    sessionRepo,
    checkpointsRepo,
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
      // 分档计价（能力运行时 P1）：缓存读取/写入与推理 token 按各自单价折算
      const costUsd = pricing
        ? computeCostUsd(pricing, entry.promptTokens, entry.completionTokens, {
            cachedPromptTokens: entry.cachedTokens,
            cacheCreationTokens: entry.cacheCreationTokens,
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
  const executionHub = new SessionExecutionHub(agentLoop, eventSink, lease, {
    eventLog: options.redisClient ? createRedisEventLog(options.redisClient) ?? undefined : undefined,
  });

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
  // Bearer 令牌（与 /api/* 同一口径，Prometheus scrape 配置 bearer_token 即可）。
  // 鉴权判定复用 security.ts 的 bearerMatches（原手写副本存在漂移风险）；
  // Origin 主动拒绝已由 applySecurityBaseline 对 /metrics 同口径注册（防无令牌
  // 模式下 DNS-rebinding 同源读取运维指标）。
  app.get("/metrics", (c) => {
    const security = resolveSecurityConfig(options.security);
    if (security.authToken && !bearerMatches(c.req.header("Authorization") || "", security.authToken)) {
      return c.json({ error: "Unauthorized: /metrics 需要 Bearer 令牌（VUAGENT_TOKEN）" }, 401);
    }
    return c.text(metricsRegistry.renderPrometheus(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  // 健康探针
  app.get("/api/health", async (c) => {
    const base = {
      status: "ok",
      timestamp: Date.now(),
      registeredToolsCount: toolRegistry.list().length,
      suspendedActionsCount: actionHub.listSuspended().length,
    };
    // TASK-096：deep=1 = readiness 深度探测（依赖连通性），默认浅探 = liveness。
    // detail 收口（审查 Required 修复）：驱动层 err.message 可能含 sqlite 文件路径/
    // redis 主机与连接错误原文，而 health 免鉴权免限流（可被无限制反复触发）——
    // 原因明细只进服务端日志（带 requestId 对账），响应只给泛化 detail。
    if (c.req.query("deep") !== "1") return c.json(base);
    const requestId = c.get("requestId") ?? "req-unknown";

    const checks: Record<string, { ok: boolean; latencyMs: number; detail?: string }> = {};
    const probe = async (name: string, fn: () => Promise<unknown>) => {
      const start = Date.now();
      try {
        await fn();
        checks[name] = { ok: true, latencyMs: Date.now() - start };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          JSON.stringify({
            level: "warn",
            code: "HEALTH_PROBE_FAILED",
            requestId,
            component: name,
            detail: reason,
          })
        );
        checks[name] = { ok: false, latencyMs: Date.now() - start, detail: "探测失败（原因见服务端日志）" };
      }
    };
    // 存储驱动连通性（泛型 get 探针——sqlite prepare / memory / redis GET 均覆盖）
    await probe("db", () => driver.get("__health_probe__", "noop"));
    if (options.redisClient) {
      await probe("redis", async () => {
        const client = options.redisClient as unknown as { ping?: () => Promise<unknown> };
        if (typeof client.ping === "function") await client.ping();
        else await options.redisClient!.get("__health_probe__");
      });
    }
    const degraded = Object.values(checks).some((check) => !check.ok);
    return c.json({ ...base, status: degraded ? "degraded" : "ok", checks }, degraded ? 503 : 200);
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
        const isUI = uiRegistry.get(t.name) !== undefined;
        const isCustom = customToolNames.has(t.name);
        const source: "builtin" | "ui_component" | "custom" = isUI
          ? "ui_component"
          : isCustom
          ? "custom"
          : "builtin";
        return {
          name: t.name,
          description: t.description,
          riskLevel: t.riskLevel ?? "medium",
          writesWorkspace: t.writesWorkspace === true,
          requiresApproval: derivedApproval || cfg?.requiresApproval === true,
          enabled: cfg?.enabled !== false,
          timeoutMs: cfg?.timeoutMs ?? null,
          source,
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

  // TASK-087/084 的 bodyLimit 已前移至鉴权前统一注册（见中间件装配段）——
  // 此处原注册点在 PATCH 路由之后会使那两条路由绕过上限，已删除。

  // 核心对话流式接口 (SSE，委托 SessionExecutionHub 独立生命周期)
  // 会话级成本聚合（TASK-056 会话徽标数据源，一次批量避免逐会话 N+1）。
  // 与 summary 同域挂 finops 命名空间；窗口钳制 [1min, 30d]，默认 24h
  app.get("/api/finops/by-session", async (c) => {
    const raw = Number(c.req.query("windowMs"));
    const windowMs =
      Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(Math.floor(raw), 60_000), 30 * 24 * 3_600_000) : 86_400_000;
    return c.json({ windowMs, bySession: await costRepo.sumWindowBySession(windowMs) });
  });

  app.post("/api/chat", async (c) => {
    // TASK-101：协议版本协商（显式头且不兼容 → 426）
    const mismatch = negotiateProtocolOr426(c);
    if (mismatch) return mismatch;
    const body = await c.req.json().catch(() => ({}));
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

    // 默认工作区兜底（若前端传入但不存在于库中，则自动初始化持久化）
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
    } else {
      const existingWs = await workspaceRepo.get(workspaceId);
      if (!existingWs) {
        const defaultWs = await workspaceRepo.create({
          id: workspaceId,
          name: "Default Workspace",
          rootPath: process.cwd(),
          permission: "read-write",
        });
        workspaceId = defaultWs.id;
      }
    }

    // 默认会话兜底（若前端指定了自定义 sessionId 但尚未入库，自动补充建档）
    let sessionId = body.sessionId;
    if (!sessionId) {
      const newSess = await sessionRepo.create({
        workspaceId,
        title: prompt.slice(0, 30),
      });
      sessionId = newSess.id;
    } else {
      const existingSess = await sessionRepo.get(sessionId);
      if (!existingSess) {
        const newSess = await sessionRepo.create({
          id: sessionId,
          workspaceId,
          title: prompt.slice(0, 30),
        });
        sessionId = newSess.id;
      }
    }

    console.log(
      `[Vuagent Server] /api/chat: prompt="${prompt.slice(0, 60)}" | session=${sessionId} | workspace=${workspaceId}`
    );

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
      // TASK-089：详情只进服务端日志，不再把 err.message 原样回传客户端
      return serverError(c, "CHAT_SUBMIT_FAILED", err);
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
    // 事件缓冲在 run.events 中，subscribe 从头重放保证顺序完整）。
    // TASK-090：改走 createSSEResponse（心跳注释帧保活 + 订阅先行缓冲）；
    // 新开轮次无重连语义，fromSeq 不适用（全量重放缓冲）。
    return createSSEResponse({
      signal: c.req.raw.signal,
      heartbeatMs: SSE_HEARTBEAT_MS,
      metrics: sseMetricsOf(metricsRegistry),
      attach: (pump) => {
        const sub = executionHub.subscribeFromSeq(sessionId, pump);
        if (!sub) return null;
        // 当单次 HTTP 请求断开（如前端切换会话），仅退订事件流，后台 Agent 执行绝不中断
        return { unsubscribe: sub.unsubscribe, replayMode: sub.replayMode };
      },
      extraHeaders: {
        // TASK-054：协议版本头（增量重连/跨端协商的锚点）
        "x-vuagent-protocol-version": "1",
      },
    });
  });

  // 中止正在运行的会话轮次
  app.post("/api/chat/abort", async (c) => {
    const mismatch = negotiateProtocolOr426(c);
    if (mismatch) return mismatch;
    const body = await c.req.json().catch(() => ({}));
    const sessionId = body.sessionId;
    const ok = executionHub.abort(sessionId);
    return c.json({ success: ok });
  });

  app.post("/api/sessions/:id/abort", async (c) => {
    const mismatch = negotiateProtocolOr426(c);
    if (mismatch) return mismatch;
    const sessionId = c.req.param("id");
    const ok = executionHub.abort(sessionId);
    return c.json({ success: ok });
  });

  // 断点重连 / 切换回会话 / 页面刷新后重新连入会话事件流
  // TASK-090：消费 Last-Event-ID 头（SSE 标准重连寻址）或 ?fromSeq= 查询参数，
  // 按 seq 增量重放未读事件；缺口（缓冲淘汰）诚实回退全量并以 x-vuagent-replay: full 标注。
  app.get("/api/sessions/:id/stream", async (c) => {
    // TASK-101：协议版本协商（显式头且不兼容 → 426）
    const mismatch = negotiateProtocolOr426(c);
    if (mismatch) return mismatch;
    const sessionId = c.req.param("id");
    // fromSeq 解析前置（TASK-100 外置回放预检也需要）
    const lastEventId = Number.parseInt(c.req.header("Last-Event-ID") || "", 10);
    const fromQuery = Number.parseInt(c.req.query("fromSeq") || "", 10);
    const fromSeq = Number.isFinite(lastEventId) && lastEventId >= 0
      ? lastEventId
      : Number.isFinite(fromQuery) && fromQuery >= 0
        ? fromQuery
        : undefined;

    const activeRun = executionHub.getActiveRun(sessionId);
    if (!activeRun || activeRun.isDone) {
      // TASK-100：无活跃 run 但带 fromSeq 且外置缓冲存在 → 回放中断前增量后收尾
      //（轮次本身已随重启中断，诚实语义：重放历史 + DONE，不假装活跃）
      // 缺口诚实回退（审查 Optional 修复，对齐内存缓冲语义）：ring 被裁剪/
      // 过期导致 seq 不连续时，从 ring 头全量重放并标 full——客户端「首条
      // seq > fromSeq+1 静默缺失且无从察觉」的 partial 不再出现。
      const eventLog = executionHub.getEventLog();
      let buffered: HarnessStreamEvent[] = [];
      let replayMode: "full" | "partial" = "partial";
      if (eventLog && fromSeq !== undefined) {
        const { events, gap } = await eventLog.readAfter(sessionId, fromSeq);
        if (gap) {
          // 缺口（ring 裁剪/过期/seq 越界）：从 ring 头全量重放——不判 events.length，
          // fromSeq 越界而 ring 有事件时同样回退（否则仍会静默丢缓冲）
          const fromHead = await eventLog.readAfter(sessionId, 0);
          buffered = fromHead.events;
          replayMode = "full";
        } else {
          buffered = events;
        }
      }
      if (buffered.length === 0) {
        return c.json({ isRunning: false }, 200);
      }
      return createSSEResponse({
        signal: c.req.raw.signal,
        heartbeatMs: SSE_HEARTBEAT_MS,
        metrics: sseMetricsOf(metricsRegistry),
        attach: (pump) => {
          for (const event of buffered) pump(event as HarnessStreamEvent);
          pump("[DONE]");
          return { unsubscribe: () => {}, replayMode };
        },
        extraHeaders: {
          "x-vuagent-protocol-version": "1",
          // 历史补看标注：客户端可据此区分「活跃直播」与「中断后补看」
          "x-vuagent-history-only": "1",
        },
      });
    }

    return createSSEResponse({
      signal: c.req.raw.signal,
      heartbeatMs: SSE_HEARTBEAT_MS,
      metrics: sseMetricsOf(metricsRegistry),
      attach: (pump) => {
        const sub = executionHub.subscribeFromSeq(sessionId, pump, fromSeq);
        if (!sub) return null;
        return { unsubscribe: sub.unsubscribe, replayMode: sub.replayMode };
      },
      extraHeaders: {
        "x-vuagent-protocol-version": "1",
        // x-vuagent-replay 由 sse-response 按 subscribeFromSeq 的实际模式自动标注
      },
    });
  });

  // HITL 交互提交回调（同时支持 /api/action/:actionId 与 /api/actions/:actionId/approval 别名）
  const handleResolveAction = async (c: any) => {
    // TASK-101：协议版本协商——审批决策是交互面，新协议客户端不得在未协商端点
    // 上以不兼容语义提交（覆盖 chat/stream 之外的遗留面）
    const mismatch = negotiateProtocolOr426(c);
    if (mismatch) return mismatch;
    const actionId = c.req.param("actionId");
    const payload = await c.req.json().catch(() => ({}));
    console.log(`[Vuagent Server] Resolving action [${actionId}], payload: ${sanitizeForLog(payload)}`);

    // TASK-089（契约 TASK-B）：信封解析——合法信封直通；无 kind 的旧审批形态
    // （{approved, reason, note}）兼容映射为 L1 submit 信封；无法识别 → 400（设计文档 §3/§8）
    let envelope: UIActionEnvelope;
    try {
      envelope = parseActionEnvelope(payload);
    } catch (err) {
      if (err instanceof UIActionParseError) {
        return c.json({ error: err.message, code: "ACTION_PAYLOAD_INVALID" }, 400);
      }
      throw err;
    }

    // patch（L3 增量编辑）不在信封解析后立即裁决——需先定位挂起组件的
    // interaction 声明（L3 → PatchStash 暂存 200 accepted；其余 422
    // PATCH_UNSUPPORTED），处理点见下方 toolName/interaction 解析之后。

    // 归一 ActionResponse：旧字段直通 + envelope 挂载 + approved 归一
    // （cancel → 不批准；submit 显式携带 approved 时以其为准；其余 submit 视为「继续」）
    //
    // TASK-091 键名归一（E2E 回归核对发现的不一致修复）：新旧客户端的文案键位置不同——
    // 新客户端信封 deny 的 note 只在 values 内（{kind:"submit", values:{approved:false, note}}），
    // 旧客户端 {approved, reason, note} 在顶层。统一回填 response 顶层（note 优先、reason 兜底），
    // 供摘要生成器（digestApprovalDecision）与审批卡回写路径一致消费。
    // 注意：reason 不从 note 反推——客户端倒计时触发的 deny 以 note="timeout" 作展示性标记，
    // 若回填 reason 会被摘要误分类为服务端超时裁决（超时的权威裁决在 ActionHub）。
    const payloadRecord = payload as Record<string, unknown>;
    const submitValues = envelope.kind === "submit" ? envelope.values : undefined;
    const derivedReason =
      typeof payloadRecord.reason === "string"
        ? payloadRecord.reason
        : typeof submitValues?.reason === "string"
        ? submitValues.reason
        : undefined;
    const derivedNote =
      typeof payloadRecord.note === "string"
        ? payloadRecord.note
        : typeof submitValues?.note === "string"
        ? submitValues.note
        : derivedReason;
    // TASK-092：信封形态载荷（带 kind）的 kind/values/meta 不再铺到 response 顶层——
    // 信封是唯一载体（response.envelope），原样铺开会在 secret 剥离后残留明文副本
    // （values 顶层层与 envelope.values 双份，前者未剥离即泄漏）。旧审批形态
    // （无 kind 的 {approved, reason, note}）保持顶层直通兼容。
    const { kind: _kind, values: _values, meta: _meta, ...envelopeFreePayload } = payloadRecord;
    const isEnvelopePayload = typeof payloadRecord.kind === "string";
    const response: Record<string, unknown> & { approved: boolean; envelope: UIActionEnvelope } = {
      ...(isEnvelopePayload ? envelopeFreePayload : payloadRecord),
      envelope,
      ...(derivedReason !== undefined ? { reason: derivedReason } : {}),
      ...(derivedNote !== undefined ? { note: derivedNote } : {}),
      approved:
        typeof payloadRecord.approved === "boolean"
          ? (payloadRecord.approved as boolean)
          : envelope.kind === "cancel"
          ? false
          : typeof envelope.values.approved === "boolean"
          ? envelope.values.approved
          : true,
    };

    // TASK-089：组件级边界校验——L2/L3 声明组件的 submit values 按 resultSchema
    // TypeBox Value.Check 校验（与 tool-registry 入参闸门同口径）；失败 422 + fieldErrors，
    // 不唤醒协程、不落账（§4.2：校验失败是前端重填的新输入，不是终态）。
    // toolName/args 来源：内存挂起优先，孤儿场景回落外置挂起记录（只读查询）。
    // TASK-092：resultSchema 可由 deriveResultSchema 按挂起 args 派生（ui_form：
    // fields → resultSchema，模型不允许自行声明，设计文档 §7）——路由与执行器
    // 共享 resolveInteractionResultSchema 解析口径。
    const suspendedInfo = actionHub.getSuspended(actionId);
    let toolName = suspendedInfo?.toolName;
    let suspendedArgs = suspendedInfo?.args;
    // L3 patch 的「仍挂起」判定源（Phase 3）：内存挂起命中即存活；无内存挂起时
    // 查外置挂起记录（Redis 形态），命中即存活——此标记必须在下方 prior 恢复
    // 之前取得：prior（已落账决策）恢复的 toolName 不代表挂起仍存活，
    // patch 不得据此接受增量（终态后的 patch 一律 PATCH_UNSUPPORTED）。
    const pendingLive = suspendedInfo !== undefined;
    let externalPendingFound = false;
    let externalPending: { instanceId?: string } | undefined;
    if (!toolName && actionPersist) {
      const pendingList = await actionPersist.listPending().catch(() => []);
      const pending = pendingList.find((a) => a.actionId === actionId);
      if (pending) {
        externalPendingFound = true;
        externalPending = pending;
        toolName = pending.toolName;
        suspendedArgs = pending.args;
      }
    }
    // 幂等消费（审查 Optional 修复：getDecision 此前只写不读）——孤儿决策落账后
    // 的重复 POST 直接返回已记录决策，不再走 fallbackScan 404 谎报「无此挂起」。
    // 前置查询原因（TASK-092）：送达/孤儿落账后挂起记录已清理，回放时 toolName 无从
    // 获知——决策落账随附 toolName/args（见下方 saveDecision），此处据此恢复组件上下文，
    // 保证 secret 剥离与幂等哈希对「落账后的同体重放」对称（否则剥离前后哈希必然漂移）。
    const prior = actionPersist
      ? await actionPersist.getDecision(actionId).catch(() => undefined)
      : undefined;
    if (!toolName && prior) {
      toolName = (prior as { toolName?: string }).toolName;
      suspendedArgs = (prior as { args?: Record<string, unknown> }).args;
    }
    // TASK-092（孤儿重放修复）：决策落账必须随附组件上下文（toolName/args）——
    // 落账后的同体重放依赖 prior 恢复交互组件身份：重派生 resultSchema → 校验 →
    // 重放确定性 secret 剥离（ref=actionId+field，同明文剥离结果逐字节一致）。
    // 若落账缺 toolName，重放会跳过剥离，明文哈希与已剥离落账哈希必然漂移，
    // 幂等契约（同体 200）被误判为异体 422（ACTION_PAYLOAD_MISMATCH）。
    if (toolName) {
      response.toolName = toolName;
      if (suspendedArgs !== undefined) response.args = suspendedArgs;
    }
    const interaction = toolName ? toolRegistry.get(toolName)?.interaction : undefined;
    const isFormInteraction = interaction?.level === "L2" || interaction?.level === "L3";
    const effectiveResultSchema =
      interaction && isFormInteraction
        ? resolveInteractionResultSchema(interaction, suspendedArgs)
        : undefined;

    // ==========================================
    // Phase 3（L3 patch 运行时，设计文档 §3 patch 语义 / §8 patch 风暴防护）
    // ==========================================
    // patch 只对「声明 L3 且挂起仍存活」的组件生效：增量值合并进 PatchStash
    // 后立即 200 accepted——**不唤醒协程、不落账决策、不触发幂等哈希**
    // （patch 不是决策，模型只在终态被唤醒一次，防增量编辑刷屏上下文）。
    // 其余情况（L2 表单 / L1 审批 / L0 / 非交互组件 / 挂起已终结）维持
    // 422 PATCH_UNSUPPORTED，避免客户端误以为增量值已生效。
    if (envelope.kind === "patch") {
      const pendingAlive = pendingLive || externalPendingFound;
      if (interaction?.level !== "L3" || !pendingAlive) {
        return c.json(
          {
            success: false,
            error: "patch（L3 增量编辑）仅对协作组件（collaborative）且挂起未终结时可用，请使用 submit/cancel 完成交互",
            code: "PATCH_UNSUPPORTED",
          },
          422
        );
      }
      // 多副本归属闸门（评审 R2，与孤儿 submit 路径同口径）：patch 被负载均衡到
      // 非持有副本时若照常 200 accepted，增量只进本副本 stash——持有副本唤醒
      // 合并时看不到，用户编辑静默丢失。诚实拒绝（409）让客户端重试路由。
      if (!pendingLive && externalPendingFound) {
        const ownerInstanceId = (externalPending as { instanceId?: string } | undefined)?.instanceId;
        if (ownerInstanceId && ownerInstanceId !== instanceId) {
          return c.json(
            {
              success: false,
              delivered: false,
              code: "PENDING_OWNED_BY_OTHER_INSTANCE",
              note: `该挂起轮次由其他副本（instanceId=${ownerInstanceId}）持有，本副本不能接收增量；请重试路由到持有副本`,
            },
            409
          );
        }
      }
      // 增量值边界校验（与 submit 同口径）：按 resultSchema 校验 patch.values，
      // 失败 422 + fieldErrors——不暂存、不唤醒（§4.2：校验失败是前端重填的新输入）
      const patchValidation = validateEnvelopeValues(envelope, {
        ...interaction,
        resultSchema: effectiveResultSchema,
      });
      if (!patchValidation.ok) {
        return c.json(
          {
            success: false,
            error: "patch 的内容未通过表单校验，请修正后重新提交",
            code: "ENVELOPE_VALUES_INVALID",
            fieldErrors: patchValidation.fieldErrors,
          },
          422
        );
      }
      const patchKeys = patchStash.merge(actionId, envelope.values);
      return c.json({ success: true, accepted: true, patchKeys }, 200);
    }

    // L3 submit 合并（设计文档 §3 patch 语义的终态收口）：最终 values =
    // { ...stash.values, ...submit.values }（submit 覆盖同名键）——合并值
    // 过 resultSchema 校验、进摘要生成与落账信封；meta.editedFields 保持
    // 提交侧原值（只描述用户显式改动，不因合并扩大）。无暂存时合并值
    // 逐字节等于 submit 原值（纯展示语义路径不受影响）。终态后 stash 由
    // ActionHub 终态钩子 / 孤儿落账路径清理。
    if (envelope.kind === "submit" && interaction?.level === "L3") {
      // 合并源三级回退（评审 C-1 修复）：终态钩子会清空 stash——相同体重放时
      // 必须用落账时随决策持久化的 patchBase 重算合并，否则重算结果 = 裸 submit 值，
      // 与落账的合并信封哈希必然漂移，合法重放被误判 422 ACTION_PAYLOAD_MISMATCH
      const stashed =
        patchStash.get(actionId)?.values ??
        (prior as { patchBase?: Record<string, unknown> } | undefined)?.patchBase ??
        {};
      envelope = { ...envelope, values: { ...stashed, ...envelope.values } };
      response.envelope = envelope;
      // 合并基准随决策落账：同体重放的幂等重算依赖（仅 stash 非空时需要；
      // 空 stash 的合并值逐字节等于 submit 原值，天然对称）
      if (Object.keys(stashed).length > 0) response.patchBase = stashed;
    }

    if (envelope.kind === "submit" && isFormInteraction) {
      const validation = validateEnvelopeValues(envelope, {
        ...interaction,
        resultSchema: effectiveResultSchema,
      });
      if (!validation.ok) {
        return c.json(
          {
            success: false,
            error: "提交的内容未通过表单校验，请修正后重新提交",
            code: "ENVELOPE_VALUES_INVALID",
            fieldErrors: validation.fieldErrors,
          },
          422
        );
      }

      // TASK-092（设计文档 §5 敏感值通道）：校验通过后、唤醒/落账之前，
      // secret 字段值从 envelope.values 剥离——真实值入 secret store（宿主注入点），
      // 原位替换为 { ref, masked } 占位。此后摘要/附录、幂等哈希、决策落账、
      // 轨迹台账与会话卡片四处只见占位不见明文。
      // ref 按 actionId+field 确定性推导：同键重放剥离结果逐字节一致，
      // 幂等契约（同体 200 / 异体 422）不受剥离影响。
      const stripped = await stripSecretFieldValues(
        envelope.kind === "submit" ? envelope.values : {},
        effectiveResultSchema,
        secretStore,
        { actionId, sessionId: suspendedInfo?.sessionId }
      );
      if (stripped.stripped.length > 0 && envelope.kind === "submit") {
        envelope = { ...envelope, values: stripped.values };
        response.envelope = envelope;
      }
    }

    // TASK-089 升格为契约（设计文档 §3「幂等键 = actionId」）：同键异体 422——
    // 比较规范化信封哈希，与已落账决策不一致时拒绝处理（防误重试覆盖）。
    if (prior) {
        const priorHash = decisionPayloadHash(prior);
        // 无法判定（更早期无信封数据）时回落旧幂等行为，不误伤合法重试
        if (priorHash !== undefined && priorHash !== hashEnvelope(envelope)) {
          return c.json(
            {
              success: false,
              delivered: false,
              error: "同一 actionId 已落账不同内容的决策，本次提交被拒绝（疑似误重试覆盖）",
              code: "ACTION_PAYLOAD_MISMATCH",
            },
            422
          );
        }
        return c.json({
          success: true,
          delivered: false,
          prior,
          note: "该决策已落账（先前孤儿路径记录），本次为重复提交，未重复处理",
        });
    }

    // TASK-005：命中挂起索引时按 sessionId 直达目标会话，免除全库 O(N) 扫描
    const indexedSessionId = actionHub.getSessionIdForAction(actionId);
    const ok = actionHub.resolveAction(actionId, response);

    // TASK-091：送达路径同步落账决策（Redis 形态，24h TTL）——幂等契约化
    // （设计文档 §3「幂等键 = actionId」）覆盖送达场景：重复同体 POST 返回已落账决策
    // （200 delivered:false，不重复处理），异体重放 422 ACTION_PAYLOAD_MISMATCH；
    // 此前仅孤儿路径落账，送达后的重复提交会回落兜底扫描并 404 谎报「无此挂起」。
    if (ok && actionPersist) {
      await actionPersist.saveDecision(actionId, response).catch(() => {});
    }

    // TASK-100：孤儿挂起（Redis 形态下进程重启后到达的决策）——等待协程已随进程
    // 消失，唤醒不可能；诚实语义 = 决策落账（防重复处理）+ 审批卡回写，delivered:false。
    // 两道防谎报闸门（审查 Required/Optional 修复）：
    // ① 本副本活挂起复查：正常 resolve 的 fire-and-forget 删除落盘前的重复 POST
    //    不再误判孤儿（毫秒级竞态窗口）；
    // ② 多副本归属校验：挂起记录携带发起副本 instanceId，非本实例持有时不落孤儿账
    //    （决策 POST 被负载均衡到其他副本时，原协程仍在等待——伪造「已随重启中断」
    //    会丢失人的真实决策），返回 409 让客户端重试/由持有副本处理。
    let orphanSessionId: string | undefined;
    let orphanFound = false;
    if (!ok && actionPersist) {
      const liveHere = (actionHub as { hasPending?: (id: string) => boolean }).hasPending?.(actionId) ?? false;
      const pendingList = await actionPersist.listPending().catch(() => []);
      const orphan = pendingList.find((a) => a.actionId === actionId);
      const ownerInstanceId = (orphan as { instanceId?: string } | undefined)?.instanceId;
      if (orphan && !liveHere) {
        if (ownerInstanceId && ownerInstanceId !== instanceId) {
          return c.json(
            {
              success: false,
              delivered: false,
              code: "PENDING_OWNED_BY_OTHER_INSTANCE",
              note: `该挂起轮次由其他副本（instanceId=${ownerInstanceId}）持有，本副本不能判定其中断；请重试路由到持有副本，或等待其超时收尾`,
            },
            409
          );
        }
        orphanFound = true;
        orphanSessionId = orphan.sessionId;
        await actionPersist.saveDecision(actionId, response).catch(() => {});
        await actionPersist.deletePending(actionId).catch(() => {});
        // Phase 3：孤儿落账即终态——清理 L3 patch 暂存（此路径无活挂起，
        // ActionHub 终态钩子不会触发，须显式清理）
        patchStash.delete(actionId);
      }
    }

    // 同步更新数据库中历史会话的审批卡片状态，保证切换会话或刷新后状态依然保持
    const updateSessionCards = async (sessionId: string): Promise<void> => {
      const sess = await sessionRepo.get(sessionId);
      if (!sess) return;
      let modified = false;
      for (const turn of sess.turns) {
        if (!turn.cards) continue;
        for (const card of turn.cards) {
          if (card.type === "approval" && card.data?.actionId === actionId) {
            card.data.status = response.approved ? "approved" : "denied";
            // TASK-091：与执行器审批卡回写同口径（note 优先、reason 兜底）——
            // 此前为 reason 优先，与 tool-step-executor 的 note || reason 不一致
            card.data.reason = (response.note as string | undefined) || (response.reason as string | undefined);
            modified = true;
          }
          // TASK-092（评审 R-2 表单卡持久化回写）：ui_form 卡（ui 通道）唤醒后
          // 收口为 done——历史恢复时表单卡呈已提交态而非永远 pending
          if (
            card.type === "ui" &&
            card.data?.component === "ui_form" &&
            card.data?.actionId === actionId
          ) {
            card.data.status = "done";
            modified = true;
          }
        }
      }
      if (modified) {
        // TASK-092：轮次已拆行存储——走全量回写兼容通道
        await sessionRepo.replaceTurns(sess.id, sess.turns);
      }
    };

    const fallbackScan = !indexedSessionId && !orphanFound;
    try {
      if (indexedSessionId) {
        await updateSessionCards(indexedSessionId);
      } else if (orphanSessionId) {
        await updateSessionCards(orphanSessionId);
      } else if (fallbackScan) {
        // 兜底：无索引信息（如进程重启后遗留的 actionId）退回全库扫描
        const allSessions = await sessionRepo.list();
        for (const sess of allSessions) {
          await updateSessionCards(sess.id);
        }
      }
    } catch (e) {
      console.warn("更新会话卡片审批持久化状态失败:", e);
    }

    if (!ok && orphanFound) {
      return c.json({
        success: true,
        delivered: false,
        note: "决策已记录并回写审批卡；所属轮次已随进程重启中断（恢复机制诚实标记），不会唤醒执行",
      });
    }

    // 并发窗口闭合（评审 N-9）：送达 saveDecision 与 resolveAction 之间被 await
    // 让出时，并发同体重复 POST 可能走到此处（!ok 且非孤儿）——重读一次 prior，
    // 命中则幂等返回而非 404 谎报「无此挂起」
    if (!ok && actionPersist) {
      const priorRetry = await actionPersist.getDecision(actionId).catch(() => undefined);
      if (priorRetry) {
        return c.json({
          success: true,
          delivered: false,
          prior: priorRetry,
          note: "并发重复提交：该决策已由并发请求送达并落账，本次幂等返回",
        });
      }
    }
    return c.json({ success: ok }, ok ? 200 : 404);
  };

  app.post("/api/action/:actionId", handleResolveAction);
  app.post("/api/actions/:actionId/approval", handleResolveAction);

  // 查询当前挂起的动作列表
  // TASK-100：Redis 形态合并外置挂起（进程重启后仍可见；去重 + 过期剔除）
  app.get("/api/action/suspended", async (c) => {
    const inMemory = actionHub.listSuspended();
    if (!actionPersist) return c.json(inMemory);
    const persisted = await actionPersist.listPending().catch(() => []);
    const inMemoryIds = new Set(inMemory.map((a) => a.actionId));
    const now = Date.now();
    const orphans = persisted.filter(
      (a) => !inMemoryIds.has(a.actionId) && a.expiresAt > now
    );
    return c.json([...inMemory, ...orphans]);
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

    // TASK-084：滚动窗口钳制与 by-session / clampCostWindow 同口径（[1min, 30d]），
    // 补上界——此前无限大窗口会让全表明细扫描失去时间过滤
    const raw = Number(c.req.query("windowMs"));
    const windowMs =
      Number.isFinite(raw) && raw > 0
        ? Math.min(Math.max(Math.floor(raw), 60_000), 30 * 24 * 3_600_000)
        : 86_400_000;
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
    // TASK-086：body 直通曾让任意 rootPath 迁移 fs/bash 沙箱——白名单 + 绝对路径
    // + 可选 VUAGENT_WORKSPACE_ROOTS 前缀白名单（沙箱边界闸门）
    const body = await c.req.json().catch(() => null);
    const guard = validateCreateWorkspaceBody(body);
    if (!guard.ok) return c.json({ error: guard.error }, 400);
    // 实体 permission 为必填而 API 层保持可选（存量语义：未传由仓储落 undefined），
    // 校验器已枚举把关，此处受控断言
    const ws = await workspaceRepo.create(guard.value as Parameters<typeof workspaceRepo.create>[0]);
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
      // TASK-089：目录错误详情进服务端日志，响应侧通用信封（500 不外泄内部路径细节）
      return serverError(c, "WORKSPACE_FILES_READ_FAILED", e);
    }
  });

  /**
   * 调起操作系统原生文件夹选择器 → 直接创建工作区。
   *
   * 0.7.1 及更早：所有非零退出都回 500（用户点「取消」也是 500），前端于是降级成
   * 「手动输入路径」——用户看到的现象是「点新建工作区却要我手打路径」。现在三态分开：
   *   200 {cancelled:true}  用户取消（静默返回，不弹任何输入框）
   *   201 workspace         选中并创建
   *   409 PICKER_BUSY       已有一个选择框在等用户（避免叠框）
   *   503 PICKER_UNAVAILABLE 选择器不可用（附可执行 hint：装 zenity / 从图形终端启动）
   */
  app.post("/api/workspaces/pick-directory", async (c) => {
    if (pickerInFlight) {
      return c.json(
        { error: "已有一个文件夹选择框在等待操作，请先完成或取消它", code: "PICKER_BUSY" },
        409,
      );
    }
    pickerInFlight = true;
    try {
      const outcome = await (options.pickDirectory ?? pickNativeDirectory)();
      if (outcome.status === "cancelled") {
        return c.json({ cancelled: true }, 200);
      }
      if (outcome.status === "unavailable") {
        console.warn(`[Vuagent Server] 原生文件夹选择器不可用：${sanitizeForLog(outcome.reason)}`);
        return c.json(
          { error: outcome.reason, code: "PICKER_UNAVAILABLE", hint: outcome.hint },
          503,
        );
      }

      const name = path.basename(outcome.path) || "workspace";
      const ws = await workspaceRepo.create({
        name,
        rootPath: outcome.path,
        permission: "read-write",
      });
      return c.json(ws, 201);
    } catch (err: unknown) {
      // TASK-089：创建失败详情进服务端日志，响应侧通用信封
      return serverError(c, "PICK_DIRECTORY_FAILED", err);
    } finally {
      pickerInFlight = false;
    }
  });

  // 会话接口
  app.get("/api/sessions", async (c) => {
    const workspaceId = c.req.query("workspaceId");
    // TASK-093：列表瘦身——只读主文档元数据（不含 turns/checkpoints 全文档），
    // isRunning 由执行中心在途集合补齐（此前为加该字段全量装配每个会话的全部轮次）。
    // 轮次正文走 GET /api/sessions/:id 详情端点。
    const list = await sessionRepo.listMeta(
      workspaceId ? (s) => s.workspaceId === workspaceId : undefined
    );
    const enriched = list.map((s) => ({
      ...s,
      isRunning: executionHub.isRunning(s.id),
    }));
    return c.json(enriched);
  });

  app.post("/api/sessions", async (c) => {
    // TASK-086：白名单校验（workspaceId 必填；id/turns/status 等服务端属主字段不可由客户端指定）
    const body = await c.req.json().catch(() => null);
    const guard = validateCreateSessionBody(body);
    if (!guard.ok) return c.json({ error: guard.error }, 400);
    const sess = await sessionRepo.create(guard.value);
    return c.json(sess, 201);
  });

  app.patch("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    // TASK-086：只能改元数据（title/status/pinned/archived/activeModelProfileId/permission/systemContext），
    // turns/workspaceId/compaction 等属主数据不在白名单
    const body = await c.req.json().catch(() => null);
    const guard = validateUpdateSessionBody(body);
    if (!guard.ok) return c.json({ error: guard.error }, 400);
    // status 的存量事实值 "archived"（playground 归档切换）不在 SessionStatus 类型联合内，
    // 校验器已白名单把关，此处受控断言（见 http-body-guards.ts SESSION_STATUSES 注释）
    const updated = await sessionRepo.update(id, guard.value as Partial<SessionEntity>);
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

  // W2 拆行存储：checkpoint 元数据列表（大对象不在此端点；详情走 checkpoints/:cpId）
  app.get("/api/sessions/:id/turns/:turnId/checkpoints", async (c) => {
    const sessionId = c.req.param("id");
    const turnId = c.req.param("turnId");
    const session = await sessionRepo.get(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);

    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 200, 1), 500);
    const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
    const all = await checkpointsRepo.listMeta(sessionId, turnId);
    // 落库顺序倒序 = 最新在前（前端「最近步骤」视图主序）
    const page = all.slice().reverse().slice(offset, offset + limit);
    return c.json({ turnId, total: all.length, limit, offset, checkpoints: page });
  });

  // W2 拆行存储：单条 checkpoint；默认只元数据，?snapshot=1 才带 messagesSnapshot
  // （大对象显式取，避免列表/误链路背着几百 KB 的上下文投影跑）
  app.get("/api/sessions/:id/checkpoints/:cpId", async (c) => {
    const sessionId = c.req.param("id");
    const cpId = c.req.param("cpId");
    const session = await sessionRepo.get(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);

    // cpId 全局唯一但键含 turnId：扫会话级元数据定位（meta 含 turnId），再点查完整实体
    const metas = await checkpointsRepo.listMeta(sessionId);
    const meta = metas.find((m) => m.id === cpId);
    if (!meta) return c.json({ error: "Checkpoint not found", code: "NOT_FOUND" }, 404);

    if (c.req.query("snapshot") !== "1") {
      return c.json({ ...meta });
    }
    const full = await checkpointsRepo.getById(sessionId, meta.turnId, cpId);
    return c.json(full ?? { ...meta });
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

    // 1. 取会话最近 checkpoint 快照作为完整历史。
    // W2 拆行：优先独立集合 latestWithSnapshot（最新带快照的 checkpoint，
    // 快照是累积全量历史）；miss（纯 legacy / 无独立快照）回退旧式倒序扫 turn
    // 内联 checkpoints（防御式遍历，兼容 inline 形态与迁移前数据）。
    let snapshot: ChatMessage[] | null = null;
    let snapshotTurn: TurnEntity | null = null;
    let snapshotCp: CheckpointEntity | null = null;
    const latestSplit = await checkpointsRepo.latestWithSnapshot(sessionId);
    if (latestSplit) {
      snapshot = latestSplit.messagesSnapshot as ChatMessage[];
      snapshotCp = latestSplit;
      snapshotTurn = session.turns.find((t) => t.id === latestSplit.turnId) ?? null;
    } else {
      for (let i = session.turns.length - 1; i >= 0; i--) {
        const turn = session.turns[i];
        const cps = Array.isArray(turn.checkpoints) ? turn.checkpoints : [];
        for (let j = cps.length - 1; j >= 0; j--) {
          const cp = cps[j] as CheckpointEntity;
          if (cp && Array.isArray(cp.messagesSnapshot) && cp.messagesSnapshot.length > 0) {
            snapshot = cp.messagesSnapshot as ChatMessage[];
            snapshotTurn = turn;
            snapshotCp = cp;
            break;
          }
        }
        if (snapshot) break;
      }
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
    const checkpointId = `cp-compact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const compactCp: CheckpointEntity = {
      id: checkpointId,
      turnId: snapshotTurn.id,
      stepIndex: (snapshotCp?.stepIndex ?? 0) + 1,
      messagesSnapshot: sanitizeMessagesForCheckpoint(afterMessages),
      snapshotAt: Date.now(),
    };
    if (latestSplit) {
      // W2 拆行形态：快照 append 独立集合（同事务维护 turn meta），内存 turn 同步 meta
      await checkpointsRepo.appendCheckpoint(sessionId, snapshotTurn.id, compactCp);
      if (!Array.isArray(snapshotTurn.checkpoints)) snapshotTurn.checkpoints = [];
      snapshotTurn.checkpoints = [
        ...snapshotTurn.checkpoints.filter((m) => m.id !== checkpointId),
        toCheckpointMeta(compactCp),
      ];
      snapshotTurn.checkpointCount = snapshotTurn.checkpoints.length;
      snapshotTurn.checkpointsSplit = true;
    } else {
      // legacy/inline 形态：快照内联 turn 行（原口径）
      if (!Array.isArray(snapshotTurn.checkpoints)) {
        snapshotTurn.checkpoints = [];
      }
      (snapshotTurn.checkpoints as CheckpointEntity[]).push(compactCp);
    }

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
    // TASK-092：轮次已拆行存储——turns 变更（compaction checkpoint + 仪表水合值）走
    // 全量回写兼容通道；compaction 元数据走主文档 update
    await sessionRepo.replaceTurns(sessionId, session.turns);
    await sessionRepo.update(sessionId, { compaction: compactionRecord });

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

  /** http(s) 判定收口至 core/http-body-guards.ts（TASK-086，模型/供应商共用） */

  /**
   * 500 收口（TASK-089）：err 详情进 NDJSON 带 requestId 供排查，响应侧只给
   * 通用信封——err.message 原样回传可能携带内部路径/密钥样字符串。
   */
  const serverError = (c: Context, code: string, err: unknown) => {
    const requestId = c.get("requestId");
    const msg = clipExternalError(err instanceof Error ? err.message : String(err));
    console.error(
      JSON.stringify({
        level: "error",
        code,
        requestId,
        message: msg,
        stack: err instanceof Error ? err.stack : undefined,
      })
    );
    return c.json({ error: "服务器内部错误（详情见服务端日志）", code, requestId }, 500);
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
      const msg = clipExternalError(err instanceof Error ? err.message : String(err));
      return c.json({ ok: false, endpoint, error: msg }, 200);
    } finally {
      clearTimeout(timeout);
    }
  });

  /**
   * 能力验证（TASK-057）：对档案勾选的能力逐项发最小探测请求，实测声明与
   * 端点真实行为是否一致（防手勾漂移）。信任边界与 discover/models-test 同源：
   * 服务端代发、端点取自已存配置、凭据不出服务端；用户显式点击才触发
   * （探测产生真实 API 费用，请求均压成本：常规 max_tokens=1；Anthropic thinking
   * 探测受 max_tokens > budget_tokens 约束抬至 2048，仍是最小可行值）。串行、单项 15s。
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

    /**
     * 单项探测：ok（端点接受）/ fail（4xx 且报错指向被测参数本身 → 声明与实际不符）/
     * inconclusive（鉴权/网络/报错只涉及其他参数，不代表能力）。
     * TASK-080 fail 双闸门：rejectHint（参数类拒绝形态）与 paramRef（报错文本提及
     * 被测参数本身）同时命中才判 fail——报错只提 max_tokens 等探测体自身参数时
     * 归 inconclusive，防止「端点不接受探测体的其他参数」被误判为「能力不被支持」
     * （典型：o 系模型拒 max_tokens、网关钳 max_tokens 上限）。
     */
    const probe = async (
      capability: string,
      extra: Record<string, unknown>,
      rejectHint: RegExp,
      paramRef: RegExp
    ): Promise<{ capability: string; ok: boolean | null; detail: string }> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        // Anthropic baseUrl 通常已含 /v1（默认端点即 https://api.anthropic.com/v1），
        // 先归一再拼路径，否则拼出 /v1/v1/messages 必 404（TASK-080 顺带修正）
        const probeUrl = isAnthropic
          ? `${baseUrl.replace(/\/v1$/i, "")}/v1/messages`
          : `${baseUrl}/chat/completions`;
        const res = await fetch(probeUrl, {
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
          if (paramRef.test(text)) {
            return { capability, ok: false, detail: `端点拒绝该能力参数（HTTP ${res.status}）：建议取消勾选。${text}` };
          }
          // 报错指向探测体其他参数而非被测能力，不作能力结论
          return { capability, ok: null, detail: `HTTP ${res.status}，报错未指向被测能力参数，无法判定：${text}` };
        }
        return { capability, ok: null, detail: `HTTP ${res.status}：${text || "无响应体"}` };
      } catch (err: unknown) {
        return { capability, ok: null, detail: `探测失败：${clipExternalError(err instanceof Error ? err.message : String(err))}` };
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
          /image|vision|modalit|multimodal|content.*type/i,
          /image|vision|modalit|multimodal/i
        )
      );
    }
    // 推理档位：最低档 effort（effort 关键词被拒且报错指向推理参数 → 声明与实际不符）
    const efforts = profile.capabilities?.reasoning?.supported
      ? profile.capabilities.reasoning.supportedEfforts
      : undefined;
    if (efforts?.length) {
      results.push(
        await probe(
          "reasoning",
          isAnthropic
            ? // TASK-080：Anthropic 强制 max_tokens > thinking.budget_tokens，
              // max_tokens=1 恒 400 且报错含 thinking 字样，曾造成恒误报 fail
              { thinking: { type: "enabled", budget_tokens: 1024 }, max_tokens: 2048 }
            : { reasoning_effort: efforts[0] },
          /effort|reasoning|thinking|unsupported.*param|unknown.*parameter/i,
          /reasoning_effort|effort|reasoning|thinking|budget_tokens/i
        )
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
    const apiKeyCandidates = [
      body.apiKey,
      storedProfile?.apiKey,
      storedProvider?.apiKey,
      process.env.OPENAI_API_KEY,
    ];
    // 掩码守卫（评审 N-7）：回传 `****xxxx` 掩码当真探测会产出误导性 401——视为缺省
    const apiKey = apiKeyCandidates.find(
      (v) => typeof v === "string" && v && !/^\*{4}/.test(v)
    );
    // 模型标识缺失时拒绝探测而非回退默认值——回退 "gpt-4o-mini" 会在
    // 非 OpenAI 端点上产出与用户配置无关的 1211「模型不存在」误报
    const model = String(body.model || storedProfile?.model || "").trim();
    if (!model) {
      return c.json(
        {
          ok: false,
          latencyMs: 0,
          endpoint,
          model: "",
          error: "缺少模型标识：请先填写或从供应商拉取选择模型，再测试连接",
        },
        400
      );
    }

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
        // 占位会话：按域名规则注入 x-opencode-session 的网关（如 OpenCode Go）对
        // 缺该头的请求直接 400 MissingSessionID——探测是孤立请求没有真实会话，
        // 用固定占位值让会话路由类网关放行（仅 opencode.ai 域名会消费此头）。
        sessionId: "connectivity-probe",
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
      const msg = clipExternalError(err instanceof Error ? err.message : String(err));
      return c.json(
        { ok: false, latencyMs: Date.now() - startedAt, endpoint, model, error: msg },
        200
      );
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post("/api/settings/models", async (c) => {
    // TASK-086：遗留内联创建路径补白名单校验（provider 走 isProviderKind 枚举闸门，
    // baseUrl http(s) 校验；id/时间戳等属主字段不可由客户端指定）
    const body = await c.req.json().catch(() => null);
    const guard = validateCreateModelProfileBody(body, isProviderKind);
    if (!guard.ok) return c.json({ error: guard.error }, 400);
    const profile = await settingsRepo.createProfile(guard.value);
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

  // ─── console 静态托管（0.7.0 CLI 形态，可选）────────────────────────────
  // 挂载顺序（必须在所有 /api 路由之后）：
  //   1. /assets/* 静态（vite 产物带内容哈希 → immutable 长缓存）；
  //   2. /* 静态（favicon 等；目录命中 index 时按 SPA 入口处理 → no-cache）；
  //   3. SPA fallback：/api 前缀保持 404 JSON（不吞 API 错误），其余 GET 回 index.html。
  if (options.console?.dir) {
    const consoleDir = options.console.dir;
    const consoleEntry = options.console.entry ?? "index.html";
    const indexFile = path.join(consoleDir, consoleEntry);
    if (!fs.existsSync(indexFile)) {
      throw new Error(`console.dir 缺少 SPA 入口：${indexFile}（先构建 console 产物或检查 --console-dir）`);
    }
    const indexHtml = fs.readFileSync(indexFile, "utf8");
    const immutableAssets = options.console.immutableAssets !== false;

    // /assets/*：命中后补 immutable 长缓存。serveStatic 的 onFound 里 c.header 不会进
    // 最终响应（实测），可靠姿势是前置中间件在 next() 之后补头：静态未命中（404 走
    // fallback）与 fallback 自标 no-cache 的响应都不受影响（cache-control 已存在则不覆盖）。
    app.use("/assets/*", async (c, next) => {
      await next();
      if (immutableAssets && c.res.status === 200 && !c.res.headers.has("Cache-Control")) {
        c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      }
    });
    app.use("/assets/*", serveStatic({ root: consoleDir }));
    // 其余静态文件（favicon 等）。「/」改写为不存在的路径强制走 SPA fallback：
    // serveStatic 的目录索引会绕过 fallback 的 no-cache 口径，统一让入口只从 fallback 出。
    app.use(
      "/*",
      serveStatic({
        root: consoleDir,
        rewriteRequestPath: (p) => (p === "/" ? "/__vuagent_spa_fallback__" : p),
      })
    );
    app.get("*", (c) => {
      // /api 与 /assets 前缀的未命中保持 404 JSON：不吞 API 错误，静态资源缺失也不回 SPA
      // （顺带把 ..%2f 之类穿越尝试挡在 404，而不是回 200 首页）
      if (
        c.req.path === "/api" ||
        c.req.path.startsWith("/api/") ||
        c.req.path.startsWith("/assets/")
      ) {
        return c.json({ error: `Not Found: ${c.req.method} ${c.req.path}`, code: "NOT_FOUND" }, 404);
      }
      c.header("Cache-Control", "no-cache");
      return c.html(indexHtml);
    });
  }

  return {
    app,
    workspaceRepo,
    sessionRepo,
    settingsRepo,
    toolRegistry,
    uiRegistry,
    actionHub,
    /** 敏感值存储（TASK-092，§5 宿主注入点）：secret 字段真实值的归属，ref → 明文还原入口 */
    secretStore,
    agentLoop,
    /** 执行中心（优雅停机抽干等待 / 指标观测的入口） */
    executionHub,
    /** MCP server 连接管理（0.9.0 W1；null = 未启用——无 mcpConfigPath）。doctor/诊断用 */
    mcpHost,
    /** 关闭底层存储（TASK-095 优雅停机收口；sqlite close，无句柄驱动为空操作）。
     *  关闭前先批量 flush 在途轮次持久化缓冲（审查 O1 修复）：抽干超时被放弃的
     *  轮次其 ≤250ms 防抖窗口内的进度不再直接丢失，缩小恢复状态回退窗口；
     *  flush fail-open，不阻塞停机。
     *  0.9.0 W1：MCP stdio 子进程随停机回收（transport.close kill 进程树），
     *  关停路径 fail-open——单个 server 关闭失败不阻断其余。 */
    close: async () => {
      await agentLoop.flushInFlightPersistence();
      if (mcpHost) await mcpHost.shutdown().catch(() => {});
      const closable = driver as unknown as { close?: () => void };
      closable.close?.();
    },
  };
}
