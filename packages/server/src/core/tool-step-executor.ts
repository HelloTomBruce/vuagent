import type { HarnessStreamEvent, ToolExecutionContext } from "./types.js";
import type { ToolConfigRepository } from "../storage/repositories/tool-config.repository.js";
import type { SessionRepository } from "../storage/repositories/session.repository.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { ActionHub } from "./action-hub.js";
import type { WorkspaceEntity } from "../storage/interfaces.js";
import type { EffectivePermissionMode } from "./permissions.js";
import { resolveLivePermissionMode } from "./permissions.js";
import { sanitizeForLog } from "../security.js";
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
 *
 * TASK-094 并行执行（execution.parallelTools，默认开）：
 * - Phase A 决策段（串行）：解析/守卫链/权限重读/HITL 审批逐 call 实时——审批语义、
 *   suspended/resumed 事件序与旧版逐字节一致；守卫/驳回早败路径的结果事件即时发出；
 * - Phase B 执行段（并行）：不同名读类工具的沙箱执行并行（Promise.all），**同名工具
 *   互斥串行**（保守口径——fs 写等以名字近似的互斥粒度，细化转 backlog）；
 *   写类工具（writesWorkspace=true）统一并入单一串行写组并与所有其他组互斥
 *   （先写后读屏障序，评审 #3：跨名写并行会竞态写坏工作区）；
 *   任一分支失败时队列经 finally 收尾、错误重抛（评审 C3：失败不再永久卡死 drain）；
 *   每个工具的结果事件（traj / tool_call_result）按完成时序即时流出（AsyncEventQueue），
 *   不等待整批结束——长工具不挡住快工具的事件面；
 * - Phase C 归位段：tool 结果消息按 call 序追加进 messages（模型侧确定性序），
 *   早败路径同样延迟到本段写入——保证整体消息序与工具声明序一致。
 * 派生卡片（终端/差异/ui 卡）与遥测事件按完成时序落表（并行语义下的自然序）；
 * 卡片定位不依赖数组序（contentOffset 机制），并行不改变其定位语义。
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
  /** TASK-091：审批挂起前强制落盘缓冲中的最新进度（含审批卡），挂起窗口（可达 180s）内崩溃不丢痕 */
  beforeSuspend?: () => Promise<void> | void;
  /** TASK-094：工具并行执行开关（execution.parallelTools，默认 true；false 回退旧串行语义） */
  parallelTools?: boolean;
}

/** 调用链卡片（TASK-006 持久化卡片的运行时形态） */
interface CallCard {
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
}

/** Phase A 决策结果：沙箱执行阶段所需的全部裁决态 */
interface CallDecision {
  call: ToolCallRecord;
  parsedArgs: Record<string, unknown>;
  isError: boolean;
  errorMessage?: string;
  /** 早败路径的执行结果（如驳回的 { approved:false }）；执行路径由 registry 产出 */
  earlyResult?: unknown;
  /** 守卫链超时策略裁决值（timeoutPolicy 守卫写入；undefined 时 registry 走默认 60s） */
  executorTimeoutMs?: number;
  effectiveParsedArgs: Record<string, unknown>;
  callCard: CallCard;
  /** 结果事件缓冲（traj + tool_call_result），按完成时序流出 */
  events: HarnessStreamEvent[];
  /** 结果消息（Phase C 按 call 序归位；isError→Error 文案，否则正文/JSON） */
  resultMessage?: ChatMessage;
}

/** 执行段事件队列：结果事件按完成时序即时流出，不阻塞等待整批 */
class AsyncEventQueue<T> {
  private items: T[] = [];
  private waiting: Array<() => void> = [];
  private closed = false;

  push(item: T): void {
    this.items.push(item);
    this.notify();
  }

  /** 生产端收尾：唤醒等待中的消费端让 drain 退出 */
  close(): void {
    this.closed = true;
    this.notify();
  }

  private notify(): void {
    const waiters = this.waiting.splice(0);
    for (const resolve of waiters) resolve();
  }

