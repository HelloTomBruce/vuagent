/**
 * TASK-092（实施方案 TASK-E）：ui_form（L2 首个落地组件）server 侧契约测试。
 *
 * 覆盖：
 * A. 工具装配：ui_form 注册为内建工具，interaction = L2 + timeoutMeaning cancel
 *    + deriveResultSchema（fields → resultSchema 派生，不允许模型声明）。
 * B. 执行器「无审批挂起」路径：L2 挂起≠审批——review 模式下不产生审批卡、
 *    直接 suspended 挂起；submit → 双层摘要（enum label 回映/unit/secret 打码/
 *    editedFields 尾句）；cancel → 取消摘要（isError=false）；timeout →
 *    timeoutMeaning=cancel 语义摘要。secret 占位 { ref, masked } 贯穿结果事件/
 *    台账/消息，明文不出现。
 * C. 路由边界：挂起 args 派生校验（422 重填闭环）+ secret 剥离（内存挂起与
 *    Redis 孤儿两路径）+ 落账/决策查询不见明文 + secretStore.resolve 可还原。
 * D. result-digest 占位感知：摘要复用占位 masked；附录保留 { ref, masked }。
 */
import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { executeToolCallStep } from "../src/core/tool-step-executor.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import { WorkspaceRepository } from "../src/storage/repositories/workspace.repository.js";
import { SessionRepository } from "../src/storage/repositories/session.repository.js";
import { ToolConfigRepository } from "../src/storage/repositories/tool-config.repository.js";
import { ToolRegistry } from "../src/core/tool-registry.js";
import { ActionHub, type ActionResponse } from "../src/core/action-hub.js";
import { TelemetryLedger } from "../src/core/telemetry.js";
import { OpsReporter } from "../src/core/ops-reporter.js";
import { createNoopSink } from "../src/core/event-sink.js";
import type { HarnessStreamEvent } from "../src/core/types.js";
import type { ChatMessage } from "../src/core/context-compactor.js";
import { UIFormTool } from "../src/tools/ui/protocol-tools.js";
import { createHarnessServer } from "../src/server.js";
import { createRedisActionPersist } from "../src/core/redis-externalize.js";
import { digestSubmit, buildResultAppendix, isSecretPlaceholder } from "../src/core/result-digest.js";
import { InMemorySecretStore } from "../src/core/secret-store.js";
import { liftFormResultSchema, deriveFormResultSchema, coerceFormFields } from "@vuagent/protocol";
import { FakeRedis } from "./helpers/fake-redis.js";

const H = { "Content-Type": "application/json", Origin: "http://localhost:5173" };

/** 「创建部署」demo 同款表单参数（环境 select + 副本数 number 带 unit + 密钥 secret） */
const FORM_ARGS = {
  title: "创建部署",
  description: "需要部署参数与访问凭证",
  fields: [
    {
      key: "env",
      label: "部署环境",
      type: "select",
      required: true,
      options: [
        { value: "staging", label: "预发环境" },
        { value: "prod", label: "生产环境" },
      ],
    },
    { key: "replicas", label: "副本数", type: "number", required: true, unit: "个", default: 1 },
    { key: "apiKey", label: "访问密钥", type: "text", required: true, secret: true },
  ],
};

const SECRET_PLAIN = "sk-live-999888777";

// ==========================================
// A. 工具装配
// ==========================================

describe("ui_form 工具装配（TASK-092）", () => {
  it("声明 L2 + timeoutMeaning cancel + deriveResultSchema（无静态 resultSchema）", () => {
    expect(UIFormTool.requiresApproval).toBe(false);
    expect(UIFormTool.riskLevel).toBe("low");
    expect(UIFormTool.interaction?.level).toBe("L2");
    expect(UIFormTool.interaction?.timeoutMeaning).toBe("cancel");
    expect(UIFormTool.interaction?.resultSchema).toBeUndefined();
    expect(typeof UIFormTool.interaction?.deriveResultSchema).toBe("function");
  });

  it("deriveResultSchema：按入参 fields 派生可校验的 TypeBox Schema", () => {
    const schema = UIFormTool.interaction!.deriveResultSchema!(FORM_ARGS);
    expect(
      Value.Check(schema, { env: "prod", replicas: 3, apiKey: SECRET_PLAIN })
    ).toBe(true);
    expect(Value.Check(schema, { env: "mars", replicas: 3, apiKey: "x" })).toBe(false);
    expect(Value.Check(schema, { env: "prod", apiKey: "x" })).toBe(false);
  });

  it("默认 server 注册 ui_form 内建工具", () => {
    const { toolRegistry } = createHarnessServer({ dbPath: ":memory:" });
    const tool = toolRegistry.get("ui_form");
    expect(tool).toBeDefined();
    expect(tool?.interaction?.level).toBe("L2");
  });
});

