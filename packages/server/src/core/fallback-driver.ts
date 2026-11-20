import type { IModelDriver, ModelDriverRequest, ModelStreamChunk } from "../adapters/model-driver.js";
import { ClassifiedModelError, type ProviderErrorClass } from "../adapters/resilience.js";

/**
 * 模型降级链（Fallback Chain）：
 * 主档案在「流开始前」失败（限流 / 服务端 / 网络类可重试错误）时，按序切换备用档案；
 * 诚实重试边界同样适用——流已开始吐字后的失败不做透明切换（调用方已消费增量，
 * 重跑会重复输出），错误原样上抛由上层处理。
 *
 * auth / bad_request / context_overflow 不参与降级：凭证错、请求非法、窗口溢出
 * 换档案也无意义（窗口溢出应由压缩层兜底，而非换小窗模型掩盖问题）。
 */

/** 允许触发降级的错误分类 */
const FALLBACK_ELIGIBLE_CLASSES: ReadonlyArray<ProviderErrorClass> = [
  "rate_limit",
  "server",
  "network",
];

export interface FallbackAttempt {
  /** 档案名（运维事件与轨迹展示用） */
  name: string;
  /** 该档案使用的模型名（缺省沿用请求原模型） */
  model?: string;
  driver: IModelDriver;
}

export interface FallbackNotice {
  from: string;
  to: string;
  errorClass: ProviderErrorClass;
  reason: string;
  /** 降级发生时刻（轨迹事件时间戳用） */
  at: number;
}

export class FallbackChainDriver implements IModelDriver {
  constructor(
    private attempts: FallbackAttempt[],
    private onFallback?: (notice: FallbackNotice) => void
  ) {}

  async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    if (this.attempts.length === 0) {
      throw new Error("FallbackChainDriver 需要至少一个可用档案");
    }

    let lastError: unknown;
    for (let i = 0; i < this.attempts.length; i++) {
      const attempt = this.attempts[i];
      /** 本次尝试是否已向调用方吐出 chunk（吐过即不再透明降级） */
      let consumed = false;
      try {
        const attemptReq = attempt.model ? { ...req, model: attempt.model } : req;
        for await (const chunk of attempt.driver.generateStream(attemptReq)) {
          consumed = true;
          yield chunk;
        }
        return; // 本档案正常完成
      } catch (err) {
        lastError = err;
        const isClassified = err instanceof ClassifiedModelError;
        const eligible =
          !consumed && isClassified && FALLBACK_ELIGIBLE_CLASSES.includes(err.errorClass);
        const hasNext = i + 1 < this.attempts.length;
        if (!eligible || !hasNext) {
          throw err;
        }
        this.onFallback?.({
          from: attempt.name,
          to: this.attempts[i + 1].name,
          errorClass: err.errorClass,
          reason: err.message,
          at: Date.now(),
        });
      }
    }
    throw lastError;
  }
}