  /** 生成器式排空：有事件即流出；close 且队空后结束 */
  async *drain(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length > 0) {
        yield this.items.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
  }
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
  } = input;

  const decisions: CallDecision[] = [];
  const toExecute: CallDecision[] = [];

  /* ================= Phase A：决策段（串行，事件实时） ================= */
  for (const call of calls) {
    if (runSignal.aborted) break;

    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(call.argumentsStr || "{}");
    } catch {
      // TASK-101：partial JSON 静默修复可观测化——修复即发 ops 事件（不再无声吞掉格式错误）
      parsedArgs = parsePartialJson(call.argumentsStr) || {};
      deps.ops.partialRepair(call.name);
    }

    // TASK-089：args 日志经脱敏——密钥样键名掩码、长字符串（文件内容/base64）截断
    console.log(`[Vuagent Tool] Executing tool [${call.name}] args: ${sanitizeForLog(parsedArgs)}`);
    yield {
      type: "tool_call_executing",
      toolCallId: call.id,
      toolName: call.name,
      args: parsedArgs,
    };

    // TASK-006：工具调用链卡片持久化（刷新后卡片可恢复）
    // contentOffset 对齐 blocks 时序定位机制；tool_call_result 时原地收敛终态
    const callCard: CallCard = {
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

    const decision: CallDecision = {
      call,
      parsedArgs,
      isError: false,
      effectiveParsedArgs: {},
      callCard,
      events: [],
    };
    decisions.push(decision);

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
      validateParams: deps.toolRegistry.validateParams.bind(deps.toolRegistry),
      bashTimeoutCeilingMs,
    };
    const guardState = createToolGuardState();
    await runToolGuards(guardCtx, guardState);
    let executionResult: unknown = guardState.executionResult;
    decision.isError = guardState.isError;
    decision.errorMessage = guardState.errorMessage;
    const requiresApproval = guardState.requiresApproval;

    // HITL 拦截机制 (仅在需要人工审批且未被只读限制时进入)
    if (requiresApproval && !decision.isError) {
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
          // 工具入参快照：供前端对特定工具渲染富审批 UI（组件内决策替代 JSON 预览），
          // 缺省时回退 command 文本
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

      console.log(`[Vuagent Tool] Suspended for approval: [${call.name}], actionId=${call.id}`);
      yield {
        type: "suspended",
        actionId: call.id,
        toolName: call.name,
        args: parsedArgs,
        timeoutMs: approvalTimeoutMs,
      };

      // TASK-091：挂起窗口前强制落盘（挂起可达 approvalTimeoutMs=180s，期间崩溃须留痕）
      await input.beforeSuspend?.();

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
        decision.isError = true;
        decision.errorMessage = `操作被用户驳回: ${userAction.note || userAction.reason || "未批准"}`;
        executionResult = { approved: false, reason: decision.errorMessage };
      }
    }

    if (decision.isError) {
      // 早败路径（守卫拦截 / 审批驳回）：结果事件即时实时发出（串行口径与旧行为一致）；
      // 结果消息延迟到 Phase C 按 call 序归位
      decision.earlyResult = executionResult;
      decision.resultMessage = {
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: `Error: ${decision.errorMessage}`,
      };
      finalizeAndEmit(deps, input, decision, true, executionResult, decision.errorMessage, 0);
      for (const event of decision.events) yield event;
      decision.events.length = 0;
    } else {
      decision.executorTimeoutMs = guardState.executorTimeoutMs;
      decision.effectiveParsedArgs = guardState.effectiveParsedArgs;
      toExecute.push(decision);
    }
  }

  /* ================= Phase B：执行段（并行/串行双形态） ================= */
  if (toExecute.length > 0) {
    if (!input.parallelTools || toExecute.length <= 1) {
      // 串行形态（开关关闭 / 单工具）：与旧行为逐字节一致
      for (const decision of toExecute) {
        await runSandboxExec(deps, input, decision);
        for (const event of decision.events) yield event;
        decision.events.length = 0;
      }
    } else {
      // 并行形态分组（评审 C3/#3）：
      // - 读类工具按名字互斥并行（同名串行，保守口径不变）；
      // - 写类工具（writesWorkspace=true，见 HarnessTool 声明）统一并入单一串行写组，
      //   且与「所有其他组」互斥（先写后读屏障序）——跨名写并行（如 fs_write + bash_run）
      //   会竞态写坏工作区，写与读并行则读到撕裂状态；
      //   未声明 writesWorkspace 的工具按读类处理（写副作用必须显式声明 true）。
      const groups = new Map<string, CallDecision[]>();
      let writesGroup: CallDecision[] | undefined;
      for (const decision of toExecute) {
        const isWrite =
          deps.toolRegistry.get(decision.call.name)?.writesWorkspace === true;
        if (isWrite) {
          writesGroup ??= [];
          writesGroup.push(decision);
          continue;
        }
        const group = groups.get(decision.call.name) ?? [];
        group.push(decision);
        groups.set(decision.call.name, group);
      }
      const queue = new AsyncEventQueue<HarnessStreamEvent>();
      const runGroup = async (group: CallDecision[]): Promise<void> => {
        for (const decision of group) {
          await runSandboxExec(deps, input, decision);
          for (const event of decision.events) queue.push(event);
          decision.events.length = 0;
        }
      };
      // C3 修复：收尾用 finally——任一分支失败时队列也要关闭，让 drain 正常结束、
      // 生成器走到 `await work` 把原始错误重抛给上层（对齐串行路径轮次落 error 语义）。
      // 此前 `.then(() => queue.close())` 在失败路径不关闭队列，drain 永久挂起。
      const work = (async () => {
        if (writesGroup) {
          // 屏障序：写组独占先执行（执行期并发=1），结束后读组再按名字互斥并行
          await runGroup(writesGroup);
        }
        await Promise.all([...groups.values()].map(runGroup));
      })().finally(() => {
        queue.close();
      });
      yield* queue.drain();
      await work;
    }
  }

  /* ================= Phase C：结果消息按 call 序归位 ================= */
  for (const decision of decisions) {
    if (decision.resultMessage) {
      messages.push(decision.resultMessage);
    }
  }
}

