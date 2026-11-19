import type { HarnessStreamEvent, AgentTurnRequest, ToolExecutionContext } from "./types.js";
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
import { resolveEffectivePermissionMode, resolveLivePermissionMode } from "./permissions.js";
import { defaultNamespaceValues, getNamespaceSchema } from "./config-schema.js";
import { combineAbortSignals } from "../adapters/resilience.js";
import type { CheckpointEntity, TurnEntity } from "../storage/interfaces.js";

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
}

/**
 * 核心调度器：AgentLoop
 * 实现 ReAct 循环调度、HITL 挂起校验、沙箱工具分发、检查点快照与可观测台账
 */
export class AgentLoop {
  private compactor: ContextCompactor;

  constructor(private services: AgentLoopServices) {
    this.compactor = services.compactor ?? new ContextCompactor();
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

    // TASK-008 手动压缩：被折叠轮次不入上下文，改为注入一条摘要占位消息，
    // 使上下文占用断崖回落；折叠轮次之后的历史照常按 checkpoint 快照恢复。
    // （自动滑动窗口裁剪 compact 仍在每步生效，二者互补）
    const compaction = session.compaction;
    if (compaction?.summary) {
      messages.push({ role: "user", content: compaction.summary });
    }

    // 恢复历史会话
    for (let turnIndex = 0; turnIndex < session.turns.length; turnIndex++) {
      const pastTurn = session.turns[turnIndex];
      // 压缩覆盖的轮次：正文已折叠进摘要，跳过原始内容
      if (compaction && turnIndex < compaction.compactedTurnCount) continue;
      messages.push({ role: "user", content: pastTurn.prompt });
      // 提取最新检查点的消息状态（旧数据 errorTurn 可能无 checkpoints 字段，需防御）
      const cps = pastTurn.checkpoints;
      const lastCp = cps && cps.length > 0 ? cps[cps.length - 1] : undefined;
      if (lastCp && Array.isArray(lastCp.messagesSnapshot)) {
        const snapshot = lastCp.messagesSnapshot as ChatMessage[];
        // 快照是「截至本步的完整历史」（含此前轮次），只回放本 turn 提问之后的消息；
        // 逐条全量重放会与更早轮次的快照叠加，assistant 内容随轮次成倍重复
        let start = 0;
        for (let i = snapshot.length - 1; i >= 0; i--) {
          const item = snapshot[i];
          if (item.role === "user" && item.content === pastTurn.prompt) {
            start = i + 1;
            break;
          }
        }
        for (let i = start; i < snapshot.length; i++) {
          const item = snapshot[i];
          if (item.role !== "system" && item.role !== "user") {
            messages.push(item);
          }
        }
      }
    }

    // 追加本轮用户输入
    messages.push({ role: "user", content: req.prompt });
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
      // 4. 进入 ReAct 核心回环
      while (currentStep < maxSteps) {
        if (runSignal.aborted) {
          yield { type: "error", message: abortMessage() };
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
              modelProfile.baseUrl || (modelProfile.provider === "ollama" ? "http://localhost:11434/v1" : "https://api.openai.com/v1")
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

        // 逐个执行工具调用
        for (const call of callsArray) {
          if (runSignal.aborted) break;

          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(call.argumentsStr || "{}");
          } catch {
            parsedArgs = parsePartialJson(call.argumentsStr) || {};
          }

          yield {
            type: "tool_call_executing",
            toolCallId: call.id,
            toolName: call.name,
            args: parsedArgs,
          };

          // TASK-006：工具调用链卡片持久化（刷新后卡片可恢复）
          // contentOffset 对齐 blocks 时序定位机制；tool_call_result 时原地收敛终态
          const callCard: {
            id: string;
            type: string;
            data: {
              toolName: string;
              status: string;
              args: Record<string, unknown>;
              startedAt: number;
              contentOffset: number;
              result?: unknown;
              error?: string;
              duration?: number;
            };
          } = {
            id: `call-${call.id}`,
            type: "toolcall",
            data: {
              toolName: call.name,
              status: "executing",
              args: parsedArgs,
              startedAt: Date.now(),
              contentOffset: accumulatedContent.length,
            },
          };
          accumulatedCards.push(callCard);

          const toolDef = this.services.toolRegistry.get(call.name);

          let executionResult: unknown;
          let isError = false;
          let errorMessage: string | undefined;

          // 工具启停仲裁（TASK-019）+ per-tool 覆盖（TASK-026）：逐调用实时重读该工具
          // 配置记录——模型上下文可能残留轮次开始时的旧 definitions（禁用前已下发），
          // 此兜底保证禁用语义不被绕过；禁用即最终裁决，不再进入权限链与执行
          const toolCfg = await this.services.toolConfigRepo.get(call.name);
          if (toolCfg && toolCfg.enabled === false) {
            isError = true;
            errorMessage = `工具 [${call.name}] 已被禁用（设置 → 工具 页可重新启用）`;
            executionResult = { disabled: true, reason: errorMessage };
          }

          // TASK-012 权限仲裁（评审 P0-2 修复）：
          // ① 请求级 req.permission 与会话级 session.permission 取交集，更严者生效。
          //    严重度：read-only(3) > review(2) > auto(1)
          // TASK-014：轮次起点交集解析（effectiveMode）供系统提示词声明；
          // 运行中改档感知（用户反馈）：逐工具调用重读会话最新档，与起点不一致
          // （UI 改档即 PATCH 会话）则以最新会话档为准——正在输出的轮次对
          // 「后续工具调用」立即可感知权限变化，而非等到下一轮才生效
          let mode = effectiveMode;
          try {
            const latestSession = await this.services.sessionRepo.get(req.sessionId);
            if (latestSession) {
              mode = resolveLivePermissionMode(
                effectiveMode,
                session.permission,
                latestSession.permission
              );
            }
          } catch {
            // 会话读取失败时保守回落轮次起点口径，不阻断仲裁
          }

          // ② 声明式元数据取代旧字符串黑名单：是否写工作区由工具定义自述
          //    （修复 fs_write 不在 "write_file/edit_file/..." 黑名单导致的只读静默写绕过）
          const writesWorkspace = toolDef?.writesWorkspace === true;

          // 权限模式与审批判断
          let requiresApproval = false;

          // ③ 工作区级硬闸门：read-only 工作区在任何模式（含 auto）下都拦截写工具
          //    （!isError 守卫：工具已被禁用裁决时，权限链不得覆写禁用错误）
          if (!isError && writesWorkspace && workspace.permission === "read-only") {
            isError = true;
            errorMessage = `[工作区权限限制] 当前工作区权限为只读 (read-only)，已拦截写操作工具 [${call.name}]`;
            executionResult = { approved: false, reason: errorMessage };
          } else if (mode === "read-only" && writesWorkspace) {
            // ④ 只读模式：按工具元数据拦截一切写工作区工具（含 bash_run 等执行副作用）
            isError = true;
            errorMessage = `[只读模式限制] 当前权限模式为只读 (read-only)，已拦截写操作工具 [${call.name}]`;
            executionResult = { approved: false, reason: errorMessage };
          } else if (mode === "review") {
            // ⑤ 审批模式 (review)：高风险或需审批的工具进入 HITL 挂起。
            // TASK-026 per-tool requiresApproval 覆盖（deny-wins）：
            // override=true 可追加审批（低风险工具提升为需审批）；override=false
            // 不放宽既有推导——安全项只能升不能降，存储的 false 视为无效。
            requiresApproval =
              toolDef?.requiresApproval === true ||
              toolDef?.riskLevel === "high" ||
              toolCfg?.requiresApproval === true;
          }
          // ⑥ auto 模式：Agent 自主执行无需审批介入；工作区级硬闸门（③）仍然生效

          // HITL 拦截机制 (仅在需要人工审批且未被只读限制时进入)
          if (requiresApproval && !isError) {
            // 登记审批卡片进入持久化记录表
            // contentOffset：审批挂起发生时的正文长度，前端据此把审批卡重建回文本流中的真实位置
            const approvalCard = {
              id: `approval-${call.id}`,
              type: "approval",
              data: {
                actionId: call.id,
                toolName: call.name,
                title: `申请执行工具: ${call.name}`,
                command: `${call.name} ${JSON.stringify(parsedArgs, null, 2)}`,
                risk: toolDef?.riskLevel || "high",
                expiresInSec: 180,
                status: "pending",
                reason: "" as string | undefined,
                resolvedAt: 0 as number | undefined,
                contentOffset: accumulatedContent.length,
              },
            };
            accumulatedCards.push(approvalCard);

            // 提前挂起并进入等待表，确保外部可以立刻查询到该挂起项
            //（TASK-025：挂起超时接入配置中心 execution.approvalTimeoutMs，默认 180s）
            const actionPromise = this.services.actionHub.waitForAction(call.id, {
              toolName: call.name,
              args: parsedArgs,
              timeoutMs: approvalTimeoutMs,
              sessionId: req.sessionId,
            });

            yield {
              type: "suspended",
              actionId: call.id,
              toolName: call.name,
              args: parsedArgs,
              timeoutMs: approvalTimeoutMs,
            };

            const userAction = await actionPromise;

            // 审批完成后立即同步卡片决策状态，保证后续持久化与重连完全一致
            approvalCard.data.status = userAction.approved ? "approved" : "denied";
            approvalCard.data.reason = userAction.note || userAction.reason;
            (approvalCard.data as any).resolvedAt = Date.now();

            yield {
              type: "resumed",
              actionId: call.id,
              payload: userAction,
            };

            if (!userAction.approved) {
              isError = true;
              errorMessage = `操作被用户驳回: ${userAction.note || userAction.reason || "未批准"}`;
              executionResult = { approved: false, reason: errorMessage };
            }
          }

          // 若未被驳回，在沙箱中执行工具
          if (!isError) {
            // TASK-026 per-tool 超时覆盖：
            // - bash_run：生效命令超时 = per-tool timeoutMs 覆盖 > 模型请求 timeoutMs > 默认 30s，
            //   再按 tools.bashTimeoutCeilingMs 全局封顶；执行器竞速超时放宽 10s 让内层
            //   exec 先触发（保留 timedOut:true 结构化契约，而非笼统的 "timed out" 错误）
            // - 其他工具：per-tool timeoutMs 覆盖执行器 60s 超时上限
            let executorTimeoutMs: number | undefined;
            if (call.name === "bash_run") {
              const argTimeout =
                typeof parsedArgs.timeoutMs === "number" && Number.isFinite(parsedArgs.timeoutMs)
                  ? parsedArgs.timeoutMs
                  : undefined;
              const requested = toolCfg?.timeoutMs ?? argTimeout ?? 30_000;
              const effective = Math.min(Math.max(1, requested), bashTimeoutCeilingMs);
              parsedArgs = { ...parsedArgs, timeoutMs: effective };
              executorTimeoutMs = effective + 10_000;
            } else if (
              typeof toolCfg?.timeoutMs === "number" &&
              Number.isFinite(toolCfg.timeoutMs) &&
              toolCfg.timeoutMs > 0
            ) {
              executorTimeoutMs = toolCfg.timeoutMs;
            }

            const ctx: ToolExecutionContext = {
              toolCallId: call.id,
              args: parsedArgs,
              workspace,
              actionHub: this.services.actionHub,
              abortSignal: runSignal,
            };

            const execRes = await this.services.toolRegistry.execute(
              call.name,
              ctx,
              executorTimeoutMs
            );
            isError = execRes.isError;
            executionResult = execRes.result;
            errorMessage = execRes.error;
          }

          {
            const ev = telemetry.recordEvent({
              at: Date.now(),
              lane: "tool",
              role: "tool",
              title: `工具执行: ${call.name}`,
              detail: JSON.stringify(parsedArgs),
              result: isError ? errorMessage : JSON.stringify(executionResult),
            });
            yield { type: "traj", event: clipTrajectoryEvent(ev) };
          }

          yield {
            type: "tool_call_result",
            toolCallId: call.id,
            toolName: call.name,
            status: isError ? "error" : "done",
            data: executionResult,
            error: errorMessage,
          };

          // TASK-006：收敛调用链卡片终态并派生持久化卡片
          callCard.data.status = isError ? "error" : "done";
          callCard.data.result = executionResult;
          callCard.data.error = errorMessage;
          callCard.data.duration = callCard.data.startedAt
            ? Date.now() - callCard.data.startedAt
            : undefined;

          // bash_run：终端卡持久化原始输出
          if (call.name === "bash_run") {
            accumulatedCards.push({
              id: `term-${call.id}`,
              type: "terminal",
              data: {
                title: `终端执行: ${call.name}`,
                lines: [
                  { text: `$ [状态: ${isError ? "error" : "done"}]`, kind: "cmd" },
                  {
                    text:
                      typeof executionResult === "string"
                        ? executionResult
                        : JSON.stringify(executionResult || errorMessage || ""),
                    kind: isError ? "err" : "stdout",
                  },
                ],
                contentOffset: accumulatedContent.length,
              },
            });
          }

          // ui_* 契约工具：持久化通用 {component, props} 载荷，前端 CardRenderer 动态分发
          // （审批卡由 HITL 流负责、agent_plan 由 turn.plan 负责此处不重复落卡）
          const renderResult =
            !isError && executionResult && typeof executionResult === "object"
              ? (executionResult as { rendered?: boolean; component?: string; props?: Record<string, unknown> })
              : null;
          if (
            renderResult?.rendered &&
            typeof renderResult.component === "string" &&
            renderResult.component !== "ui_approval_card" &&
            renderResult.component !== "ui_agent_plan"
          ) {
            accumulatedCards.push({
              id: `ui-${call.id}`,
              type: "ui",
              data: {
                component: renderResult.component,
                props: renderResult.props || {},
                contentOffset: accumulatedContent.length,
              },
            });
          }

          // 结果喂回上下文
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: isError
              ? `Error: ${errorMessage}`
              : typeof executionResult === "string"
              ? executionResult
              : JSON.stringify(executionResult),
          });
        }

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
      }

      const totalDuration = Date.now() - startAt;
      yield {
        type: "turn_end",
        stepCount: currentStep,
        durationMs: totalDuration,
      };

      // 5. 保存本轮会话
      const turnEntity: TurnEntity = {
        id: turnId,
        sessionId: session.id,
        prompt: req.prompt,
        content: accumulatedContent,
        thought: accumulatedThought,
        cards: accumulatedCards,
        status: "done",
        stepCount: currentStep,
        checkpoints,
        telemetry: {
          durationMs: totalDuration,
          ttftMs: telemetry.exportSummary().ttftMs,
          totalTokens: telemetry.exportSummary().tokens.totalTokens,
          promptTokens: telemetry.exportSummary().tokens.promptTokens,
          completionTokens: telemetry.exportSummary().tokens.completionTokens,
          contextTokens: lastContextTokens,
          laneEventsCount: telemetry.getEvents().length,
          // 轨迹事件明细落库（detail/result 截断），历史会话的 turn 内联轨迹由此恢复
          events: telemetry.getEvents().map(clipTrajectoryEvent),
        },
        createdAt: startAt,
        completedAt: Date.now(),
      };

      await this.services.sessionRepo.appendTurn(session.id, turnEntity);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      // TASK-048：看门狗触发的异常统一改为超时口径（卡在模型流/工具执行内部时
      // 异常从深处冒出，loop-top 检查来不及拦），成因区分不丢
      const msg = watchdogFired
        ? `本轮执行已超时（看门狗上限 ${turnTimeoutSeconds}s）：${rawMsg}`
        : rawMsg;
      yield {
        type: "error",
        message: msg,
      };

      try {
        const errorTurn: TurnEntity = {
          id: turnId,
          sessionId: session.id,
          prompt: req.prompt,
          content: accumulatedContent || `⚠️ 执行过程中发生错误: ${msg}`,
          thought: accumulatedThought,
          cards: accumulatedCards,
          status: "error",
          stepCount: currentStep,
          checkpoints,
          createdAt: startAt,
          completedAt: Date.now(),
        };
        await this.services.sessionRepo.appendTurn(session.id, errorTurn);
      } catch {
        // 忽略存储写入二次异常
      }
    } finally {
      // 看门狗定时器在轮次终态（done/error）后必须清除，避免悬挂计时器
      clearTimeout(watchdogTimer);
    }
  }
}
