/**
 * TASK-091：审批卡信封迁移 HTTP 级端到端回归脚本（零真实 LLM 费用）。
 *
 * 运行：cd packages/server && npx tsx scripts/e2e-approval-envelope.mts
 *
 * 拓扑：真实 TCP server（@hono/node-server + createHarnessServer + FakeRedis 决策外置）
 * + 脚本化模型驱动（确定性 tool_call → 文本收尾），驱动完整「挂起 → 审批 → 唤醒 → 摘要进上下文」链路。
 *
 * 覆盖验证清单 a–g：
 *   a. 旧形态 POST {approved:true, reason:"manual"} → 200，协程唤醒
 *   b. 新信封 POST {kind:"submit", values:{approved:true}, meta:{...}} → 200
 *   c. 同 body 重复提交 → 200 幂等（delivered:false，不重复处理）
 *   d. 同 actionId 异体 → 422 ACTION_PAYLOAD_MISMATCH
 *   e. 非法 body → 400 ACTION_PAYLOAD_INVALID；patch → 422 PATCH_UNSUPPORTED
 *   f. 驳回路径后续 tool 消息 content：信封摘要、无 "Error:" 前缀、无旧文案「操作被用户驳回」
 *      （旧形态 deny 与新信封 deny 两侧键名口径各验证一次）
 *   g. 超时路径：approvalTimeoutMs=10s 配置，无人工决策 → 自动 deny + 超时摘要语义
 */

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { createHarnessServer } from "../src/server.js";
import { FakeRedis } from "../tests/helpers/fake-redis.js";
import type {
  IModelDriver,
  ModelDriverRequest,
  ModelStreamChunk,
} from "../src/adapters/model-driver.js";

// ==========================================
// 脚本化模型驱动（逐 turn 消费脚本；记录每次请求的消息列表供 f 断言）
// ==========================================

type Step =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> };

class ScriptDriver implements IModelDriver {
  private queue: Step[][] = [];
  /** 每次 generateStream 的请求快照（messages 用于断言 tool 结果 content） */
  requests: ModelDriverRequest[] = [];

  push(...turns: Step[][]): void {
    this.queue.push(...turns);
  }

  async *generateStream(req: ModelDriverRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(req);
    const steps = this.queue.shift() ?? [{ type: "text", text: "（无脚本，直接收尾）" }];
    for (const step of steps) {
      if (step.type === "text") {
        yield { type: "text_delta", text: step.text };
      } else {
        yield {
          type: "tool_call_delta",
          toolCall: { index: 0, id: step.id, name: step.name, argumentsDelta: "" },
        };
        yield {
          type: "tool_call_delta",
          toolCall: { index: 0, argumentsDelta: JSON.stringify(step.arguments) },
        };
      }
    }
    yield { type: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
    yield { type: "done" };
  }

  /** 最后一次请求中指定 toolCallId 的 tool 消息 content */
  lastToolMessageContent(toolCallId: string): string | undefined {
    const req = this.requests[this.requests.length - 1];
    const msg = (req.messages as Array<Record<string, unknown>>).find(
      (m) => m.role === "tool" && m.tool_call_id === toolCallId
    );
    return msg ? String(msg.content ?? "") : undefined;
  }
}

// ==========================================
// SSE 客户端：增量解析 data: 帧，挂起时回调，[DONE] 收尾
// ==========================================

interface SseSession {
  events: Array<Record<string, unknown>>;
  suspended: Promise<Record<string, unknown>>;
  done: Promise<void>;
}

function postChatSSE(base: string, prompt: string): SseSession {
  const events: Array<Record<string, unknown>> = [];
  let suspendedResolve!: (e: Record<string, unknown>) => void;
  let doneResolve!: () => void;
  let doneReject!: (e: unknown) => void;
  const suspended = new Promise<Record<string, unknown>>((r) => (suspendedResolve = r));
  const done = new Promise<void>((resolve, reject) => {
    doneResolve = resolve;
    doneReject = reject;
  });

  (async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok || !res.body) throw new Error(`POST /api/chat -> ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const ev = JSON.parse(data) as Record<string, unknown>;
            events.push(ev);
            if (ev.type === "suspended") suspendedResolve(ev);
          } catch {
            /* 心跳注释帧等忽略 */
          }
        }
      }
    }
    doneResolve();
  })().catch(doneReject);

  return { events, suspended, done };
}

// ==========================================
// 断言工具
// ==========================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ ${label}${detail !== undefined ? ` —— ${JSON.stringify(detail)}` : ""}`);
  }
}