/**
 * 沙箱执行（Phase B 单工具）：registry.execute（超时策略已由守卫链裁决）→
 * 结果归账 → finalizeAndEmit（事件缓冲进 decision.events，由调用方按时机流出）。
 */
async function runSandboxExec(
  deps: ToolStepExecutorDeps,
  input: ToolStepInput,
  decision: CallDecision
): Promise<void> {
  const ctx: ToolExecutionContext = {
    toolCallId: decision.call.id,
    args: decision.effectiveParsedArgs,
    workspace: input.workspace,
    actionHub: deps.actionHub,
    abortSignal: input.runSignal,
  };

  const execRes = await deps.toolRegistry.execute(
    decision.call.name,
    ctx,
    decision.executorTimeoutMs
  );
  finalizeAndEmit(
    deps,
    input,
    decision,
    execRes.isError,
    execRes.result,
    execRes.error,
    execRes.durationMs ?? 0
  );
}

/**
 * 结果归账与事件装配（双路径共用）：
 * traj 遥测事件 → ops 运维事件 → 日志 → tool_call_result 事件 → 卡片终态收敛
 * （调用链卡原地收敛 + bash 终端卡 + fs_edit 差异卡 + ui 契约卡）→ 结果消息。
 * 事件写入 decision.events 缓冲（不直接 yield），时序由生成器按路径决定。
 */
function finalizeAndEmit(
  deps: ToolStepExecutorDeps,
  input: ToolStepInput,
  decision: CallDecision,
  isError: boolean,
  executionResult: unknown,
  errorMessage: string | undefined,
  toolDurationMs: number
): void {
  const { call, callCard, parsedArgs } = decision;
  const { telemetry, accumulatedCards, getContentLength } = input;

  {
    const ev = telemetry.recordEvent({
      at: Date.now(),
      lane: "tool",
      role: "tool",
      title: `工具执行: ${call.name}`,
      detail: JSON.stringify(parsedArgs),
      result: isError ? errorMessage : JSON.stringify(executionResult),
    });
    decision.events.push({ type: "traj", event: clipTrajectoryEvent(ev) });
  }

  // TASK-051：工具结果运维事件（含禁用/驳回/执行失败三类非 ok 路径）
  deps.ops.toolResult({
    tool: call.name,
    ok: !isError,
    durationMs: toolDurationMs,
    error: isError ? errorMessage : undefined,
  });

  console.log(`[Vuagent Tool] Tool [${call.name}] result (error=${isError})`);
  decision.events.push({
    type: "tool_call_result",
    toolCallId: call.id,
    toolName: call.name,
    status: isError ? "error" : "done",
    data: executionResult,
    error: errorMessage,
  });

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

  // fs_edit 自然投影：成功编辑时派发代码差异卡片 (Diff)，免除模型调用伪工具 ui_code_diff 的负担
  if (call.name === "fs_edit" && !isError) {
    accumulatedCards.push({
      id: `diff-${call.id}`,
      type: "diff",
      data: {
        file: String(parsedArgs.filePath || ""),
        oldCode: String(parsedArgs.oldString || ""),
        newCode: String(parsedArgs.newString || ""),
        view: "unified",
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

  // 结果消息（Phase C 按 call 序归位）
  decision.resultMessage = {
    role: "tool",
    tool_call_id: call.id,
    name: call.name,
    content: isError
      ? `Error: ${errorMessage}`
      : typeof executionResult === "string"
      ? executionResult
      : JSON.stringify(executionResult),
  };
}
