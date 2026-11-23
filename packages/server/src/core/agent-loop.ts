import type { HarnessStreamEvent, AgentTurnRequest } from "./types.js";
import type { WorkspaceRepository } from "../storage/repositories/workspace.repository.js";
import type { SessionRepository } from "../storage/repositories/session.repository.js";
import type { SettingsRepository } from "../storage/repositories/settings.repository.js";
import type { ToolConfigRepository } from "../storage/repositories/tool-config.repository.js";
import type { ConfigResolver } from "./config-resolver.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ActionHub } from "./action-hub.js";
import type { IModelDriver, ModelStreamChunk } from "../adapters/model-driver.js";
import { OpenAICompatibleDriver } from "../adapters/openai-driver.js";
import { AnthropicDriver } from "../adapters/anthropic-driver.js";
import {
  ContextCompactor,
  sanitizeMessagesForCheckpoint,
  type ChatMessage,
} from "./context-compactor.js";
import { parsePartialJson } from "./stream-orchestrator.js";
import { TelemetryLedger, clipTrajectoryEvent } from "./telemetry.js";
import { runSandboxDemoTurn } from "./sandbox-demo.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { resolveEffectivePermissionMode } from "./permissions.js";
import { defaultBaseUrlFor } from "./provider-defaults.js";
import { defaultNamespaceValues, getNamespaceSchema } from "./config-schema.js";
import { resolveContextWindow } from "./model-catalog.js";
import {
  FallbackChainDriver,
  type FallbackAttempt,
  type FallbackNotice,
} from "./fallback-driver.js";
import {
  FINISH_TASK_TOOL_NAME,
  defaultDeliverableAssertion,
  type DeliverableAssertion,
} from "./finish-task.js";
import { ClassifiedModelError } from "../adapters/resilience.js";
import {
  opsCodeForErrorClass,
  createNoopSink,
  mapAbortCause,
  type HarnessEventSink,
  type HarnessOpsCode,
} from "./event-sink.js";
import type { CostRecorder } from "./pricing-table.js";
import type { CheckpointEntity, ModelProfileEntity } from "../storage/interfaces.js";
import { OpsReporter } from "./ops-reporter.js";
import { TurnPersistence } from "./turn-persistence.js";
import { buildHistoryMessages } from "./history-builder.js";
import { executeToolCallStep } from "./tool-step-executor.js";

/** 整轮看门狗超时钳制边界（TASK-048）：请求级覆盖同样受钳 */
const TURN_TIMEOUT_MIN_MS = 30_000;
const TURN_TIMEOUT_MAX_MS = 3_600_000;
const TURN_TIMEOUT_DEFAULT_MS = 600_000;

/** execution / tools 命名空间 schema（模块级常量：CONFIG_SCHEMA 静态不可变） */
const EXECUTION_NS = getNamespaceSchema("execution")!;
const TOOLS_NS = getNamespaceSchema("tools")!;
const PROMPT_NS = getNamespaceSchema("prompt")!;

/**
 * 能力驱动的推理档位解析（保守策略，能力运行时 P1）。
 *
 * 三个条件全满足才返回档位，任一不满足返回 undefined（不发送）：
 *   1. 请求显式携带档位（前端档位选择器只在模型声明时渲染，这里是服务端二次防线）；
 *   2. 生效档案声明 capabilities.reasoning.supported = true；
 *   3. 档位在声明的 supportedEfforts 集合内（集合缺失视为无法校验，同样不发送）。
 *
 * 注意：档位并入 parameters 后随降级链共用——不支持该参数的备用端点会按
 * 「请求非法」类错误上抛（不触发降级重试），错误文案直达用户，不静默吞掉。
 */
function resolveReasoningEffort(
  profile: ModelProfileEntity,
  requested?: string
): string | undefined {
  const effort = typeof requested === "string" ? requested.trim() : "";
  if (!effort) return undefined;
  const reasoning = profile.capabilities?.reasoning;
  if (!reasoning?.supported) return undefined;
  if (!reasoning.supportedEfforts?.includes(effort)) return undefined;
  return effort;
}

export interface AgentLoopServices {
  workspaceRepo: WorkspaceRepository;
  sessionRepo: SessionRepository;
  settingsRepo: SettingsRepository;
  /** 工具启停配置（全局层，缺记录=启用；逐工具调用实时读，运行中改档立即生效） */
  toolConfigRepo: ToolConfigRepository;
  /** 配置中心解析器（TASK-024 基座注入备用；下游任务逐层消费执行/安全/提示词命名空间） */
  configResolver?: ConfigResolver;
  toolRegistry: ToolRegistry;
  actionHub: ActionHub;
  /** 显式注入的模型驱动（宿主/测试替身用，直接信任）；缺省按所选模型档案逐轮构造 OpenAI 兼容驱动 */
  modelDriver?: IModelDriver;
  /** 按档案构造驱动的工厂注入点（测试替身 / 自定义协议驱动）；缺省构造 OpenAI 兼容驱动 */
  driverFactory?: (profile: ModelProfileEntity) => IModelDriver;
  /**
   * 可插拔交付断言（finishTaskMode=enforced 时生效）：验收 finish_task 自述与
   * 轮次实际产出是否匹配；缺省非空内容/卡片断言（防空跑最小守卫）
   */
  deliverableAssertion?: DeliverableAssertion;
  compactor?: ContextCompactor;
  /** 运维事件出口（TASK-051）；缺省 no-op，server 注入 console NDJSON */
  eventSink?: HarnessEventSink;
  /** 成本记账器（TASK-052）：turn 收尾记账，fail-open；缺省不记账 */
  costRecorder?: CostRecorder;
}