async function postAction(
  actionId: string,
  body: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/action/${actionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function lastResultEvent(
  sse: SseSession,
  toolCallId: string
): Record<string, unknown> | undefined {
  return sse.events.find((e) => e.type === "tool_call_result" && e.toolCallId === toolCallId);
}

/** 发起一轮「模型调用需审批工具」的会话并等待挂起事件 + 挂起列表交叉确认 */
async function startApprovalTurn(
  label: string,
  driver: ScriptDriver,
  toolCallId: string,
  command: string
): Promise<SseSession> {
  driver.push(
    [{ type: "tool_call", id: toolCallId, name: "bash_run", arguments: { command } }],
    [{ type: "text", text: `(${label}) 审批结果已收到，收尾。` }]
  );
  const sse = postChatSSE(BASE, `${label}: please run ${command}`);
  const ev = await sse.suspended;
  check(`${label}：收到 suspended 事件（actionId=${toolCallId}）`, ev.actionId === toolCallId, ev);

  // GET /api/action/suspended 交叉确认挂起可见
  const list = (await (await fetch(`${BASE}/api/action/suspended`)).json()) as Array<
    Record<string, unknown>
  >;
  check(
    `${label}：GET /api/action/suspended 列出该挂起`,
    list.some((a) => a.actionId === toolCallId),
    list
  );
  return sse;
}

// ==========================================
// 主流程
// ==========================================

const driver = new ScriptDriver();
const redis = new FakeRedis();
const { app } = createHarnessServer({
  dbPath: ":memory:",
  modelDriver: driver,
  redisClient: redis as never,
});

let server: ServerType | null = null;
let BASE = "";

async function main(): Promise<void> {
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      BASE = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
  console.log(`[E2E] server listening at ${BASE}\n`);

  // ---------- a. 旧形态批准 → 200 + 协程唤醒 ----------
  console.log("a. 旧形态 POST {approved:true, reason:\"manual\"}");
  {
    const sse = await startApprovalTurn("a", driver, "e2e-a1", "echo e2e-legacy-approve");
    const r = await postAction("e2e-a1", { approved: true, reason: "manual" });
    check("a：POST → 200", r.status === 200, r);
    check("a：success=true", r.json.success === true, r.json);
    await sse.done;
    const result = lastResultEvent(sse, "e2e-a1") as { status?: string; data?: { stdout?: string } };
    check("a：协程唤醒且工具真实执行（stdout 含标记）",
      result?.status === "done" && String(result?.data?.stdout ?? "").includes("e2e-legacy-approve"),
      result);
  }

  // ---------- b. 新信封批准 → 200 ----------
  console.log("b. 新信封 POST {kind:\"submit\", values:{approved:true}, meta:{...}}");
  {
    const sse = await startApprovalTurn("b", driver, "e2e-b1", "echo e2e-envelope-approve");
    const body = {
      kind: "submit",
      values: { approved: true },
      meta: { editedFields: [], durationMs: 12, clientValidated: true },
    };
    const r = await postAction("e2e-b1", body);
    check("b：POST → 200", r.status === 200, r);
    await sse.done;
    const result = lastResultEvent(sse, "e2e-b1") as { status?: string; data?: { stdout?: string } };
    check("b：协程唤醒且工具真实执行",
      result?.status === "done" && String(result?.data?.stdout ?? "").includes("e2e-envelope-approve"),
      result);

    // ---------- c. 同 body 重复提交 → 200 幂等 ----------
    console.log("c. 同 body 重复提交 → 200 幂等");
    const replay = await postAction("e2e-b1", body);
    check("c：重复同体 → 200", replay.status === 200, replay);
    check("c：delivered=false（未重复处理）+ 返回已落账决策",
      replay.json.delivered === false && Boolean(replay.json.prior), replay.json);

    // ---------- d. 同 actionId 异体 → 422 ----------
    console.log("d. 同 actionId 异体 → 422 ACTION_PAYLOAD_MISMATCH");
    const conflict = await postAction("e2e-b1", {
      kind: "submit",
      values: { approved: false, note: "改主意了" },
    });
    check("d：异体重放 → 422", conflict.status === 422, conflict);
    check("d：code=ACTION_PAYLOAD_MISMATCH", conflict.json.code === "ACTION_PAYLOAD_MISMATCH", conflict.json);
  }

  // ---------- e. 非法 body 400 / patch 422 ----------
  console.log("e. 非法 body → 400；patch → 422 PATCH_UNSUPPORTED");
  {
    const sse = await startApprovalTurn("e", driver, "e2e-e1", "echo e2e-validation");
    const bad = await postAction("e2e-e1", { foo: "bar" });
    check("e：非法 body → 400 ACTION_PAYLOAD_INVALID",
      bad.status === 400 && bad.json.code === "ACTION_PAYLOAD_INVALID", bad);
    const patch = await postAction("e2e-e1", { kind: "patch", values: { x: 1 } });
    check("e：patch → 422 PATCH_UNSUPPORTED",
      patch.status === 422 && patch.json.code === "PATCH_UNSUPPORTED", patch);
    // 挂起未被终结：仍可正常审批唤醒
    const ok = await postAction("e2e-e1", { approved: true, note: "校验失败后放行" });
    check("e：挂起未被 400/422 终结，后续批准仍 200", ok.status === 200, ok);
    await sse.done;
  }

  // ---------- f. 驳回路径模型可见文案（两侧键名口径） ----------
  console.log("f. 驳回路径 tool 消息 content：信封摘要、无 Error 前缀、无旧文案");
  {
    // f-1 旧形态 deny（reason+note 顶层）
    const sse1 = await startApprovalTurn("f-legacy-deny", driver, "e2e-f1", "echo e2e-legacy-deny");
    const r1 = await postAction("e2e-f1", { approved: false, reason: "manual", note: "旧客户端不允许" });
    check("f-1：旧形态 deny → 200", r1.status === 200, r1);
    await sse1.done;
    const result1 = lastResultEvent(sse1, "e2e-f1") as { status?: string; error?: string; data?: Record<string, unknown> };
    check("f-1：tool_call_result 非错误通道（status=done, error=undefined）",
      result1?.status === "done" && result1?.error === undefined, result1);
    check("f-1：data.approved=false", (result1?.data as { approved?: boolean })?.approved === false, result1?.data);
    const content1 = driver.lastToolMessageContent("e2e-f1") ?? "";
    check("f-1：tool 消息为驳回摘要（含 note 文案）",
      content1.includes("用户驳回了「bash_run」的执行请求（原因：旧客户端不允许）。"), content1);
    check("f-1：无 Error: 前缀、无旧文案「操作被用户驳回」",
      !content1.includes("Error:") && !content1.includes("操作被用户驳回"), content1);

    // f-2 新信封 deny（note 仅在 values 内——TASK-091 键名归一修复的端到端验证）
    const sse2 = await startApprovalTurn("f-envelope-deny", driver, "e2e-f2", "echo e2e-envelope-deny");
    const r2 = await postAction("e2e-f2", {
      kind: "submit",
      values: { approved: false, note: "新客户端拒绝" },
      meta: { editedFields: [] },
    });
    check("f-2：新信封 deny → 200", r2.status === 200, r2);
    await sse2.done;
    const result2 = lastResultEvent(sse2, "e2e-f2") as { status?: string; error?: string; data?: Record<string, unknown> };
    check("f-2：tool_call_result 非错误通道",
      result2?.status === "done" && result2?.error === undefined, result2);
    const content2 = driver.lastToolMessageContent("e2e-f2") ?? "";
    check("f-2：values.note 进入摘要文案（键名归一生效）",
      content2.includes("用户驳回了「bash_run」的执行请求（原因：新客户端拒绝）。"), content2);
    check("f-2：无 Error: 前缀、无旧文案",
      !content2.includes("Error:") && !content2.includes("操作被用户驳回"), content2);
  }

  // ---------- g. 超时路径：approvalTimeoutMs=10s 自动 deny + 摘要语义 ----------
  console.log("g. 超时路径：approvalTimeoutMs=10000 自动驳回 + 超时摘要");
  {
    const patch = await fetch(`${BASE}/api/config/execution`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalTimeoutMs: 10_000 }),
    });
    const patchJson = (await patch.json()) as { values?: { approvalTimeoutMs?: number } };
    check("g：approvalTimeoutMs 配置生效（10000）",
      patch.status === 200 && patchJson.values?.approvalTimeoutMs === 10_000, patchJson);

    const t0 = Date.now();
    const sse = await startApprovalTurn("g", driver, "e2e-g1", "echo e2e-timeout");
    await sse.done; // 不提交任何决策，等待服务端超时裁决
    const waitedMs = Date.now() - t0;
    check(`g：约 10s 后协程被超时唤醒（实际 ${waitedMs}ms）`,
      waitedMs >= 9_500 && waitedMs < 30_000, waitedMs);
    const result = lastResultEvent(sse, "e2e-g1") as { status?: string; error?: string; data?: Record<string, unknown> };
    check("g：tool_call_result 非错误通道 + approved=false",
      result?.status === "done" && result?.error === undefined &&
        (result?.data as { approved?: boolean })?.approved === false, result);
    const content = driver.lastToolMessageContent("e2e-g1") ?? "";
    check("g：摘要为超时语义（等待用户响应超时 + 按「拒绝」处理）",
      content.includes("等待用户响应超时") && content.includes("按「拒绝」处理"), content);
    check("g：无 Error: 前缀、无旧文案",
      !content.includes("Error:") && !content.includes("操作被用户驳回"), content);

    // 复位配置
    await fetch(`${BASE}/api/config/execution/reset`, { method: "POST" });
  }

  console.log(`\n[E2E] 结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) {
    console.error(`[E2E] 失败项：\n - ${failures.join("\n - ")}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[E2E] 脚本异常：", err);
    process.exitCode = 1;
  })
  .finally(() => {
    server?.close();
    // FakeRedis/定时器兜底退出
    setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
  });
