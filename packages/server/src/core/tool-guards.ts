import type { HarnessTool } from "./types.js";
import type { EffectivePermissionMode } from "./permissions.js";
import type { WorkspacePermission } from "../storage/interfaces.js";
import type { ToolConfigEntity } from "../storage/repositories/tool-config.repository.js";
import { runGuards, type Guard, type GuardVerdict } from "./pipeline.js";

/**
 * 工具调用守卫链（自 tool-step-executor 的固定裁决序列提取为可组合切面）：
 *
 *   启停仲裁 → 工作区级硬闸门 → 只读模式闸门 → 审批判定（deny-wins）→ 入参闸门 → 超时策略
 *
 * 与原内联实现逐字节等价：
 * - 裁决顺序不变，首个失败短路（原 else-if / !isError 守卫的隐式顺序显式化）；
 * - 文案不变（喂回模型的错误文案是契约面，改动会破坏测试与前端提示对齐）；
 * - 审批判定与超时策略是非失败守卫：只向共享 state 写派生值，不参与短路。
 *
 * HITL 挂起与沙箱执行是流耦合副作用（需 yield SSE 事件），留在 tool-step-executor
 * 生成器壳内消费本链的裁决结果——守卫链管「能不能跑」，生成器管「怎么跑」。
 */

export interface ToolGuardContext {
  call: { id: string; name: string; argumentsStr: string };
  /** 工具定义（registry.get，可能不存在） */
  toolDef: HarnessTool | undefined;
  /** 全局工具配置（toolConfigRepo.get，可能无记录） */
  toolCfg: ToolConfigEntity | null;
  workspacePermission: WorkspacePermission;
  /** 生效权限模式（轮次起点交集 ∩ 运行中会话最新档） */
  mode: EffectivePermissionMode;
  /** 已解析的入参（JSON 容错解析后） */
  parsedArgs: Record<string, unknown>;
  /** 入参闸门注入（registry.validateParams） */
  validateParams: (toolName: string, args: unknown) => { ok: boolean; error?: string };
  /** bash 超时全局封顶（tools.bashTimeoutCeilingMs） */
  bashTimeoutCeilingMs: number;
}

export interface ToolGuardState {
  isError: boolean;
  errorMessage?: string;
  executionResult?: unknown;
  /** HITL 判定结果（approvalDecision 守卫写入；review 模式 + 高风险/覆盖为 true 时挂起） */
  requiresApproval: boolean;
  /** 实际执行入参（timeoutPolicy 守卫写入：bash 超时钳制后覆盖） */
  effectiveParsedArgs: Record<string, unknown>;
  /** 执行器超时（timeoutPolicy 守卫写入） */
  executorTimeoutMs?: number;
}

/** 守卫 1：启停仲裁——禁用即最终裁决，不进入权限链与执行 */
const disabledGuard: Guard<ToolGuardContext, ToolGuardState> = (ctx, state): GuardVerdict => {
  if (ctx.toolCfg && ctx.toolCfg.enabled === false) {
    const message = `工具 [${ctx.call.name}] 已被禁用（设置 → 工具 页可重新启用）`;
    state.isError = true;
    state.errorMessage = message;
    state.executionResult = { disabled: true, reason: message };
    return { ok: false, errorMessage: message, executionResult: state.executionResult };
  }
  return { ok: true };
};

/** 守卫 2：工作区级硬闸门——read-only 工作区在任何模式（含 auto）下拦截写工具 */
const workspaceReadOnlyGate: Guard<ToolGuardContext, ToolGuardState> = (ctx, state): GuardVerdict => {
  const writesWorkspace = ctx.toolDef?.writesWorkspace === true;
  if (writesWorkspace && ctx.workspacePermission === "read-only") {
    const message = `[工作区权限限制] 当前工作区权限为只读 (read-only)，已拦截写操作工具 [${ctx.call.name}]`;
    state.isError = true;
    state.errorMessage = message;
    state.executionResult = { approved: false, reason: message };
    return { ok: false, errorMessage: message };
  }
  return { ok: true };
};

