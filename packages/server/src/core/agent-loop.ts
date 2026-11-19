import type { HarnessStreamEvent, AgentTurnRequest } from "./types.js";
import type { WorkspaceRepository } from "../storage/repositories/workspace.repository.js";
import type { SessionRepository } from "../storage/repositories/session.repository.js";
import type { SettingsRepository } from "../storage/repositories/settings.repository.js";
import type { ToolConfigRepository } from "../storage/repositories/tool-config.repository.js";
import type { ConfigResolver } from "./config-resolver.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ActionHub } from "./action-hub.js";
import type { IModelDriver } from "../adapters/model-driver.js";
import { OpenAICompatibleDriver } from "../adapters/openai-driver.js";
import { MockDriver } from "../adapters/mock-driver.js";
import { ContextCompactor, type ChatMessage } from "./context-compactor.js";
import { parsePartialJson } from "./stream-orchestrator.js";
import { TelemetryLedger, clipTrajectoryEvent } from "./telemetry.js";
import { runSandboxDemoTurn } from "./sandbox-demo.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { resolveEffectivePermissionMode } from "./permissions.js";
import { defaultNamespaceValues, getNamespaceSchema } from "./config-schema.js";
import { combineAbortSignals, ClassifiedModelError } from "../adapters/resilience.js";
import {
  opsCodeForErrorClass,
  createNoopSink,
  mapAbortCause,
  type HarnessEventSink,
  type HarnessOpsCode,
} from "./event-sink.js";
import type { CostRecorder } from "./pricing-table.js";
import type { CheckpointEntity } from "../storage/interfaces.js";
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
  modelDriver: IModelDriver;
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

    // 3. 构建历史消息上下文
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
        },
      }),
    });

    // 历史重建（压缩折叠 + checkpoint 快照回放 + 追加本轮用户输入）
    messages.push(
      ...buildHistoryMessages({ session, currentPrompt: req.prompt })
    );

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

    const isMock = this.services.modelDriver instanceof MockDriver;
    const hasApiKey = Boolean(modelProfile.apiKey || process.env.OPENAI_API_KEY || modelProfile.provider === "ollama");

    if (!isMock && !hasApiKey) {
      // 未配置大模型 API Key 时进入沙箱演示分支（TASK-005：演示脚本剥离至 core/sandbox-demo.ts，核心引擎保持纯净）
      // TASK-008：携带与主流程同口径的上下文快照与占用估算，演示轮次同样落 checkpoint——
      // 历史可恢复、手动压缩在演示会话上同样可用
      yield* runSandboxDemoTurn(
        {
          workspace,
          sessionId: session.id,
          prompt: req.prompt,
          modelProfileName: modelProfile.name,
          modelProfileProvider: modelProfile.provider,
          messageId: currentMsgId,
          turnId,
          startAt,
          messagesSnapshot: JSON.parse(JSON.stringify(messages)),
          usage: {
            promptTokens: this.compactor.estimateTokens(messages),
            parts: this.compactor.estimateParts(messages),
          },
        },
        (turnEntity) => this.services.sessionRepo.appendTurn(session.id, turnEntity)
      );
      return;
    }

    let accumulatedContent = "";
    let accumulatedThought = "";
    let lastContextTokens = 0;
    const accumulatedCards: Array<{ id: string; type: string; data: any }> = [];
    /** 非正常收尾的分类码（中止/超时），正常 done 为 undefined */
    let turnFinishCode: HarnessOpsCode | undefined;
    /** R8：中止成因（协议 reason 枚举），落库持久化供历史恢复呈现徽标 */
    let abortedReasonForPersist: "user" | "timeout" | "preempt" | undefined;

    // TASK-049 即时落库：轮次开始即落 running 行（中途崩溃留痕），
    // 每 step 增量更新，终态 appendTurn upsert 兜底（幂等替换，不产生重复行）
    await persistence.appendRunningRow({ prompt: req.prompt, startAt });

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
    const runSignal = abortSignal
      ? combineAbortSignals(abortSignal, watchdogController.signal)
      : watchdogController.signal;
    const abortMessage = () =>
      watchdogFired
        ? `本轮执行已超时（看门狗上限 ${turnTimeoutSeconds}s），已自动中止并保留已完成进度`
        : "Agent execution was aborted by client";

    try {
      // TASK-050/049：轮次开始即落 running 行（中途崩溃留痕）已在上方完成；
      // TASK-054：控制事件 turn_start 先于首个数据事件（前端据此进入 loading 态）
      yield { type: "turn_start", turnId, startedAt: startAt };

      // 4. 进入 ReAct 核心回环
      while (currentStep < maxSteps) {
        if (runSignal.aborted) {
          // R5 修复：成因经 mapAbortCause 集中映射（watchdog > signal.reason=new_task > user），
          // hub abort(kind) 透传的 preempt 不再被误记为 TURN_ABORTED
          const cause = mapAbortCause({ watchdogFired, signalReason: runSignal.reason });
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
          maxTokens: Math.floor((modelProfile.contextWindow || 128_000) * contextBudgetRatio),
        });
        // TASK-019：按全局启用配置过滤模型可见的 function definitions
        //（每步重读——运行中禁用工具，下一步模型即不可见）
        const disabledToolNames = await this.services.toolConfigRepo.disabledNames();
        const toolsDefinition = this.services.toolRegistry.toModelToolDefinitions({
          disabledNames: disabledToolNames,
        });

        let stepContent = "";
        const pendingToolCalls: Map<
          number,
          { id: string; name: string; argumentsStr: string }
        > = new Map();

        const effectiveDriver: IModelDriver = isMock
          ? this.services.modelDriver
          : new OpenAICompatibleDriver(
              modelProfile.apiKey || process.env.OPENAI_API_KEY,
              modelProfile.baseUrl || (modelProfile.provider === "ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1"),
              {
                // TASK-051：TASK-048 韧性层的重试遥测接缝 → model_retry 运维事件
                onRetry: (info) => ops.modelRetry(info),
              }
            );

        // 调用模型流式输出
        const stream = effectiveDriver.generateStream({
          model: modelProfile.model,
          messages: compactedMessages,
          tools: toolsDefinition,
          parameters: modelProfile.parameters,
          abortSignal: runSignal,
        });

        for await (const chunk of stream) {
          if (runSignal.aborted) break;

          if (chunk.type === "usage" && chunk.usage) {
            telemetry.addTokens(chunk.usage.promptTokens, chunk.usage.completionTokens);
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
              contextWindow: modelProfile.contextWindow,
              parts,
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
          // 无工具调用，表示 Agent 任务已彻底完成。
          // 纯文本完成步同样落检查点（TASK-008 修复）：此前提前 break 跳过了末尾的
          // checkpoint 记录，纯对话轮次没有 messagesSnapshot——历史重建会丢失 assistant
          // 回复（上下文只剩连续 user 消息），手动压缩也取不到完整历史快照
          checkpoints.push({
            id: `cp-${turnId}-${currentStep}`,
            turnId,
            stepIndex: currentStep,
            messagesSnapshot: JSON.parse(JSON.stringify(messages)),
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
          messagesSnapshot: JSON.parse(JSON.stringify(messages)),
          snapshotAt: Date.now(),
        };
        checkpoints.push(cp);
        // TASK-049：每 step 即时落库（含本步 checkpoint），崩溃时已完成步骤留痕
        await persistProgress();
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
        content: accumulatedContent,
        thought: accumulatedThought,
        cards: accumulatedCards,
        abortedReason: abortedReasonForPersist,
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
      });
    } catch (err: unknown) {
      // R5 修复：catch 路径同样走集中映射
      const catchCause = mapAbortCause({ watchdogFired, signalReason: runSignal.reason });
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
      // 异常从深处冒出，loop-top 检查来不及拦），成因区分不丢
      const msg = watchdogFired
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