/**
 * 核心调度器：AgentLoop
 * 实现 ReAct 循环调度、HITL 挂起校验、沙箱工具分发、检查点快照与可观测台账
 *
 * 结构（TASK-057 四刀拆分，纯结构不改行为）：
 * - core/ops-reporter.ts      每轮预绑 sessionId/turnId 的运维事件发射器
 * - core/turn-persistence.ts  running 行 / per-step 增量 / 终态 upsert / 成本记账
 * - core/tool-step-executor.ts 工具执行段（启停→闸门→权限→HITL→执行→卡片收敛）
 * - core/history-builder.ts   历史重建（压缩折叠 + checkpoint 快照回放）
 * 本文件只保留编排骨架：配置解析 → 上下文组装 → ReAct 回环 → 终态收尾。
 */
export class AgentLoop {
  private compactor: ContextCompactor;
  private ops: HarnessEventSink;

  constructor(private services: AgentLoopServices) {
    this.compactor = services.compactor ?? new ContextCompactor();
    this.ops = services.eventSink ?? createNoopSink();
  }

  /**
   * 启动单轮 Agent 执行，返回异步事件流 (AsyncIterable<HarnessStreamEvent>)
   */
  async *runTurn(
    req: AgentTurnRequest,
    abortSignal?: AbortSignal
  ): AsyncIterable<HarnessStreamEvent> {
    const startAt = Date.now();

    // TASK-025：执行层配置每轮解析一次（运行中改配置下一轮生效，与工具启停同口径）；
    // 未注入 resolver 时回落 schema 默认（与硬编码时代行为严格等价）。
    // req.maxSteps 请求级覆盖优先级最高（解析链：请求 > 全局配置 > 内置默认）。
    const execCfg =
      (await this.services.configResolver?.resolve("execution")) ??
      defaultNamespaceValues(EXECUTION_NS);
    const maxSteps = req.maxSteps ?? (execCfg.maxSteps as number);
    const approvalTimeoutMs = execCfg.approvalTimeoutMs as number;
    const contextBudgetRatio = execCfg.contextBudgetRatio as number;
    // 单轮 token 预算熔断（0 = 不限）：计费口径跨步累计，超限自动中止保留进度
    const maxRunTokens = execCfg.maxRunTokens as number;
    // 降级链备用档案 id（逗号分隔，按序尝试）
    const modelFallbackIdsCfg = String(execCfg.modelFallbackIds ?? "");
    // TASK-048 整轮看门狗：解析链 请求级 req.timeoutMs > 配置中心 execution.turnTimeoutMs > 内置默认；
    // 请求级覆盖同样受 30s–1h 钳制。此前该参数被接收但从未消费（SSE 停滞可致轮次永久挂起）。
    const configuredTimeout = Number(execCfg.turnTimeoutMs);
    const requestedTimeout = Number(req.timeoutMs);
    const rawTurnTimeout =
      Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? requestedTimeout
        : Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : TURN_TIMEOUT_DEFAULT_MS;
    const turnTimeoutMs = Math.min(
      Math.max(Math.round(rawTurnTimeout), TURN_TIMEOUT_MIN_MS),
      TURN_TIMEOUT_MAX_MS
    );
    const turnTimeoutSeconds = Math.round(turnTimeoutMs / 1000);
    this.compactor.configure({
      preserveRecentTurns: execCfg.preserveRecentTurns as number,
      maxToolResultChars: execCfg.maxToolResultChars as number,
    });

    // TASK-026：工具策略命名空间（bash 超时全局封顶）同样每轮解析一次
    const toolsCfg =
      (await this.services.configResolver?.resolve("tools")) ??
      defaultNamespaceValues(TOOLS_NS);
    const bashTimeoutCeilingMs = toolsCfg.bashTimeoutCeilingMs as number;

    // TASK-027：提示词组装命名空间（全局自定义指令 + 环境块/权限块开关），
    // 每轮解析一次，运行中改配置下一轮生效（与执行/工具层同口径）
    const promptCfg =
      (await this.services.configResolver?.resolve("prompt")) ??
      defaultNamespaceValues(PROMPT_NS);

    // 1. 获取工作区与会话
    const workspace = await this.services.workspaceRepo.get(req.workspaceId);
    if (!workspace) {
      yield { type: "error", message: `Workspace [${req.workspaceId}] not found` };
      return;
    }

    const session = await this.services.sessionRepo.get(req.sessionId);
    if (!session) {
      yield { type: "error", message: `Session [${req.sessionId}] not found` };
      return;
    }

    // 2. 解析生效的模型配置
    const modelProfile = await this.services.settingsRepo.resolveEffectiveSettings(
      req.modelProfileId || session.activeModelProfileId,
      req.modelOverride
    );
    // 能力驱动的推理档位（保守）：声明校验不通过 = 不发送，与未携带时逐字节一致
    const reasoningEffort = resolveReasoningEffort(modelProfile, req.reasoningEffort);
    // 输出上限（能力运行时 P3）：仅声明 capabilities.maxOutputTokens 时注入请求。
    // 只发 max_tokens（兼容面最广：OpenAI 兼容端点/DeepSeek/Kimi 均认；
    // OpenAI 官方不允许 max_tokens 与 max_completion_tokens 同发，故不同发）。
    // Anthropic 驱动经 parameters 展开覆盖其默认 max_tokens；thinking 启用时
    // 驱动内还有「max_tokens 必须 > budget」的抬升保护。
    const declaredMaxOutput = modelProfile.capabilities?.maxOutputTokens;

    // 上下文窗口动态解析：档案显式值 > 模型名前缀查表 > 默认兜底，恒钳制 [8k, 2M]
    //（修正档案漏填/错填导致的过早压缩或滑动窗口失效）
    const effectiveContextWindow = resolveContextWindow({
      model: modelProfile.model,
      contextWindow: modelProfile.contextWindow,
    });
    // 显式终态协议模式：off（默认，工具对模型不可见）/ enforced（finish_task + 交付断言）
    const finishTaskMode = (execCfg.finishTaskMode as string) === "enforced" ? "enforced" : "off";

    // 3. 构建历史消息上下文
    // TASK-058：turnId 单一事实来源——hub spawnRun 生成后经 req.turnId 传入，
    // 直接调用方（无 hub）缺省时回落自生成，全链路（事件/落库/ops 台账）一致
    const turnId = req.turnId ?? `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const turnNumber = session.turns.length + 1;
    const telemetry = new TelemetryLedger(turnId, turnNumber);

    // 每轮运维事件发射器（预绑 sessionId/turnId）与持久化助手
    const ops = new OpsReporter(this.ops, { sessionId: session.id, turnId });
    const persistence = new TurnPersistence({
      sessionRepo: this.services.sessionRepo,
      costRecorder: this.services.costRecorder,
      ops,
      telemetry,
      sessionId: session.id,
      turnId,
    });

    // TASK-051 运维事件：轮次开始（effectiveMode 在下方 TASK-014 段才声明，
    // 此处用请求级与会话级原始值即可，运维画像不需要交集解析结果）
    ops.turnStart({
      at: startAt,
      model: modelProfile.model,
      permission: req.permission ?? session.permission,
    });

    const messages: ChatMessage[] = [];

    // TASK-014：生效权限模式（请求级∩会话级，更严者生效）在轮次开始时解析一次，
    // 系统提示词的「模式声明」与下方工具仲裁的「模式执行」共用同一解析结果，口径不漂移
    const effectiveMode = resolveEffectivePermissionMode(req.permission, session.permission);

    // 系统提示词（TASK-014 重构）：运行环境披露（平台/OS/shell/日期/git）
    // + 权限模式声明 + 操作纪律 + 工作区/会话自定义指令，对标 Codex ## Environment 机制
    messages.push({
      role: "system",
      content: buildSystemPrompt({
        workspace,
        effectiveMode,
        sessionSystemContext: session.systemContext,
        promptConfig: {
          customInstructions: promptCfg.customInstructions as string,
          includeEnvironmentBlock: promptCfg.includeEnvironmentBlock as boolean,
          includePermissionBlock: promptCfg.includePermissionBlock as boolean,
          finishTaskEnforced: finishTaskMode === "enforced",
        },
      }),
    });

    // 历史重建（压缩折叠 + checkpoint 快照回放 + 追加本轮用户输入）
    messages.push(
      ...buildHistoryMessages({ session, currentPrompt: req.prompt })
    );

    // 视觉通道（能力运行时 P2）：本轮携带图片时，把「本轮 user 消息」升级为
    // 多模态 content parts（buildHistoryMessages 追加的最后一条即本轮输入）。
    // 历史轮次的图片不进上下文：checkpoint 落库前已把 base64 降级为 [图片] 占位
    // （TASK-083，见 sanitizeMessagesForCheckpoint），history-builder 对历史图片轮的
    // user 消息注入同款占位文本，明示模型该轮曾有图。
    if (req.images && req.images.length > 0 && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.role === "user") {
        last.content = [
          { type: "text", text: req.prompt },
          ...req.images.map((img) => ({
            type: "image_url" as const,
            image_url: { url: `data:${img.mediaType};base64,${img.data}` },
          })),
        ];
      }
    }

    {
      const ev = telemetry.recordEvent({
        at: startAt,
        lane: "input",
        role: "user",
        title: "用户输入",
        detail: req.prompt,
      });
      yield { type: "traj", event: clipTrajectoryEvent(ev) };
    }

    const checkpoints: CheckpointEntity[] = [];
    let currentStep = 0;
    const currentMsgId = `msg-${turnId}`;

    // 模型驱动解析：显式注入的驱动（ServerOptions.modelDriver，宿主/测试替身用）直接信任；
    // 缺省时按所选模型档案逐轮构造 OpenAI 兼容驱动
    const injectedDriver = this.services.modelDriver;
    const hasApiKey = Boolean(
      modelProfile.apiKey ||
        process.env.OPENAI_API_KEY ||
        (modelProfile.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) ||
        modelProfile.provider === "ollama"
    );

    if (!injectedDriver && !this.services.driverFactory && !hasApiKey) {
      // 未配置大模型 API Key 时进入沙箱演示分支（TASK-005：演示脚本剥离至 core/sandbox-demo.ts，核心引擎保持纯净）
      // TASK-008：携带与主流程同口径的上下文快照与占用估算，演示轮次同样落 checkpoint——
      // 历史可恢复、手动压缩在演示会话上同样可用
      yield* runSandboxDemoTurn(
        {
          workspace,
          sessionId: session.id,
          prompt: req.prompt,
          attachments: req.attachments,
          modelProfileName: modelProfile.name,
          modelProfileProvider: modelProfile.provider,
          messageId: currentMsgId,
          turnId,
          startAt,
          messagesSnapshot: sanitizeMessagesForCheckpoint(messages),
          usage: {
            promptTokens: this.compactor.estimateTokens(messages),
            parts: this.compactor.estimateParts(messages),
          },
        },
        (turnEntity) => this.services.sessionRepo.appendTurn(session.id, turnEntity)
      );

      // TASK-060：演示分支补 ops turn_finish 配对——ops.turnStart 对全部轮次发出，
      // 此分支此前 yield* 后直接 return 绕过主流程收尾，运维台账出现孤立 turn_start。
      // stepCount/totalTokens 与 sandbox-demo 落库 TurnEntity 的演示脚本固定口径一致。
      ops.turnFinish({
        status: "done",
        stepCount: 1,
        durationMs: Date.now() - startAt,
        totalTokens: 256,
      });
      return;
    }

    let accumulatedContent = "";
    let accumulatedThought = "";
    let lastContextTokens = 0;
    const accumulatedCards: Array<{ id: string; type: string; data: any }> = [];
    /** 非正常收尾的分类码（中止/超时/预算），正常 done 为 undefined */
    let turnFinishCode: HarnessOpsCode | undefined;
    /** R8：中止成因（协议 reason 枚举），落库持久化供历史恢复呈现徽标 */
    let abortedReasonForPersist: "user" | "timeout" | "preempt" | "token_budget" | undefined;
    /** 单轮 token 预算熔断触发标记（与看门狗共用 watchdogController 中止通道） */
    let tokenBudgetFired = false;
    /** 单轮累计消耗（计费口径：输入+输出跨步求和） */
    let runTokensUsed = 0;
    /** 降级通知缓冲（onFallback 回调收集，流结束后收敛为轨迹事件） */
    const modelFallbackNotices: FallbackNotice[] = [];
    /** 轮次收尾形态：explicit（finish_task 显式宣告）/ natural（自然停机）/ truncated（步数耗尽）；中止时 undefined */
    let finishReason: "explicit" | "natural" | "truncated" | undefined;

    // TASK-049 即时落库：轮次开始即落 running 行（中途崩溃留痕），
    // 每 step 增量更新，终态 appendTurn upsert 兜底（幂等替换，不产生重复行）
    await persistence.appendRunningRow({ prompt: req.prompt, startAt, attachments: req.attachments });

    /** 每 step 结束后的增量进度落盘（best-effort，失败不影响主链路） */
    const persistProgress = async (): Promise<void> =>
      persistence.persistProgress(
        {
          content: accumulatedContent,
          thought: accumulatedThought,
          cards: accumulatedCards,
          stepCount: currentStep,
          checkpoints,
          contextTokens: lastContextTokens,
        },
        startAt
      );

    // TASK-048 整轮看门狗：独立 controller + 定时器，与客户端 abort 信号合并。
    // 超时/用户停止共用同一收尾路径（中止 → 抽干 → 落库），消息按 watchdogFired 区分成因。
    const watchdogController = new AbortController();
    let watchdogFired = false;
    const watchdogTimer = setTimeout(() => {
      watchdogFired = true;
      watchdogController.abort();
    }, turnTimeoutMs);
    // TASK-060：AbortSignal.any 原生组合（替代已废弃的 combineAbortSignals）
    const runSignal = abortSignal
      ? AbortSignal.any([abortSignal, watchdogController.signal])
      : watchdogController.signal;
    const abortMessage = () =>
      tokenBudgetFired
        ? `本轮累计 token 消耗（${runTokensUsed}）已达预算上限（${maxRunTokens}），已自动中止并保留已完成进度`
        : watchdogFired
        ? `本轮执行已超时（看门狗上限 ${turnTimeoutSeconds}s），已自动中止并保留已完成进度`
        : "Agent execution was aborted by client";

    // 模型驱动解析（每轮一次，自 while 内联提升）：注入驱动直接信任；
    // 否则主档案 + 按序降级链——仅「流开始前」的限流/服务端/网络类失败触发切换
    //（诚实重试边界，见 FallbackChainDriver）；auth/请求非法/窗口溢出不降级。
    const hasProfileCreds = (profile: ModelProfileEntity) =>
      Boolean(
        this.services.driverFactory ||
          profile.apiKey ||
          process.env.OPENAI_API_KEY ||
          profile.provider === "ollama"
      );
    const buildProfileDriver = (profile: ModelProfileEntity) => {
      const injected = this.services.driverFactory?.(profile);
      if (injected) return injected;
      // 协议路由：anthropic 原生档案（provider=anthropic 且未设 baseUrl，即直连官方端点）
      // 走原生 Messages 协议驱动；设了 baseUrl 视为 OpenAI 兼容网关，保持兼容路径
      if (profile.provider === "anthropic" && !profile.baseUrl) {
        return new AnthropicDriver(profile.apiKey || process.env.ANTHROPIC_API_KEY);
      }
      // 默认端点取共享映射（provider-defaults）：anthropic 原生档案已在上方
      // 路由到 AnthropicDriver，走到这里的 anthropic 一定是显式网关或兜底
      return new OpenAICompatibleDriver(profile.apiKey || process.env.OPENAI_API_KEY, profile.baseUrl || defaultBaseUrlFor(profile.provider), {
        // TASK-051：TASK-048 韧性层的重试遥测接缝 → model_retry 运维事件
        onRetry: (info) => ops.modelRetry(info),
      });
    };

    let effectiveDriver: IModelDriver;
    if (injectedDriver) {
      effectiveDriver = injectedDriver;
    } else {
      const attempts: FallbackAttempt[] = [
        { name: modelProfile.name, model: modelProfile.model, driver: buildProfileDriver(modelProfile) },
      ];
      const fallbackIds = modelFallbackIdsCfg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (fallbackIds.length > 0) {
        const allProfiles = await this.services.settingsRepo.listProfiles();
        for (const id of fallbackIds) {
          const fp = allProfiles.find((p) => p.id === id);
          if (!fp || fp.id === modelProfile.id || !hasProfileCreds(fp)) continue;
          attempts.push({ name: fp.name, model: fp.model, driver: buildProfileDriver(fp) });
        }
      }
      effectiveDriver =
        attempts.length > 1
          ? new FallbackChainDriver(attempts, (notice) => {
              ops.modelFallback({
                from: notice.from,
                to: notice.to,
                errorClass: notice.errorClass,
                reason: notice.reason,
              });
              modelFallbackNotices.push(notice);
            })
          : attempts[0].driver;
    }

    try {
      // TASK-050/049：轮次开始即落 running 行（中途崩溃留痕）已在上方完成；
      // TASK-054：控制事件 turn_start 先于首个数据事件（前端据此进入 loading 态）
      yield { type: "turn_start", turnId, startedAt: startAt };

      // 4. 进入 ReAct 核心回环
      while (currentStep < maxSteps) {
        if (runSignal.aborted) {
          // R5 修复：成因经 mapAbortCause 集中映射（token 预算 > watchdog > signal.reason=new_task > user），
          // hub abort(kind) 透传的 preempt 不再被误记为 TURN_ABORTED
          const cause = mapAbortCause({ watchdogFired, tokenBudgetFired, signalReason: runSignal.reason });
          ops.abort({ reason: cause.opsReason, code: cause.code });
          // TASK-054：aborted 控制事件取代旧假 text_delta 文案
          yield {
            type: "aborted",
            turnId,
            reason: cause.protocolReason,
          };
          yield { type: "error", message: abortMessage(), code: cause.code };
          turnFinishCode = cause.code;
          abortedReasonForPersist = cause.protocolReason;
          break;
        }

        currentStep++;
        // 裁剪阈值跟随模型真实窗口（TASK-025：比例接入配置中心 execution.contextBudgetRatio，
        // 默认 0.85）：固定 16k 阈值会在长会话中过早清掉历史，
        // 造成每轮占用跳水（前端仪表呈"清零重算"观感）。工具结果截断与 sanitize 不受影响。
        const compactedMessages = this.compactor.compact(messages, {
          maxTokens: Math.floor(effectiveContextWindow * contextBudgetRatio),
        });
        // TASK-019：按全局启用配置过滤模型可见的 function definitions
        //（每步重读——运行中禁用工具，下一步模型即不可见）
        const disabledToolNames = await this.services.toolConfigRepo.disabledNames();
        const toolsDefinition = this.services.toolRegistry.toModelToolDefinitions({
          disabledNames: disabledToolNames,
          // finish_task 仅在 enforced 模式对模型可见（off 时隐藏，引擎侧条件过滤）
          hideTools: finishTaskMode === "off" ? new Set([FINISH_TASK_TOOL_NAME]) : undefined,
        });

        let stepContent = "";
        const pendingToolCalls: Map<
          number,
          { id: string; name: string; argumentsStr: string }
        > = new Map();

        // 调用模型流式输出（effectiveDriver 已在轮次开始前装配：注入驱动或主档案+降级链）
        // 推理档位并入 parameters：OpenAI 兼容端点经 ...parameters 展开自然到达
        // reasoning_effort；Anthropic 原生驱动在请求构造时映射为 thinking budget
        const createModelStream = (msgs: ChatMessage[]) =>
          effectiveDriver.generateStream({
            model: modelProfile.model,
            messages: msgs,
            tools: toolsDefinition,
            parameters: {
              ...modelProfile.parameters,
              ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
              ...(typeof declaredMaxOutput === "number" && declaredMaxOutput > 0
                ? { max_tokens: declaredMaxOutput }
                : {}),
            },
            abortSignal: runSignal,
          });

        let activeStream = createModelStream(compactedMessages);
        let streamIterator = activeStream[Symbol.asyncIterator]();
        let chunkResult: IteratorResult<ModelStreamChunk>;

        try {
          chunkResult = await streamIterator.next();
        } catch (err: unknown) {
          // 诚实自愈边界：在流尚未吐出任何 chunk 前若遭遇模型端 400 上下文超限（context_overflow），
          // 触发一次紧急深度压缩折叠历史并自动重试
          if (err instanceof ClassifiedModelError && err.errorClass === "context_overflow") {
            const emergencyMessages = this.compactor.manualCompact(compactedMessages, {
              keepTokens: Math.max(1000, Math.floor(effectiveContextWindow * 0.5)),
            }).messages;
            this.ops.emit({
              type: "warn",
              at: Date.now(),
              code: "MODEL_CONTEXT_OVERFLOW_AUTO_HEAL",
              sessionId: session.id,
              turnId,
              detail: "遭遇模型端上下文溢出 (400)，触发紧急深度压缩并自动重试",
            });
            activeStream = createModelStream(emergencyMessages);
            streamIterator = activeStream[Symbol.asyncIterator]();
            chunkResult = await streamIterator.next();
          } else {
            throw err;
          }
        }

        while (!chunkResult.done) {
          const chunk = chunkResult.value;
          if (runSignal.aborted) break;

          if (chunk.type === "usage" && chunk.usage) {
            telemetry.addTokens(chunk.usage.promptTokens, chunk.usage.completionTokens, {
              reasoningTokens: chunk.usage.reasoningTokens,
              cachedTokens: chunk.usage.cachedTokens,
              cacheCreationTokens: chunk.usage.cacheCreationTokens,
            });
            // 单轮 token 预算熔断：计费口径（输入+输出）跨步累计，超限即经看门狗通道中止
            //（mapAbortCause 按 tokenBudgetFired 优先分流成因，保留已完成进度落库）
            runTokensUsed += chunk.usage.promptTokens + chunk.usage.completionTokens;
            if (maxRunTokens > 0 && runTokensUsed >= maxRunTokens && !tokenBudgetFired) {
              tokenBudgetFired = true;
              watchdogController.abort();
            }
            // 窗口占用口径（与 Codex/Claude Code 一致）：promptTokens 为本步发送的全部上下文
            // （ReAct 每步重发历史，取"最近一次调用"即当前真实占用），前端直接覆盖展示；
            // 跨步累加值仅作为计费口径存入 telemetry.totalTokens，不推给窗口仪表。
            lastContextTokens =
              chunk.usage.promptTokens + chunk.usage.completionTokens;
            // 协议级分段估算（system/history/tools）：按本步实际发送的上下文统计，
            // 与 promptTokens 同口径。本步助手输出（completionTokens）并入 history 段——
            // 下一步起它就是重发历史的一部分，且最后一步的输出不会再有后续 usage 覆盖，
            // 并入后分段之和 ≈ totalTokens，仪表触发器文案与面板数值保持一致。
            const parts = this.compactor.estimateParts(compactedMessages);
            const historyPart = parts.find((p) => p.kind === "history");
            if (historyPart) {
              historyPart.tokens += chunk.usage.completionTokens;
            } else if (chunk.usage.completionTokens > 0) {
              parts.push({
                id: "history",
                label: "对话历史",
                tokens: chunk.usage.completionTokens,
                kind: "history",
              });
            }
            yield {
              type: "usage",
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: lastContextTokens,
              contextWindow: effectiveContextWindow,
              parts,
              // 分档计价数据源（能力运行时 P1）：端点不提供时字段缺省，前端旧版本兼容
              ...(chunk.usage.reasoningTokens !== undefined ? { reasoningTokens: chunk.usage.reasoningTokens } : {}),
              ...(chunk.usage.cachedTokens !== undefined ? { cachedTokens: chunk.usage.cachedTokens } : {}),
              ...(chunk.usage.cacheCreationTokens !== undefined
                ? { cacheCreationTokens: chunk.usage.cacheCreationTokens }
                : {}),
            };
          }

          if (chunk.type === "thought_delta" && chunk.text) {
            accumulatedThought += chunk.text;
            yield {
              type: "thought_delta",
              messageId: currentMsgId,
              delta: chunk.text,
            };
          }

          if (chunk.type === "text_delta" && chunk.text) {
            telemetry.recordFirstToken();
            stepContent += chunk.text;
            accumulatedContent += chunk.text;
            yield {
              type: "text_delta",
              messageId: currentMsgId,
              delta: chunk.text,
            };
          }

          if (chunk.type === "tool_call_delta" && chunk.toolCall) {
            const { index, id, name, argumentsDelta } = chunk.toolCall;
            let currentCall = pendingToolCalls.get(index);
            if (!currentCall) {
              currentCall = {
                id: id || `call-${Date.now()}-${index}`,
                name: name || "",
                argumentsStr: "",
              };
              pendingToolCalls.set(index, currentCall);

              if (currentCall.name) {
                yield {
                  type: "tool_call_start",
                  messageId: currentMsgId,
                  toolCallId: currentCall.id,
                  toolName: currentCall.name,
                };
              }
            } else {
              if (id) currentCall.id = id;
              if (name) currentCall.name = name;
            }

            if (argumentsDelta) {
              currentCall.argumentsStr += argumentsDelta;
              // 容错 Partial JSON 解析
              const partial = parsePartialJson(currentCall.argumentsStr);
              if (partial) {
                yield {
                  type: "tool_call_args_delta",
                  toolCallId: currentCall.id,
                  partialArgs: partial,
                };
              }
            }
          }

          chunkResult = await streamIterator.next();
        }

        // 降级通知收敛为轨迹事件（模型 lane，前端时间线可见「档案 A → 档案 B」切换）
        for (const notice of modelFallbackNotices.splice(0)) {
          const ev = telemetry.recordEvent({
            at: notice.at,
            lane: "model",
            role: "system",
            title: `模型降级：${notice.from} → ${notice.to}`,
            detail: notice.reason,
          });
          yield { type: "traj", event: clipTrajectoryEvent(ev) };
        }

        // 保存本步骤助手的文本输出
        if (stepContent) {
          messages.push({ role: "assistant", content: stepContent });
          const ev = telemetry.recordEvent({
            at: Date.now(),
            lane: "model",
            role: "assistant",
            title: "模型思考回复",
            detail: stepContent,
          });
          yield { type: "traj", event: clipTrajectoryEvent(ev) };
        }

        // 检查是否有工具调用
        if (pendingToolCalls.size === 0) {
          // 显式终态协议（enforced）：自然停机同样过交付断言——无实质产出的空跑
          // 不放行，注入纠偏指令继续执行；步数耗尽/中止信号在即则兜底放行
          if (finishTaskMode === "enforced" && !runSignal.aborted && currentStep < maxSteps) {
            const verdict = (this.services.deliverableAssertion ?? defaultDeliverableAssertion)({
              args: {},
              content: accumulatedContent,
              cardCount: accumulatedCards.length,
              stepCount: currentStep,
            });
            if (!verdict.ok) {
              messages.push({
                role: "user",
                content: `交付断言未通过：${verdict.reason} 请继续执行任务并产出实质内容，完成后调用 finish_task 宣告完成。`,
              });
              const ev = telemetry.recordEvent({
                at: Date.now(),
                lane: "tool",
                role: "tool",
                title: "交付断言未通过（自然停机拦截）",
                detail: verdict.ok ? "" : verdict.reason,
              });
              yield { type: "traj", event: clipTrajectoryEvent(ev) };
              await persistProgress();
              continue;
            }
          }
          // 自然停机（off 模式默认路径 / enforced 模式断言通过的兜底）
          finishReason = "natural";
          // 无工具调用，表示 Agent 任务已彻底完成。
          // 纯文本完成步同样落检查点（TASK-008 修复）：此前提前 break 跳过了末尾的
          // checkpoint 记录，纯对话轮次没有 messagesSnapshot——历史重建会丢失 assistant
          // 回复（上下文只剩连续 user 消息），手动压缩也取不到完整历史快照
          checkpoints.push({
            id: `cp-${turnId}-${currentStep}`,
            turnId,
            stepIndex: currentStep,
            messagesSnapshot: sanitizeMessagesForCheckpoint(messages),
            snapshotAt: Date.now(),
          });
          await persistProgress();
          break;
        }

        // 整理工具调用对象入上下文
        const callsArray = Array.from(pendingToolCalls.values());
        messages.push({
          role: "assistant",
          tool_calls: callsArray.map((c) => ({
            id: c.id,
            type: "function",
            function: {
              name: c.name,
              arguments: c.argumentsStr,
            },
          })),
        });

        // 显式终态协议（enforced）：finish_task 不进通用执行链——
        // 交付断言在此裁决：通过 → 成功结果喂回并宣告显式完成；未通过 →
        // 断言驳回文案喂回（isError 口径），模型继续产出实质内容。
        // 其余同步出现的工具调用照常执行，保证 tool_calls↔tool 配对完整
        const finishCall = callsArray.find((c) => c.name === FINISH_TASK_TOOL_NAME);
        // 禁用仲裁先行：用户禁用 finish_task 后（调用侧兜底口径与通用工具一致），
        // 拦截语义失效——交还通用执行链按「已禁用」结构化报错回喂
        const finishDisabled =
          finishCall !== undefined && disabledToolNames.has(FINISH_TASK_TOOL_NAME);
        if (finishTaskMode === "enforced" && finishCall && !finishDisabled) {
          let parsedFinish: { summary?: string; deliverables?: unknown } = {};
          try {
            parsedFinish = JSON.parse(finishCall.argumentsStr || "{}");
          } catch {
            parsedFinish = parsePartialJson(finishCall.argumentsStr) || {};
          }
          const verdict = (this.services.deliverableAssertion ?? defaultDeliverableAssertion)({
            args: parsedFinish as Parameters<DeliverableAssertion>[0]["args"],
            content: accumulatedContent,
            cardCount: accumulatedCards.length,
            stepCount: currentStep,
          });
          const approved = verdict.ok;

          const restCalls = callsArray.filter((c) => c !== finishCall);
          if (restCalls.length > 0) {
            yield* executeToolCallStep(
              {
                toolConfigRepo: this.services.toolConfigRepo,
                sessionRepo: this.services.sessionRepo,
                toolRegistry: this.services.toolRegistry,
                actionHub: this.services.actionHub,
                ops,
              },
              {
                calls: restCalls,
                runSignal,
                workspace,
                sessionId: session.id,
                effectiveMode,
                sessionPermissionAtStart: session.permission,
                approvalTimeoutMs,
                bashTimeoutCeilingMs,
                getContentLength: () => accumulatedContent.length,
                accumulatedCards,
                messages,
                telemetry,
              }
            );
          }

          messages.push({
            role: "tool",
            tool_call_id: finishCall.id,
            name: FINISH_TASK_TOOL_NAME,
            content: approved
              ? JSON.stringify({
                  finished: true,
                  summary: typeof parsedFinish.summary === "string" ? parsedFinish.summary : "",
                  deliverables: Array.isArray(parsedFinish.deliverables) ? parsedFinish.deliverables : [],
                })
              : `Error: 交付断言未通过：${(verdict as { ok: false; reason: string }).reason} 请继续完成任务、产出实质内容后再次调用 finish_task。`,
          });
          this.compactor.patchUnansweredToolCalls(messages);

          const ev = telemetry.recordEvent({
            at: Date.now(),
            lane: "tool",
            role: "tool",
            title: approved ? "任务显式完成（finish_task）" : "交付断言未通过（finish_task 驳回）",
            detail: typeof parsedFinish.summary === "string" ? parsedFinish.summary : "",
            result: approved ? undefined : (verdict as { ok: false; reason: string }).reason,
          });
          yield { type: "traj", event: clipTrajectoryEvent(ev) };

          checkpoints.push({
            id: `cp-${turnId}-${currentStep}`,
            turnId,
            stepIndex: currentStep,
            messagesSnapshot: sanitizeMessagesForCheckpoint(messages),
            snapshotAt: Date.now(),
          });
          await persistProgress();

          if (approved) {
            finishReason = "explicit";
            break;
          }
          // 断言未通过：继续 ReAct（模型将看到驳回文案），步数预算照常消耗
          continue;
        }

        // 逐个执行工具调用（启停仲裁 → 工作区闸门 → 权限模式 → HITL 审批 → 执行 → 卡片收敛）
        yield* executeToolCallStep(
          {
            toolConfigRepo: this.services.toolConfigRepo,
            sessionRepo: this.services.sessionRepo,
            toolRegistry: this.services.toolRegistry,
            actionHub: this.services.actionHub,
            ops,
          },
          {
            calls: callsArray,
            runSignal,
            workspace,
            sessionId: session.id,
            effectiveMode,
            sessionPermissionAtStart: session.permission,
            approvalTimeoutMs,
            bashTimeoutCeilingMs,
            getContentLength: () => accumulatedContent.length,
            accumulatedCards,
            messages,
            telemetry,
          }
        );

        // 收敛半截工具调用：工具循环中被 abort 打断时，assistant.tool_calls 已入上下文
        // 但部分 tool 响应缺失；补占位结果保证 checkpoint 快照与下一轮恢复的历史
        // 对模型 API 始终合法（否则触发如 GLM 1214 "messages 参数非法"）
        this.compactor.patchUnansweredToolCalls(messages);

        // 记录本步检查点
        const cp: CheckpointEntity = {
          id: `cp-${turnId}-${currentStep}`,
          turnId,
          stepIndex: currentStep,
          messagesSnapshot: sanitizeMessagesForCheckpoint(messages),
          snapshotAt: Date.now(),
        };
        checkpoints.push(cp);
        // TASK-049：每 step 即时落库（含本步 checkpoint），崩溃时已完成步骤留痕
        await persistProgress();
      }

      // while 条件耗尽（非 break 退出）= 步数截断收尾；中止路径 finishReason 保持 undefined
      if (!finishReason && !turnFinishCode) {
        finishReason = "truncated";
      }

      const totalDuration = Date.now() - startAt;
      yield {
        type: "turn_end",
        stepCount: currentStep,
        durationMs: totalDuration,
      };

      // 5. 保存本轮会话（终态 upsert done 段 + 成本记账）
      await persistence.finalizeDone({
        prompt: req.prompt,
        attachments: req.attachments,
        content: accumulatedContent,
        thought: accumulatedThought,
        cards: accumulatedCards,
        abortedReason: abortedReasonForPersist,
        finishReason,
        stepCount: currentStep,
        checkpoints,
        durationMs: totalDuration,
        contextTokens: lastContextTokens,
        startAt,
      });
      persistence.recordCost(modelProfile.model);

      // TASK-051：轮次正常收尾（turnFinishCode 存在时代表被中止/超时后收尾）
      ops.turnFinish({
        status: "done",
        stepCount: currentStep,
        durationMs: totalDuration,
        totalTokens: telemetry.exportSummary().tokens.totalTokens,
        code: turnFinishCode,
        finishReason,
      });
    } catch (err: unknown) {
      // R5 修复：catch 路径同样走集中映射（token 预算 > watchdog > 顶替 > user）
      const catchCause = mapAbortCause({ watchdogFired, tokenBudgetFired, signalReason: runSignal.reason });
      // 降级通知兜底收敛：流中途异常时，本步流结束后的常规收敛点不会到达——
      // 在此补发已发生的降级轨迹，运维台账与前端时间线不丢「档案切换」事实
      for (const notice of modelFallbackNotices.splice(0)) {
        const ev = telemetry.recordEvent({
          at: notice.at,
          lane: "model",
          role: "system",
          title: `模型降级：${notice.from} → ${notice.to}`,
          detail: notice.reason,
        });
        yield { type: "traj", event: clipTrajectoryEvent(ev) };
      }
      // TASK-054：信号中止在流内部以异常冒出时，先补 aborted 控制事件（区分成因）
      if (runSignal.aborted) {
        abortedReasonForPersist = catchCause.protocolReason;
        yield {
          type: "aborted",
          turnId,
          reason: catchCause.protocolReason,
        };
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      // TASK-048：看门狗触发的异常统一改为超时口径（卡在模型流/工具执行内部时
      // 异常从深处冒出，loop-top 检查来不及拦），成因区分不丢；token 预算熔断同口径优先
      const msg = tokenBudgetFired
        ? `本轮累计 token 消耗（${runTokensUsed}）已达预算上限（${maxRunTokens}）：${rawMsg}`
        : watchdogFired
        ? `本轮执行已超时（看门狗上限 ${turnTimeoutSeconds}s）：${rawMsg}`
        : runSignal.aborted && err instanceof Error && /abort/i.test(rawMsg)
        ? abortMessage()
        : rawMsg;
      // TASK-051：终态分类码——信号中止按 catchCause / 已分类模型错误 / 其余执行失败
      const finishCode: HarnessOpsCode = runSignal.aborted
        ? catchCause.code
        : err instanceof ClassifiedModelError
        ? opsCodeForErrorClass(err.errorClass)
        : "TURN_EXECUTION_FAILED";
      yield {
        type: "error",
        message: msg,
        code: finishCode,
      };

      // 终态 upsert error 段 + 成本记账；落库二次失败在 helper 内显式告警
      await persistence.finalizeError(
        {
          prompt: req.prompt,
          attachments: req.attachments,
          content: accumulatedContent,
          thought: accumulatedThought,
          cards: accumulatedCards,
          abortedReason: abortedReasonForPersist,
          stepCount: currentStep,
          checkpoints,
          startAt,
          errorMessage: msg,
        },
        modelProfile.model
      );

      ops.turnFinish({
        status: "error",
        stepCount: currentStep,
        durationMs: Date.now() - startAt,
        totalTokens: telemetry.exportSummary().tokens.totalTokens,
        code: finishCode,
        message: msg,
      });
    } finally {
      // 看门狗定时器在轮次终态（done/error）后必须清除，避免悬挂计时器
      clearTimeout(watchdogTimer);
    }
  }
}
