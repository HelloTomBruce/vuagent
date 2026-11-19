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

    let executionResult: unknown;
    let isError = false;
    let errorMessage: string | undefined;

    // 工具启停仲裁（TASK-019）+ per-tool 覆盖（TASK-026）：逐调用实时重读该工具
    // 配置记录——模型上下文可能残留轮次开始时的旧 definitions（禁用前已下发），
    // 此兜底保证禁用语义不被绕过；禁用即最终裁决，不再进入权限链与执行
    const toolCfg = await deps.toolConfigRepo.get(call.name);
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

    // TASK-059 入参闸门前移：幻觉入参在 HITL 挂起判断前拦截——
    // 非法入参直接走 isError 路径回喂模型（附校验错误文案），
    // 不产生审批卡、不占用人工注意力；审批卡只在「参数合法且需人工决策」时出现。
    // （!isError 守卫：工具禁用/只读拦截已裁决时，不覆写既有错误）
    if (!isError) {
      const validation = deps.toolRegistry.validateParams(call.name, parsedArgs);
      if (!validation.ok) {
        isError = true;
        errorMessage = validation.error;
      }
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

    // 若未被驳回，在沙箱中执行工具
    let toolDurationMs = 0;
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
        actionHub: deps.actionHub,
        abortSignal: runSignal,
      };

      const execRes = await deps.toolRegistry.execute(
        call.name,
        ctx,
        executorTimeoutMs
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