// ==========================================
// B. 执行器「无审批挂起」路径
// ==========================================

interface FormStepResult {
  events: HarnessStreamEvent[];
  messages: ChatMessage[];
  cards: Array<{ id: string; type: string; data: any }>;
}

async function runFormStep(opts: {
  mode: "auto" | "review";
  approvalTimeoutMs?: number;
  respond?: (resolve: (r: ActionResponse) => void) => void;
}): Promise<FormStepResult> {
  const driver = new MemoryStorageDriver();
  const workspaceRepo = new WorkspaceRepository(driver);
  const sessionRepo = new SessionRepository(driver);
  const ws = await workspaceRepo.create({
    name: "w",
    rootPath: process.cwd(),
    permission: "read-write",
  });
  const session = await sessionRepo.create({ workspaceId: ws.id, permission: opts.mode });
  const toolConfigRepo = new ToolConfigRepository(driver);
  const registry = new ToolRegistry();
  registry.register(UIFormTool);
  const actionHub = new ActionHub();
  const ops = new OpsReporter(createNoopSink(), { sessionId: session.id, turnId: "t1" });
  const messages: ChatMessage[] = [];
  const events: HarnessStreamEvent[] = [];
  const cards: Array<{ id: string; type: string; data: any }> = [];

  const run = (async () => {
    for await (const evt of executeToolCallStep(
      {
        toolConfigRepo,
        sessionRepo,
        toolRegistry: registry,
        actionHub,
        ops,
      },
      {
        calls: [{ id: "call-form-1", name: "ui_form", argumentsStr: JSON.stringify(FORM_ARGS) }],
        runSignal: new AbortController().signal,
        workspace: ws,
        sessionId: session.id,
        effectiveMode: opts.mode,
        sessionPermissionAtStart: session.permission,
        approvalTimeoutMs: opts.approvalTimeoutMs ?? 30_000,
        bashTimeoutCeilingMs: 10_000,
        getContentLength: () => 0,
        accumulatedCards: cards,
        messages,
        telemetry: new TelemetryLedger("t1"),
      }
    )) {
      events.push(evt);
    }
  })();

  if (opts.respond) {
    // 等挂起出现后由测试注入用户回传（模拟路由边界产出）
    for (let i = 0; i < 200 && !actionHub.getSuspended("call-form-1"); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(actionHub.getSuspended("call-form-1")).toBeDefined();
    opts.respond((r) => actionHub.resolveAction("call-form-1", r));
  }
  await run;
  return { events, messages, cards };
}

/** 路由边界剥离后的 submit 响应形态（secret 已替换为占位） */
function strippedSubmitResponse(): ActionResponse {
  return {
    approved: true,
    envelope: {
      kind: "submit",
      values: {
        env: "prod",
        replicas: 3,
        apiKey: { ref: "secret://call-form-1/apiKey", masked: "sk-…****" },
      },
      meta: { editedFields: ["replicas", "apiKey"] },
    },
  };
}

describe("执行器 L2 无审批挂起路径（L2 挂起≠审批，TASK-092）", () => {
  it.each(["auto", "review"] as const)(
    "%s 模式下直接挂起等待填写（无审批卡、无审批守卫拦截）",
    async (mode) => {
      const { events, messages, cards } = await runFormStep({
        mode,
        respond: (resolve) => resolve(strippedSubmitResponse()),
      });
      // 挂起 → 唤醒事件序
      const suspended = events.find((e) => e.type === "suspended");
      const resumed = events.find((e) => e.type === "resumed");
      expect(suspended).toBeDefined();
      expect(resumed).toBeDefined();
      expect((suspended as any).toolName).toBe("ui_form");
      // 无审批卡（「L2 挂起≠审批」：review 模式同样不产生审批卡）
      expect(cards.some((c) => c.type === "approval")).toBe(false);
      // 结果消息是双层摘要而非裸 JSON
      const toolMsg = messages.find((m) => m.role === "tool" && m.name === "ui_form");
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toContain("用户在「创建部署」中提交了以下信息：");
      expect(toolMsg!.content).toContain("```json");
    }
  );

  it("submit 摘要：enum label 回映 / unit 后缀 / secret 打码 / editedFields 尾句；明文零泄漏", async () => {
    const { events, messages, cards } = await runFormStep({
      mode: "review",
      respond: (resolve) => {
        // 模拟路由边界：明文入 store，envelope 携带占位
        resolve(strippedSubmitResponse());
      },
    });
    const toolMsg = messages.find((m) => m.role === "tool" && m.name === "ui_form")!;
    // enum label 回映（prod → 生产环境，而非机器值）
    expect(toolMsg.content).toContain("- 部署环境: 生产环境");
    // unit 后缀
    expect(toolMsg.content).toContain("- 副本数: 3 个");
    // secret 打码（占位 masked 复用）
    expect(toolMsg.content).toContain("- 访问密钥: 已提供（sk-…****）");
    // editedFields 尾句（区分用户确认与默认值透传，回映字段 label）
    expect(toolMsg.content).toContain("「副本数」、「访问密钥」为用户亲自修改");
    // 附录携带 ref 占位（模型后续以 ref 引用）
    expect(toolMsg.content).toContain("secret://call-form-1/apiKey");
    // 全链路零明文：消息 / 结果事件 / 卡片 / traj 台账
    const wholeWire = JSON.stringify({ events, messages, cards });
    expect(wholeWire).not.toContain(SECRET_PLAIN);
    // 持久化 ui 卡（done 态表单回显）：values 为占位
    const uiCard = cards.find((c) => c.type === "ui" && c.data?.component === "ui_form");
    expect(uiCard).toBeDefined();
    expect(uiCard!.data.props.status).toBe("submitted");
    expect(isSecretPlaceholder(uiCard!.data.props.values.apiKey)).toBe(true);
  });

  it("cancel 信封：取消摘要（isError=false，不重试引导语）", async () => {
    const { events, messages } = await runFormStep({
      mode: "auto",
      respond: (resolve) =>
        resolve({ approved: false, envelope: { kind: "cancel", reason: "先不部署" } }),
    });
    const toolMsg = messages.find((m) => m.role === "tool" && m.name === "ui_form")!;
    expect(toolMsg.content).toContain("用户在「创建部署」中取消了本次交互（原因：先不部署）");
    expect(toolMsg.content).toContain("这是用户的主动决定（非系统错误）");
    const result = events.find((e) => e.type === "tool_call_result") as any;
    expect(result.status).toBe("done");
    expect(result.error).toBeUndefined();
  });

  it("timeout（服务端裁决）：timeoutMeaning=cancel 语义摘要（按用户放弃处理）", async () => {
    const { messages } = await runFormStep({ mode: "auto", approvalTimeoutMs: 30 });
    const toolMsg = messages.find((m) => m.role === "tool" && m.name === "ui_form")!;
    expect(toolMsg.content).toContain("等待用户响应超时");
    expect(toolMsg.content).toContain("按「用户放弃」处理");
    expect(toolMsg.content).not.toContain("按「拒绝」处理");
  });
});

// ==========================================
// C. 路由边界：派生校验 + secret 剥离
// ==========================================

describe("路由边界：ui_form 派生校验与 secret 剥离（TASK-092）", () => {
  it("挂起 args 派生 resultSchema：必填缺失 422 + fieldErrors，修正后 200（重填闭环）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-form", {
      toolName: "ui_form",
      args: FORM_ARGS,
      timeoutMs: 5000,
    });

    // 缺必填 replicas → 422（不唤醒）
    const bad = await app.request("/api/action/act-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "prod", apiKey: SECRET_PLAIN },
      }),
    });
    expect(bad.status).toBe(422);
    const badJson = await bad.json();
    expect(badJson.code).toBe("ENVELOPE_VALUES_INVALID");
    expect(badJson.fieldErrors.some((e: { path: string }) => e.path === "/replicas")).toBe(true);
    expect(actionHub.getSuspended("act-form")).toBeDefined();

    // 枚举外取值 → 同样 422
    const badEnum = await app.request("/api/action/act-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "mars", replicas: 3, apiKey: SECRET_PLAIN },
      }),
    });
    expect(badEnum.status).toBe(422);

    // 修正后重新提交 → 200 唤醒（校验失败不是终态，是重填的新输入）
    const good = await app.request("/api/action/act-form", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "prod", replicas: 3, apiKey: SECRET_PLAIN },
        meta: { editedFields: ["replicas", "apiKey"], clientValidated: true },
      }),
    });
    expect(good.status).toBe(200);
    await promise;
  });

  it("secret 剥离：唤醒响应只见 { ref, masked } 占位，store 可按 ref 还原明文", async () => {
    const { app, actionHub, secretStore } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-secret", {
      toolName: "ui_form",
      args: FORM_ARGS,
      timeoutMs: 5000,
      sessionId: "sess-1",
    });

    const res = await app.request("/api/action/act-secret", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "prod", replicas: 3, apiKey: SECRET_PLAIN },
      }),
    });
    expect(res.status).toBe(200);

    const resolved = await promise;
    const values = (resolved.envelope as any).values;
    // 占位形态：ref 确定性（actionId+field），masked 打码
    expect(isSecretPlaceholder(values.apiKey)).toBe(true);
    expect(values.apiKey.ref).toBe("secret://act-secret/apiKey");
    expect(values.apiKey.masked).toBe("sk-…****");
    // 非 secret 字段原样保留
    expect(values.env).toBe("prod");
    expect(values.replicas).toBe(3);
    // 响应整体不见明文
    expect(JSON.stringify(resolved)).not.toContain(SECRET_PLAIN);
    // store 是真实值的唯一归属：ref 可还原
    expect(await secretStore.resolve("secret://act-secret/apiKey")).toBe(SECRET_PLAIN);
  });

  it("Redis 孤儿路径：外置挂起 args 同样派生校验 + 剥离，决策落账不见明文", async () => {
    const redis = new FakeRedis();
    const { app, secretStore } = createHarnessServer({
      dbPath: ":memory:",
      redisClient: redis as never,
    });
    const store = createRedisActionPersist(redis);
    // 模拟进程重启后的孤儿挂起（内存无协程，外置记录携带 args）
    await store.savePending({
      actionId: "act-orphan",
      toolName: "ui_form",
      args: FORM_ARGS,
      sessionId: "sess-orphan",
      createdAt: Date.now(),
      timeoutMs: 180_000,
    });

    // 孤儿路径缺必填 → 422（外置 args 派生校验同样生效）
    const bad = await app.request("/api/action/act-orphan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { env: "prod", apiKey: SECRET_PLAIN } }),
    });
    expect(bad.status).toBe(422);

    const res = await app.request("/api/action/act-orphan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "prod", replicas: 3, apiKey: SECRET_PLAIN },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).delivered).toBe(false); // 诚实语义：协程不复活，决策落账

    // 落账决策：占位而非明文（台账/决策查询不泄漏）
    const prior = await store.getDecision("act-orphan");
    expect(prior).toBeTruthy();
    expect(JSON.stringify(prior)).not.toContain(SECRET_PLAIN);
    expect(isSecretPlaceholder((prior!.envelope as any).values.apiKey)).toBe(true);
    expect(await secretStore.resolve("secret://act-orphan/apiKey")).toBe(SECRET_PLAIN);

    // 同键同体重放 → 200 幂等（剥离确定性 ref 保证哈希稳定）
    const replay = await app.request("/api/action/act-orphan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "prod", replicas: 3, apiKey: SECRET_PLAIN },
      }),
    });
    expect(replay.status).toBe(200);

    // 同键异体重放 → 422
    const conflict = await app.request("/api/action/act-orphan", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "staging", replicas: 1, apiKey: SECRET_PLAIN },
      }),
    });
    expect(conflict.status).toBe(422);
    expect((await conflict.json()).code).toBe("ACTION_PAYLOAD_MISMATCH");
  });

  it("宿主注入点：自定义 SecretStore 替换缺省内存形态", async () => {
    const captured: Array<{ value: string; actionId: string; field: string }> = [];
    const custom = new InMemorySecretStore();
    const spy = {
      put(value: string, meta: { actionId: string; field: string; sessionId?: string }) {
        captured.push({ value, actionId: meta.actionId, field: meta.field });
        return custom.put(value, meta);
      },
      resolve: (ref: string) => custom.resolve(ref),
    };
    const { app, actionHub } = createHarnessServer({
      dbPath: ":memory:",
      secretStore: spy,
    });
    const promise = actionHub.waitForAction("act-spy", {
      toolName: "ui_form",
      args: FORM_ARGS,
      timeoutMs: 5000,
    });
    await app.request("/api/action/act-spy", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { env: "prod", replicas: 3, apiKey: SECRET_PLAIN },
      }),
    });
    await promise;
    expect(captured).toEqual([{ value: SECRET_PLAIN, actionId: "act-spy", field: "apiKey" }]);
  });
});

// ==========================================
// D. result-digest 占位感知（单元）
// ==========================================

describe("result-digest 占位感知（TASK-092）", () => {
  const schema = liftFormResultSchema(deriveFormResultSchema(coerceFormFields(FORM_ARGS.fields)));

  it("摘要复用占位 masked（不重复打码、不触达明文）", () => {
    const digest = digestSubmit({
      title: "创建部署",
      values: {
        env: "prod",
        replicas: 3,
        apiKey: { ref: "secret://a/apiKey", masked: "sk-…****" },
      },
      resultSchema: schema,
    });
    expect(digest).toContain("- 访问密钥: 已提供（sk-…****）");
    expect(digest).not.toContain(SECRET_PLAIN);
  });

  it("附录保留 { ref, masked } 占位（模型后续以 ref 引用）", () => {
    const appendix = buildResultAppendix(
      {
        env: "prod",
        replicas: 3,
        apiKey: { ref: "secret://a/apiKey", masked: "sk-…****" },
      },
      schema
    );
    expect(appendix).toContain("secret://a/apiKey");
    expect(appendix).toContain("sk-…****");
    expect(appendix).not.toContain(SECRET_PLAIN);
  });
});
