import type { HarnessStreamEvent, AgentTurnRequest, ToolExecutionContext } from "./types.js";
import type { WorkspaceRepository } from "../storage/repositories/workspace.repository.js";
import type { SessionRepository } from "../storage/repositories/session.repository.js";
import type { SettingsRepository } from "../storage/repositories/settings.repository.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ActionHub } from "./action-hub.js";
import type { IModelDriver } from "../adapters/model-driver.js";
import { OpenAICompatibleDriver } from "../adapters/openai-driver.js";
import { MockDriver } from "../adapters/mock-driver.js";
import { ContextCompactor, type ChatMessage } from "./context-compactor.js";
import { parsePartialJson } from "./stream-orchestrator.js";
import { TelemetryLedger, clipTrajectoryEvent } from "./telemetry.js";
import { runSandboxDemoTurn } from "./sandbox-demo.js";
import type { CheckpointEntity, TurnEntity } from "../storage/interfaces.js";

export interface AgentLoopServices {
  workspaceRepo: WorkspaceRepository;
  sessionRepo: SessionRepository;
  settingsRepo: SettingsRepository;
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
    const maxSteps = req.maxSteps ?? 15;

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

    // 系统提示词
    const systemPromptParts: string[] = [
      "你是一个基于标准 Harness 运行的高级智能体助手。",
      `当前工作区: ${workspace.name} (路径: ${workspace.rootPath})`,
      workspace.systemInstruction || "",
      session.systemContext || "",
    ].filter(Boolean);

    messages.push({
      role: "system",
      content: systemPromptParts.join("\n\n"),
    });

    // 恢复历史会话
    for (const pastTurn of session.turns) {
      messages.push({ role: "user", content: pastTurn.prompt });
      // 提取最新检查点的消息状态（旧数据 errorTurn 可能无 checkpoints 字段，需防御）
      const cps = pastTurn.checkpoints;
      const lastCp = cps && cps.length > 0 ? cps[cps.length - 1] : undefined;
      if (lastCp && Array.isArray(lastCp.messagesSnapshot)) {
        for (const item of lastCp.messagesSnapshot as ChatMessage[]) {
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
        },
        (turnEntity) => this.services.sessionRepo.appendTurn(session.id, turnEntity)
      );
      return;
    }

    let accumulatedContent = "";
    let accumulatedThought = "";
    let lastContextTokens = 0;
    const accumulatedCards: Array<{ id: string; type: string; data: any }> = [];

    try {
      // 4. 进入 ReAct 核心回环
      while (currentStep < maxSteps) {
        if (abortSignal?.aborted) {
          yield { type: "error", message: "Agent execution was aborted by client" };
          break;
        }

        currentStep++;
        // 裁剪阈值跟随模型真实窗口（约 85%）：固定 16k 阈值会在长会话中过早清掉历史，
        // 造成每轮占用跳水（前端仪表呈"清零重算"观感）。工具结果截断与 sanitize 不受影响。
        const compactedMessages = this.compactor.compact(messages, {
          maxTokens: Math.floor((modelProfile.contextWindow || 128_000) * 0.85),
        });
        const toolsDefinition = this.services.toolRegistry.toModelToolDefinitions();

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
          abortSignal,
        });

        for await (const chunk of stream) {
          if (abortSignal?.aborted) break;

          if (chunk.type === "usage" && chunk.usage) {
            telemetry.addTokens(chunk.usage.promptTokens, chunk.usage.completionTokens);
            // 窗口占用口径（与 Codex/Claude Code 一致）：promptTokens 为本步发送的全部上下文
            // （ReAct 每步重发历史，取"最近一次调用"即当前真实占用），前端直接覆盖展示；
            // 跨步累加值仅作为计费口径存入 telemetry.totalTokens，不推给窗口仪表。
            lastContextTokens =
              chunk.usage.promptTokens + chunk.usage.completionTokens;
            yield {
              type: "usage",
              promptTokens: chunk.usage.promptTokens,
              completionTokens: chunk.usage.completionTokens,
              totalTokens: lastContextTokens,
              contextWindow: modelProfile.contextWindow,
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
          // 无工具调用，表示 Agent 任务已彻底完成
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
          if (abortSignal?.aborted) break;

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
          const permission = req.permission || "review";

          let executionResult: unknown;
          let isError = false;
          let errorMessage: string | undefined;

          // 权限模式与审批判断
          let requiresApproval = false;
          if (permission === "auto") {
            // 自动执行模式：Agent 自主执行工具，无需人工审批介入
            requiresApproval = false;
          } else if (permission === "read-only" || permission === "readonly") {
            // 只读模式：禁止写操作与高危执行
            const isWriteTool = ["write_file", "edit_file", "run_command", "bash_run", "delete_file"].includes(call.name);
            if (isWriteTool) {
              isError = true;
              errorMessage = `[只读模式限制] 当前工作区权限为只读 (read-only)，已拦截写操作工具 [${call.name}]`;
              executionResult = { approved: false, reason: errorMessage };
            }
          } else {
            // 审批模式 (review)：高风险或需审批的工具进入 HITL 挂起
            requiresApproval = toolDef?.requiresApproval === true || toolDef?.riskLevel === "high";
          }

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
            const actionPromise = this.services.actionHub.waitForAction(call.id, {
              toolName: call.name,
              args: parsedArgs,
              sessionId: req.sessionId,
            });

            yield {
              type: "suspended",
              actionId: call.id,
              toolName: call.name,
              args: parsedArgs,
              timeoutMs: 180_000,
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
            const ctx: ToolExecutionContext = {
              toolCallId: call.id,
              args: parsedArgs,
              workspace,
              actionHub: this.services.actionHub,
              abortSignal: abortSignal || new AbortController().signal,
            };

            const execRes = await this.services.toolRegistry.execute(call.name, ctx);
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
      const msg = err instanceof Error ? err.message : String(err);
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
    }
  }
}
