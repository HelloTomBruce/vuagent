/**
 * SSE 响应装配（TASK-090）：/api/chat 与 /api/sessions/:id/stream 共用。
 *
 * 职责：
 * 1. 心跳保活：空闲期写 `: keepalive` 注释帧（SSE 注释，客户端解析器忽略），
 *    防反向代理/负载均衡按空闲超时掐流；heartbeatMs=0 关闭（测试用）；
 * 2. 订阅先行缓冲：attach 在流构建前执行（replayMode 可提前进响应头），
 *    订阅至 controller 就绪之间的事件进 pending 队列，start 时统一排空
 *    （单线程下 start 与事件回调不交错，保序）；
 * 3. 断连清理：请求 abort / 流 cancel 均退订并停心跳；
 * 4. attach 返回 null（会话被顶替等）：发送 TURN_PREEMPTED 错误事件收尾。
 */
import type { HarnessStreamEvent } from "./types.js";
import { StreamOrchestrator } from "./stream-orchestrator.js";

export interface SSEAttachResult {
  unsubscribe: () => void;
  /** 重连模式标注（TASK-090）：full / partial / live；由路由写入 x-vuagent-replay 头 */
  replayMode?: "full" | "partial" | "live";
}

export interface SSEResponseOptions {
  attach: (onEvent: (event: HarnessStreamEvent | "[DONE]") => void) => SSEAttachResult | null;
  /** 请求 abort 信号：断连退订（不中断后台执行——hub 语义） */
  signal?: AbortSignal;
  /** 心跳间隔 ms；0 = 关闭。缺省 15000 */
  heartbeatMs?: number;
  /** 附加响应头（x-vuagent-replay 等） */
  extraHeaders?: Record<string, string>;
  /** attach 为 null 时的错误事件（缺省 TURN_PREEMPTED 文案，chat 路由兼容） */
  attachFailedEvent?: HarnessStreamEvent;
  /** TASK-097：SSE 指标回调（连接开/关 + 事件类型计数），缺省无（零开销） */
  metrics?: {
    onOpen?: () => void;
    onClose?: () => void;
    onEvent?: (eventType: string) => void;
  };
}

/** 心跳注释帧（SSE 注释行，事件解析器按规范忽略） */
const HEARTBEAT_FRAME = ": keepalive\n\n";

export function createSSEResponse(options: SSEResponseOptions): Response {
  const {
    attach,
    signal,
    heartbeatMs = 15_000,
    extraHeaders = {},
    attachFailedEvent,
    metrics,
  } = options;

  const pending: (HarnessStreamEvent | "[DONE]")[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const encoder = new TextEncoder();

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  /** 关流收尾（幂等）：停心跳 + onClose 指标回调 */
  let closeNotified = false;
  const closeStream = (ctrl: ReadableStreamDefaultController<Uint8Array> | null) => {
    closed = true;
    stopHeartbeat();
    if (!closeNotified) {
      closeNotified = true;
      metrics?.onClose?.();
    }
    try {
      ctrl?.close();
    } catch {
      // 已关闭
    }
  };

  /** 统一事件落点：controller 未就绪时进缓冲，就绪后直写；DONE 收尾关流。
   *  onEvent 在真实写出时计数（缓冲路径由 start 排空时触发，不双计）。 */
  const pump = (event: HarnessStreamEvent | "[DONE]") => {
    if (closed) return;
    try {
      if (event === "[DONE]") {
        if (controller) {
          controller.enqueue(encoder.encode(StreamOrchestrator.formatDone()));
          metrics?.onEvent?.("done");
          closeStream(controller);
        } else {
          pending.push(event);
        }
      } else if (controller) {
        controller.enqueue(encoder.encode(StreamOrchestrator.formatSSE(event)));
        metrics?.onEvent?.(String(event.type));
      } else {
        pending.push(event);
      }
    } catch {
      // controller 已关闭/流已取消：停心跳防泄漏
      closeStream(controller);
    }
  };

  const sub = attach(pump);

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      metrics?.onOpen?.();
      if (heartbeatMs > 0) {
        heartbeat = setInterval(() => {
          try {
            controller?.enqueue(encoder.encode(HEARTBEAT_FRAME));
          } catch {
            stopHeartbeat();
          }
        }, heartbeatMs);
      }
      // 排空订阅先行期间缓冲的事件（保序；DONE 在队尾则在此关流）
      const backlog = pending.splice(0);
      for (const event of backlog) pump(event);
      if (closed) return;
      if (!sub) {
        pump(
          attachFailedEvent ?? {
            type: "error",
            message: "会话执行已被新请求顶替，本次连接不承载事件流",
            code: "TURN_PREEMPTED",
          }
        );
        if (!closed && controller) {
          controller.enqueue(encoder.encode(StreamOrchestrator.formatDone()));
          metrics?.onEvent?.("done");
          closeStream(controller);
        }
      }
    },
    cancel() {
      closeStream(controller);
      sub?.unsubscribe();
    },
  });

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        stopHeartbeat();
        sub?.unsubscribe();
      },
      { once: true }
    );
  }

  // 头组装在 attach 之后：replayMode 由订阅结果动态决定（TASK-090 增量重连标注）
  const replayHeaders: Record<string, string> = sub?.replayMode
    ? { "x-vuagent-replay": sub.replayMode }
    : {};
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...replayHeaders,
      ...(extraHeaders ?? {}),
    },
  });
}
