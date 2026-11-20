/**
 * 洋葱中间件管线（对齐 harness-core Pipeline 的组合语义，Koa 风格）：
 *
 *   composeMiddleware([a, b, c])(ctx, terminal)
 *     → a 进 → b 进 → c 进 → terminal → c 出 → b 出 → a 出
 *
 * 两个通用原语，供执行链不同切面复用：
 * - Middleware 洋葱：中间件可前置处理、短路（不调 next）、后置处理、抛错向外传播；
 * - Guard 守卫链：顺序裁决、首个失败短路——适合「启停→闸门→参数」类纯裁决序列
 *   （裁决逻辑无前后置需求，洋葱反而引入不必要的 next 仪式感）。
 *
 * 错误语义：任一中间件/守卫抛错直接向外抛出（fail-fast），由最外层调用方决定
 * 收尾口径——管线自身不做吞错（吞错策略属于调用方的域）。
 */

export type Next = () => Promise<void>;

export type Middleware<C> = (ctx: C, next: Next) => Promise<void>;

/**
 * 组合洋葱中间件链。返回的执行函数以 (ctx, terminal) 触发：
 * terminal 是链尾的真实业务处理器；任一中间件不调用 next 即短路。
 */
export function composeMiddleware<C>(
  middlewares: readonly Middleware<C>[]
): (ctx: C, terminal: Next) => Promise<void> {
  return async (ctx: C, terminal: Next) => {
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("next() 被多次调用（洋葱管线内禁止重复推进）");
      }
      index = i;
      if (i >= middlewares.length) {
        return terminal();
      }
      const middleware = middlewares[i];
      await middleware(ctx, () => dispatch(i + 1));
    };
    await dispatch(0);
  };
}

export interface GuardVerdict {
  /** true = 通过（继续后续守卫/业务）；false = 短路拒绝 */
  ok: boolean;
  /** 拒绝时的结构化说明（喂回模型/返回调用方） */
  errorMessage?: string;
  /** 拒绝时可附带的裁决载荷（如禁用标记、驳回原因对象） */
  executionResult?: unknown;
}

/** 守卫：读上下文 → 产出裁决；可顺带向共享状态写入派生值（如审批判定、超时策略） */
export type Guard<C, S> = (ctx: C, state: S) => GuardVerdict | Promise<GuardVerdict>;

/**
 * 顺序守卫链：逐个执行，首个 ok:false 短路返回该裁决；
 * 全部通过返回通过裁决。守卫对共享 state 的写入按序累积（调用方负责消费）。
 */
export async function runGuards<C, S>(
  guards: readonly Guard<C, S>[],
  ctx: C,
  state: S
): Promise<GuardVerdict> {
  for (const guard of guards) {
    const verdict = await guard(ctx, state);
    if (!verdict.ok) {
      return verdict;
    }
  }
  return { ok: true };
}
