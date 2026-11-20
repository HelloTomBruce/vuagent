import { composeMiddleware, type Middleware } from "./pipeline.js";
import type { HarnessEventSink } from "./event-sink.js";
import type { CostRecordRepository } from "../storage/repositories/cost-record.repository.js";
import type { SessionExecutionHub } from "./session-execution-hub.js";
import type { ConfigResolver } from "./config-resolver.js";

/**
 * 轮次准入洋葱管线（TASK-072 并发/配额内联逻辑提取为可组合中间件）：
 *
 *   并发门禁 → 配额门禁 → terminal（真实放行处理）
 *
 * 短路语义：任一中间件拒绝时写入 ctx.rejection 且不调 next——后续检查与
 * terminal 不再执行。拒绝口径（状态码/文案/code）保持与原内联实现逐字节一致。
 * 新增准入策略 = 追加一个中间件，不再改动路由主体。
 */

export interface AdmissionRejection {
  status: 429;
  body: Record<string, unknown>;
}

export interface AdmissionContext {
  /** 会话 id（并发豁免判定与配额告警关联用，可能缺省） */
  sessionId?: string;
  /** 顶替请求：目标会话运行中时并发计数豁免 1（避免 maxConcurrentTurns=1 时 preempt 死锁） */
  preempt: boolean;
  /** 拒绝结果（中间件写入；terminal 检查） */
  rejection?: AdmissionRejection;
}

export interface AdmissionDeps {
  executionHub: Pick<SessionExecutionHub, "isRunning" | "runningCount">;
  configResolver?: ConfigResolver;
  costRepo: Pick<CostRecordRepository, "sumWindow">;
  eventSink: HarnessEventSink;
}

/** 中间件 1：并发门禁——runningCount 实时计数，超限 429（maxConcurrentTurns=0 不限） */
export function createConcurrencyAdmission(
  deps: AdmissionDeps,
  maxConcurrentTurns: number
): Middleware<AdmissionContext> {
  return async (ctx, next) => {
    // 顶替豁免：preempt 目标会话的旧轮即将被顶替释放，计数豁免 1——
    // 此前 maxConcurrentTurns=1 时 preempt 永远 429 死锁。
    const preemptReleases =
      maxConcurrentTurns > 0 && ctx.preempt && ctx.sessionId && deps.executionHub.isRunning(ctx.sessionId)
        ? 1
        : 0;
    if (
      maxConcurrentTurns > 0 &&
      deps.executionHub.runningCount() - preemptReleases >= maxConcurrentTurns
    ) {
      deps.eventSink.emit({
        type: "warn",
        at: Date.now(),
        code: "CONCURRENCY_REJECTED",
        sessionId: ctx.sessionId,
        detail: `running=${deps.executionHub.runningCount()} >= max=${maxConcurrentTurns}`,
      });
      ctx.rejection = {
        status: 429,
        body: {
          error: "全局并发轮次已达上限，请等待现有任务完成或调整并发上限设置",
          code: "CONCURRENCY_REJECTED",
        },
      };
      return; // 短路：不调 next
    }
    await next();
  };
}

/** 中间件 2：配额门禁——滚动窗口 token/费用累计，超限 429（0=不限） */
export function createQuotaAdmission(deps: AdmissionDeps): Middleware<AdmissionContext> {
  return async (ctx, next) => {
    const finopsAdmission = await deps.configResolver?.resolve("finops");
    const windowTokenLimit = Number(finopsAdmission?.windowTokenLimit) || 0;
    const windowUsdLimit = Number(finopsAdmission?.windowUsdLimit) || 0;
    if (windowTokenLimit > 0 || windowUsdLimit > 0) {
      const quotaWindowMs = Number(finopsAdmission?.windowMs) || 86_400_000;
      const usage = await deps.costRepo.sumWindow(quotaWindowMs);
      if (
        (windowTokenLimit > 0 && usage.tokens >= windowTokenLimit) ||
        (windowUsdLimit > 0 && usage.costUsd >= windowUsdLimit)
      ) {
        try {
          deps.eventSink.emit({
            type: "warn",
            at: Date.now(),
            code: "QUOTA_EXCEEDED",
            sessionId: ctx.sessionId,
            detail: `windowMs=${quotaWindowMs} tokens=${usage.tokens}/${windowTokenLimit} costUsd=${usage.costUsd}/${windowUsdLimit}`,
          });
        } catch {
          // sink 故障不改变准入结果
        }
        ctx.rejection = {
          status: 429,
          body: {
            error: "配额已用尽（滚动窗口内累计达到上限），请稍后重试或调整成本配额设置",
            code: "QUOTA_EXCEEDED",
          },
        };
        return; // 短路：不调 next
      }
    }
    await next();
  };
}

/**
 * 装配准入管线（每路由调用一次 run）：
 * 拒绝结果经 ctx.rejection 返回，调用方映射为 HTTP 响应。
 */
export function createAdmissionPipeline(deps: AdmissionDeps, maxConcurrentTurns: number) {
  const run = composeMiddleware<AdmissionContext>([
    createConcurrencyAdmission(deps, maxConcurrentTurns),
    createQuotaAdmission(deps),
  ]);
  return async (ctx: AdmissionContext): Promise<AdmissionRejection | undefined> => {
    await run(ctx, async () => {
      // terminal：全部门禁通过，无操作（真实放行处理由路由继续）
    });
    return ctx.rejection;
  };
}
