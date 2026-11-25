/**
 * 共享 SSE 消费件（TASK-114 双轨归一）：
 * useAgentChat（库）与 console useChatStream（宿主）此前各有一套内联
 * reader 循环 + 块解析——本模块收口为单一实现，双方消费同一份代码。
 *
 * 两部分：
 * - parseSSEChunk：纯函数块解析（跨 chunk 半包 / CRLF / 多行 data 合并，SSE 规范）；
 * - consumeSSEStream：fetch Response → 事件流消费循环（泛型事件类型、
 *   AbortError 分类、解析失败钩子）。
 *
 * 纯 TypeScript（无 Vue 依赖）：可单测、可被非组件数据域复用。
 *
 * @example 基本用法（类型化事件流）
 * ```ts
 * const { aborted } = await consumeSSEStream<UIStreamEvent>({
 *   open: () => fetch("/api/chat", { method: "POST", body }),
 *   onEvent: (event) => reduce(event),        // event: UIStreamEvent（无类型断言）
 *   onDone: () => finalize(),
 *   signal: controller.signal,
 * });
 * ```
 *
 * @example 自定义解析失败处理（默认 console.warn 跳过）
 * ```ts
 * consumeSSEStream({
 *   open,
 *   onEvent,
 *   onParseError: (payload, err) => telemetry.warn("sse-parse", { payload, err }),
 * });
 * ```
 */

export interface SSEParseResult {
  /** 本次完整取出的 data 载荷（JSON 字符串或 "[DONE]"） */
  payloads: string[];
  /** 未凑齐事件的残余 buffer，需带回下一次调用 */
  buffer: string;
}

/**
 * SSE 文本流块解析（纯函数）：
 * 输入增量 chunk + 上一次残余 buffer，输出本次完整取出的 data 载荷与新的残余 buffer。
 * 规范增强（相比朴素的 split("\n") 逐行实现）：
 * 1. 兼容 \r\n / \r 换行；
 * 2. 按 SSE 规范合并同一事件块内的多行 data 字段；
 * 3. 忽略注释行（`:` 前缀，如心跳 `: keepalive`）与非 data 字段行。
 */
export function parseSSEChunk(chunk: string, buffer: string): SSEParseResult {
  const normalized = (buffer + chunk).replace(/\r\n|\r/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";

  const payloads: string[] = [];
  for (const block of parts) {
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.replace(/^data:\s*/, ""));
      }
    }
    if (dataLines.length === 0) continue;
    payloads.push(dataLines.join("\n"));
  }

  return { payloads, buffer: rest };
}

export interface SSEConsumeOptions<T = unknown> {
  /**
   * 打开流：唯一的传输扩展点（调用方完全掌控 fetch/headers/URL/重连策略——
   * POST 发起、GET 重连、代理转发、自定义鉴权都在这里做）。
   * 非 2xx 应在本函数内抛错（错误原样透传给调用方）。
   */
  open: () => Promise<Response>;
  /**
   * 已解析的事件对象（[DONE] 不经过此回调，走 onDone）。
   * 泛型 T 指定事件类型，免去调用方断言。
   */
  onEvent: (event: T) => void;
  /** 服务端收尾标记（data: [DONE]）；流自然读完但未发 [DONE] 时不会触发 */
  onDone?: () => void;
  /** 本地中止信号（兜底断开手段；中止 → 结果 aborted:true 而非抛错） */
  signal?: AbortSignal;
  /**
   * 解析失败钩子（扩展点）：data 块 JSON 解析失败时调用（缺省 console.warn 后
   * 跳过该块——单块损坏不拖垮整条流）。宿主可接告警/采样/降级渲染。
   */
  onParseError?: (payload: string, err: unknown) => void;
}

export interface SSEConsumeResult {
  /** true = 因本地 abort 断开（非服务端正常收尾） */
  aborted: boolean;
}

/**
 * 消费 SSE 流至收尾/断开。
 * - 正常收尾（[DONE] 后流结束，或流自然读完）→ { aborted: false }；
 * - signal 中止 → { aborted: true }（调用方据此做中止徽标等本地语义）；
 * - 其他错误（网络/服务端非 2xx 的 open 抛错/流中断）→ 原样抛出，由调用方呈现。
 */
export async function consumeSSEStream<T = unknown>(
  options: SSEConsumeOptions<T>
): Promise<SSEConsumeResult> {
  const res = await options.open();
  const reader = res.body?.getReader();
  if (!reader) throw new Error("ReadableStream not supported or empty response");

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let aborted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const { payloads, buffer: rest } = parseSSEChunk(
        decoder.decode(value, { stream: true }),
        buffer
      );
      buffer = rest;

      for (const raw of payloads) {
        if (raw === "[DONE]") {
          options.onDone?.();
          continue;
        }
        try {
          options.onEvent(JSON.parse(raw) as T);
        } catch (err) {
          if (options.onParseError) {
            options.onParseError(raw, err);
          } else {
            console.warn("[vuagent-ui] 解析 SSE 块失败:", raw, err);
          }
        }
      }
    }
  } catch (err: unknown) {
    // AbortError = 本地兜底断开（服务端 aborted 事件通常已先行经流送达）
    if ((err as { name?: string })?.name === "AbortError" || options.signal?.aborted) {
      aborted = true;
    } else {
      throw err;
    }
  }

  return { aborted };
}
