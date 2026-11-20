import type { HarnessStreamEvent, ToolExecutionContext } from "./types.js";
import type { ToolConfigRepository } from "../storage/repositories/tool-config.repository.js";
import type { SessionRepository } from "../storage/repositories/session.repository.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ActionHub } from "./action-hub.js";
import type { WorkspaceEntity } from "../storage/interfaces.js";
import type { EffectivePermissionMode } from "./permissions.js";
import { resolveLivePermissionMode } from "./permissions.js";
import { parsePartialJson } from "./stream-orchestrator.js";
import { clipTrajectoryEvent, type TelemetryLedger } from "./telemetry.js";
import type { ChatMessage } from "./context-compactor.js";
import type { OpsReporter } from "./ops-reporter.js";
import {
  createToolGuardState,
  runToolGuards,
  type ToolGuardContext,
} from "./tool-guards.js";

/**
 * 工具调用执行段（TASK-057 自 agent-loop.ts 拆出，行为逐字节等价）：
 * 启停仲裁 → 工作区闸门 → 权限模式 → HITL 审批 → 沙箱执行 → 卡片收敛 → 结果喂回上下文。
 *
 * 接收上下文对象、以异步生成器返回结果事件流；ReAct 主循环只负责调用与转发。
 */

export interface ToolStepExecutorDeps {
  toolConfigRepo: ToolConfigRepository;
  sessionRepo: SessionRepository;
  toolRegistry: ToolRegistry;
  actionHub: ActionHub;
  ops: OpsReporter;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  argumentsStr: string;
}

export interface ToolStepInput {
  /** 本步解析出的完整工具调用集合 */
  calls: ToolCallRecord[];
  /** 整轮中止信号（客户端 abort 与看门狗合并后） */
  runSignal: AbortSignal;
  workspace: WorkspaceEntity;
  sessionId: string;
  /** 轮次起点交集解析的生效模式（请求级∩会话级，更严者生效） */
  effectiveMode: EffectivePermissionMode;
  /** 轮次开始时的会话档（运行中改档感知的基线） */
  sessionPermissionAtStart: string | undefined;
  approvalTimeoutMs: number;
  bashTimeoutCeilingMs: number;
  /** 正文长度读取器：卡片 contentOffset 对齐 blocks 时序定位机制 */
  getContentLength: () => number;
  /** 卡片累积表（调用链卡/审批卡/终端卡/ui 卡原地收敛后 push 进来） */
  accumulatedCards: Array<{ id: string; type: string; data: any }>;
  /** ReAct 上下文（tool 结果就地喂回） */
  messages: ChatMessage[];
  telemetry: TelemetryLedger;
}

export async function* executeToolCallStep(
  deps: ToolStepExecutorDeps,
  input: ToolStepInput
): AsyncIterable<HarnessStreamEvent> {
  const {
    calls,
    runSignal,
    workspace,
    sessionId,
    effectiveMode,
    sessionPermissionAtStart,
    approvalTimeoutMs,
    bashTimeoutCeilingMs,
    getContentLength,
    accumulatedCards,
    messages,
    telemetry,
  } = input;

  // 逐个执行工具调用
  for (const call of calls) {
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
        contentOffset: getContentLength(),
      },
    };
    accumulatedCards.push(callCard);

    const toolDef = deps.toolRegistry.get(call.name);
    const toolCfg = await deps.toolConfigRepo.get(call.name);

    // TASK-012 权限仲裁（评审 P0-2 修复）：
    // ① 请求级 req.permission 与会话级 session.permission 取交集，更严者生效。
    //    严重度：read-only(3) > review(2) > auto(1)
    // TASK-014：轮次起点交集解析（effectiveMode）供系统提示词声明；
    // 运行中改档感知（用户反馈）：逐工具调用重读会话最新档，与起点不一致
    // （UI 改档即 PATCH 会话）则以最新会话档为准——正在输出的轮次对
    // 「后续工具调用」立即可感知权限变化，而非等到下一轮才生效
    let mode = effectiveMode;
    try {
      const latestSession = await deps.sessionRepo.get(sessionId);
      if (latestSession) {
        mode = resolveLivePermissionMode(
          effectiveMode,
          sessionPermissionAtStart,
          latestSession.permission
        );
      }
    } catch {
      // 会话读取失败时保守回落轮次起点口径，不阻断仲裁
    }

    // 守卫链（TASK-071 自内联序列提取，行为逐字节等价）：
    // 启停仲裁 → 工作区级硬闸门 → 只读模式闸门 → 审批判定（deny-wins）→ 入参闸门 → 超时策略。
    // 裁决文案与短路顺序是契约面，定义见 core/tool-guards.ts；
    // HITL 挂起与沙箱执行是流耦合副作用，留在本生成器内消费裁决结果
    const guardCtx: ToolGuardContext = {
      call,
      toolDef,
      toolCfg,
      workspacePermission: workspace.permission,
      mode,
      parsedArgs,
      validateParams: (name, args) => deps.toolRegistry.validateParams(name, args),
      bashTimeoutCeilingMs,
    };
    const guardState = createToolGuardState();
    await runToolGuards(guardCtx, guardState);
    let executionResult: unknown = guardState.executionResult;
    let isError = guardState.isError;
    let errorMessage: string | undefined = guardState.errorMessage;
    const requiresApproval = guardState.requiresApproval;

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
          // 工具入参快照：供前端对特定工具渲染富审批 UI（如 ui_email_draft 直接以
          // VaEmailDraft 呈现草稿，发送=批准、重新起草=拒绝），缺省时回退 command 文本
          args: parsedArgs,
          risk: toolDef?.riskLevel || "high",
          expiresInSec: 180,
          status: "pending",
          reason: "" as string | undefined,
          resolvedAt: 0 as number | undefined,
          contentOffset: getContentLength(),
        },
      };
      accumulatedCards.push(approvalCard);

      // 提前挂起并进入等待表，确保外部可以立刻查询到该挂起项
      //（TASK-025：挂起超时接入配置中心 execution.approvalTimeoutMs，默认 180s）
      const actionPromise = deps.actionHub.waitForAction(call.id, {
        toolName: call.name,
        args: parsedArgs,
        timeoutMs: approvalTimeoutMs,
        sessionId,
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

    // 若未被驳回，在沙箱中执行工具（超时策略已由守卫链裁决：
    // executorTimeoutMs 与 bash 钳制后入参见 guardState.effectiveParsedArgs）
    let toolDurationMs = 0;
    if (!isError) {
      parsedArgs = guardState.effectiveParsedArgs;

      const ctx: ToolExecutionContext = {
        toolCallId: call.id,
        args: parsedArgs,
        workspace,
        actionHub: deps.actionHub,
        abortSignal: runSignal,
      };

      const execRes = await deps.toolRegistry.execute(
        call.name,
        ctx,
        guardState.executorTimeoutMs
      );
      isError = execRes.isError;
      executionResult = execRes.result;
      errorMessage = execRes.error;
      toolDurationMs = execRes.durationMs;
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

    // TASK-051：工具结果运维事件（含禁用/驳回/执行失败三类非 ok 路径）
    deps.ops.toolResult({
      tool: call.name,
      ok: !isError,
      durationMs: toolDurationMs,
      error: isError ? errorMessage : undefined,
    });

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
          contentOffset: getContentLength(),
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
          contentOffset: getContentLength(),
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
}