/** 守卫 3：只读模式闸门——按工具元数据拦截一切写工作区工具 */
const readOnlyModeGate: Guard<ToolGuardContext, ToolGuardState> = (ctx, state): GuardVerdict => {
  const writesWorkspace = ctx.toolDef?.writesWorkspace === true;
  if (ctx.mode === "read-only" && writesWorkspace) {
    const message = `[只读模式限制] 当前权限模式为只读 (read-only)，已拦截写操作工具 [${ctx.call.name}]`;
    state.isError = true;
    state.errorMessage = message;
    state.executionResult = { approved: false, reason: message };
    return { ok: false, errorMessage: message };
  }
  return { ok: true };
};

/**
 * 守卫 4：审批判定（非失败守卫）——review 模式下高风险或需审批的工具进入 HITL；
 * deny-wins：toolCfg.requiresApproval=true 可追加，false 不放宽既有推导
 * （安全项只能升不能降，存储的 false 视为无效）。
 */
const approvalDecision: Guard<ToolGuardContext, ToolGuardState> = (ctx, state): GuardVerdict => {
  if (ctx.mode === "review") {
    state.requiresApproval =
      ctx.toolDef?.requiresApproval === true ||
      ctx.toolDef?.riskLevel === "high" ||
      ctx.toolCfg?.requiresApproval === true;
  }
  return { ok: true };
};

/** 守卫 5：入参闸门——非法入参在 HITL 挂起判断前拦截（不产生审批卡、不占人工注意力） */
const paramGate: Guard<ToolGuardContext, ToolGuardState> = (ctx, state): GuardVerdict => {
  const validation = ctx.validateParams(ctx.call.name, ctx.parsedArgs);
  if (!validation.ok) {
    state.isError = true;
    state.errorMessage = validation.error;
    return { ok: false, errorMessage: validation.error };
  }
  return { ok: true };
};

/**
 * 守卫 6：超时策略（非失败守卫）——
 * bash_run：生效命令超时 = per-tool 覆盖 > 模型请求 timeoutMs > 默认 30s，再按全局封顶；
 * 其他工具：per-tool 覆盖执行器 60s 超时上限。
 */
const timeoutPolicy: Guard<ToolGuardContext, ToolGuardState> = (ctx, state): GuardVerdict => {
  state.effectiveParsedArgs = ctx.parsedArgs;
  if (ctx.call.name === "bash_run") {
    const argTimeout =
      typeof ctx.parsedArgs.timeoutMs === "number" && Number.isFinite(ctx.parsedArgs.timeoutMs)
        ? ctx.parsedArgs.timeoutMs
        : undefined;
    const requested = ctx.toolCfg?.timeoutMs ?? argTimeout ?? 30_000;
    const effective = Math.min(Math.max(1, requested), ctx.bashTimeoutCeilingMs);
    state.effectiveParsedArgs = { ...ctx.parsedArgs, timeoutMs: effective };
    state.executorTimeoutMs = effective + 10_000;
  } else if (
    typeof ctx.toolCfg?.timeoutMs === "number" &&
    Number.isFinite(ctx.toolCfg.timeoutMs) &&
    ctx.toolCfg.timeoutMs > 0
  ) {
    state.executorTimeoutMs = ctx.toolCfg.timeoutMs;
  }
  return { ok: true };
};

/** 守卫链（顺序即裁决顺序，勿重排——文案与短路行为是契约面） */
export const TOOL_GUARDS: readonly Guard<ToolGuardContext, ToolGuardState>[] = [
  disabledGuard,
  workspaceReadOnlyGate,
  readOnlyModeGate,
  approvalDecision,
  paramGate,
  timeoutPolicy,
];

export async function runToolGuards(ctx: ToolGuardContext, state: ToolGuardState): Promise<GuardVerdict> {
  return runGuards(TOOL_GUARDS, ctx, state);
}

export function createToolGuardState(): ToolGuardState {
  return {
    isError: false,
    errorMessage: undefined,
    executionResult: undefined,
    requiresApproval: false,
    effectiveParsedArgs: {},
    executorTimeoutMs: undefined,
  };
}
