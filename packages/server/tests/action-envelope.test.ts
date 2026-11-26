/**
 * TASK-089（实施方案 TASK-B）：server 路由边界「解析 → 校验 → 摘要化」契约测试。
 * 覆盖：信封解析（兼容旧形态）/ L2 校验 422+fieldErrors（不唤醒协程）/
 * 同键异体 422（幂等契约化）/ 解析失败 400 / patch 未启用 422 / 幂等哈希工具函数。
 */
import { describe, it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import {
  parseActionEnvelope,
  UIActionParseError,
  validateEnvelopeValues,
  hashEnvelope,
  decisionPayloadHash,
  truncateFieldText,
  DIGEST_MAX_FIELD_CHARS,
} from "../src/core/action-envelope.js";
import type { UIComponentInteraction } from "@vuagent/protocol";
import { createHarnessServer } from "../src/server.js";
import { createRedisActionPersist } from "../src/core/redis-externalize.js";
import { digestApprovalDecision } from "../src/core/result-digest.js";
import { FakeRedis } from "./helpers/fake-redis.js";

const H = { "Content-Type": "application/json", Origin: "http://localhost:5173" };

// ==========================================
// 1. 单元：信封解析与 values 边界校验
// ==========================================

describe("parseActionEnvelope（protocol 解析器的 server 入口）", () => {
  it("合法信封直通", () => {
    const env = parseActionEnvelope({ kind: "cancel", reason: "x" });
    expect(env).toEqual({ kind: "cancel", reason: "x" });
  });

  it("旧审批形态映射为 L1 submit 兼容信封", () => {
    const env = parseActionEnvelope({ approved: false, reason: "manual", note: "no" });
    expect(env).toEqual({
      kind: "submit",
      values: { approved: false, reason: "manual", note: "no" },
    });
  });

  it("无法识别的回传体抛 UIActionParseError", () => {
    expect(() => parseActionEnvelope({ foo: "bar" })).toThrow(UIActionParseError);
    expect(() => parseActionEnvelope("not-an-object")).toThrow(UIActionParseError);
    expect(() => parseActionEnvelope([1, 2])).toThrow(UIActionParseError);
  });
});

describe("validateEnvelopeValues（L2/L3 resultSchema 边界校验）", () => {
  const interaction: UIComponentInteraction = {
    level: "L2",
    resultSchema: Type.Object({
      env: Type.String({ description: "部署环境" }),
      replicas: Type.Number({ description: "副本数" }),
    }),
  };

  it("合法 values 通过", () => {
    const result = validateEnvelopeValues(
      { kind: "submit", values: { env: "prod", replicas: 3 } },
      interaction
    );
    expect(result.ok).toBe(true);
  });

  it("非法 values 返回结构化 fieldErrors（含路径与消息）", () => {
    const result = validateEnvelopeValues(
      { kind: "submit", values: { env: "prod", replicas: "three" } },
      interaction
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.length).toBeGreaterThan(0);
      expect(result.fieldErrors[0].path).toBe("/replicas");
      expect(typeof result.fieldErrors[0].message).toBe("string");
    }
  });

  it("缺必填字段同样产出 fieldErrors", () => {
    const result = validateEnvelopeValues({ kind: "submit", values: { env: "prod" } }, interaction);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.some((e) => e.path === "/replicas")).toBe(true);
    }
  });

  it("cancel 信封不读取 values（语义保证，直接放行）", () => {
    const result = validateEnvelopeValues({ kind: "cancel", reason: "算了" }, interaction);
    expect(result.ok).toBe(true);
  });

  it("未声明 resultSchema 的组件放行（向后兼容）", () => {
    const result = validateEnvelopeValues(
      { kind: "submit", values: { anything: 1 } },
      { level: "L1" }
    );
    expect(result.ok).toBe(true);
  });
});

describe("幂等哈希（同键异体比较源）", () => {
  it("同体不同键序哈希一致；异体哈希不同", () => {
    const a = hashEnvelope({ kind: "submit", values: { x: 1, y: [2, 3] } });
    const b = hashEnvelope({ kind: "submit", values: { y: [2, 3], x: 1 } });
    const c = hashEnvelope({ kind: "submit", values: { x: 1, y: [2, 4] } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("decisionPayloadHash：携带 envelope 的新决策直接哈希", () => {
    const hash = decisionPayloadHash({
      approved: true,
      envelope: { kind: "submit", values: { approved: true } },
    });
    expect(hash).toBe(hashEnvelope({ kind: "submit", values: { approved: true } }));
  });

  it("decisionPayloadHash：旧形态落账决策按兼容映射哈希", () => {
    const hash = decisionPayloadHash({ approved: true, note: "ok" });
    expect(hash).toBe(
      hashEnvelope({ kind: "submit", values: { approved: true, note: "ok" } })
    );
  });

  it("decisionPayloadHash：无法解析返回 undefined（回落旧幂等行为）", () => {
    expect(decisionPayloadHash({ totally: "unknown" })).toBeUndefined();
  });

  it("truncateFieldText：超长折叠并标注截断长度", () => {
    const long = "x".repeat(DIGEST_MAX_FIELD_CHARS + 7);
    expect(truncateFieldText(long)).toBe(`${"x".repeat(DIGEST_MAX_FIELD_CHARS)}…[+7 字符]`);
    expect(truncateFieldText("short")).toBe("short");
  });
});

// ==========================================
// 2. 路由：handleResolveAction 信封契约
// ==========================================

describe("POST /api/action/:actionId 信封契约（TASK-089）", () => {
  it("兼容旧审批形态：200 唤醒 + envelope 挂载（approved/note 直通）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-legacy", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-legacy", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: true, note: "经理批准" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const resolved = await promise;
    expect(resolved.approved).toBe(true);
    expect(resolved.note).toBe("经理批准");
    expect(resolved.envelope).toEqual({
      kind: "submit",
      values: { approved: true, note: "经理批准" },
    });
  });

  it("新信封 submit：approved 归一自 values", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-env", {
      toolName: "ui_approval_card",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-env", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { approved: true }, meta: { editedFields: [] } }),
    });
    expect(res.status).toBe(200);

    const resolved = await promise;
    expect(resolved.approved).toBe(true);
    expect(resolved.envelope?.kind).toBe("submit");
    expect(resolved.envelope?.meta?.editedFields).toEqual([]);
  });

  it("cancel 信封：归一为不批准（取消语义入 envelope）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-cancel", {
      toolName: "ui_approval_card",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-cancel", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "cancel", reason: "先不执行" }),
    });
    expect(res.status).toBe(200);

    const resolved = await promise;
    expect(resolved.approved).toBe(false);
    expect(resolved.envelope?.kind).toBe("cancel");
  });

  it("解析失败 400：非信封非旧形态 / 非对象 body", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-400", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 200,
    });

    const res = await app.request("/api/action/act-400", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ foo: "bar" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("ACTION_PAYLOAD_INVALID");

    const res2 = await app.request("/api/action/act-400", {
      method: "POST",
      headers: H,
      body: JSON.stringify("just-a-string"),
    });
    expect(res2.status).toBe(400);
    await promise; // 等超时收尾，不悬挂
  });

  it("patch（L3 预留）：422 PATCH_UNSUPPORTED，不终结挂起", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-patch", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-patch", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "patch", values: { x: 1 } }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("PATCH_UNSUPPORTED");
    // 挂起未被终结
    expect(actionHub.getSuspended("act-patch")).toBeDefined();
    actionHub.abortAction("act-patch", "test cleanup");
    await promise;
  });

  it("L2 校验失败：422 + fieldErrors，不唤醒协程、不落账", async () => {
    const DeployFormResultSchema = Type.Object({
      env: Type.String({ description: "部署环境" }),
      replicas: Type.Number({ description: "副本数" }),
    });
    const { app, actionHub } = createHarnessServer({
      dbPath: ":memory:",
      customUIComponents: [
        {
          name: "deploy_form",
          title: "创建部署",
          description: "收集部署参数",
          schema: Type.Object({ title: Type.String() }),
          interaction: { level: "L2", resultSchema: DeployFormResultSchema },
        },
      ],
    });

    let resolved = false;
    const promise = actionHub
      .waitForAction("act-l2", { toolName: "deploy_form", args: {}, timeoutMs: 5000 })
      .then((r) => {
        resolved = true;
        return r;
      });

    const bad = await app.request("/api/action/act-l2", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { env: "prod", replicas: "three" } }),
    });
    expect(bad.status).toBe(422);
    const badJson = await bad.json();
    expect(badJson.code).toBe("ENVELOPE_VALUES_INVALID");
    expect(badJson.fieldErrors.some((e: { path: string }) => e.path === "/replicas")).toBe(true);
    // 协程未被唤醒（仍挂起）
    expect(resolved).toBe(false);
    expect(actionHub.getSuspended("act-l2")).toBeDefined();

    // 修正后重新提交 → 200 唤醒
    const good = await app.request("/api/action/act-l2", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { env: "prod", replicas: 3 } }),
    });
    expect(good.status).toBe(200);
    const result = await promise;
    expect(result.envelope?.kind).toBe("submit");
  });

  it("L2 声明组件收到 cancel：不校验 values，直接唤醒", async () => {
    const { app, actionHub } = createHarnessServer({
      dbPath: ":memory:",
      customUIComponents: [
        {
          name: "deploy_form",
          title: "创建部署",
          description: "收集部署参数",
          schema: Type.Object({ title: Type.String() }),
          interaction: {
            level: "L2",
            resultSchema: Type.Object({ env: Type.String() }),
          },
        },
      ],
    });
    const promise = actionHub.waitForAction("act-l2-cancel", {
      toolName: "deploy_form",
      args: {},
      timeoutMs: 5000,
    });
    const res = await app.request("/api/action/act-l2-cancel", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "cancel" }),
    });
    expect(res.status).toBe(200);
    const result = await promise;
    expect(result.approved).toBe(false);
  });
});

// ==========================================
// 3. 路由：幂等契约化（同键异体 422）
// ==========================================

describe("幂等契约化：同键重放 200 / 同键异体 422", () => {
  function redisServer(redis: FakeRedis) {
    return createHarnessServer({ dbPath: ":memory:", redisClient: redis as never });
  }

  async function seedOrphan(store: ReturnType<typeof createRedisActionPersist>, actionId: string) {
    await store.savePending({
      actionId,
      toolName: "bash_run",
      args: {},
      sessionId: undefined,
      createdAt: Date.now(),
      timeoutMs: 180_000,
    });
  }

  it("孤儿落账后同体重放 → 200 幂等返回已记录决策", async () => {
    const redis = new FakeRedis();
    const { app } = redisServer(redis);
    const store = createRedisActionPersist(redis);
    await seedOrphan(store, "act-idem");

    const body = { approved: true, note: "late approval" };
    const first = await app.request("/api/action/act-idem", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).delivered).toBe(false);

    const replay = await app.request("/api/action/act-idem", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    const replayJson = await replay.json();
    expect(replayJson.success).toBe(true);
    expect(replayJson.prior).toBeTruthy();
  });

  it("孤儿落账后异体重放 → 422 ACTION_PAYLOAD_MISMATCH", async () => {
    const redis = new FakeRedis();
    const { app } = redisServer(redis);
    const store = createRedisActionPersist(redis);
    await seedOrphan(store, "act-mismatch");

    const first = await app.request("/api/action/act-mismatch", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: true, note: "first" }),
    });
    expect(first.status).toBe(200);

    const conflict = await app.request("/api/action/act-mismatch", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: false, note: "changed mind" }),
    });
    expect(conflict.status).toBe(422);
    const json = await conflict.json();
    expect(json.code).toBe("ACTION_PAYLOAD_MISMATCH");
    expect(json.success).toBe(false);
  });

  it("同体不同键序仍视为同体（哈希键序无关）", async () => {
    const redis = new FakeRedis();
    const { app } = redisServer(redis);
    const store = createRedisActionPersist(redis);
    await seedOrphan(store, "act-keyorder");

    const first = await app.request("/api/action/act-keyorder", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: true, reason: "manual", note: "ok" }),
    });
    expect(first.status).toBe(200);

    // 键序不同、语义同体 → 幂等 200
    const replay = await app.request("/api/action/act-keyorder", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ note: "ok", reason: "manual", approved: true }),
    });
    expect(replay.status).toBe(200);
  });

  it("旧版落账数据（无 envelope 字段）按兼容映射参与哈希比较", async () => {
    const redis = new FakeRedis();
    const { app } = redisServer(redis);
    const store = createRedisActionPersist(redis);
    // 模拟旧版本直接落账的决策（无 envelope 字段）
    await store.saveDecision("act-old", { approved: true, note: "legacy" });

    const same = await app.request("/api/action/act-old", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: true, note: "legacy" }),
    });
    expect(same.status).toBe(200);

    const different = await app.request("/api/action/act-old", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: true, note: "tampered" }),
    });
    expect(different.status).toBe(422);
  });

  it("送达路径（协程正常唤醒）同样幂等：重复同体 200 delivered:false / 异体 422（TASK-091）", async () => {
    const redis = new FakeRedis();
    const { app, actionHub } = createHarnessServer({
      dbPath: ":memory:",
      redisClient: redis as never,
    });
    const promise = actionHub.waitForAction("act-delivered-idem", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });

    const body = { kind: "submit", values: { approved: true }, meta: { editedFields: [] } };
    const first = await app.request("/api/action/act-delivered-idem", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    expect((await first.json()).success).toBe(true);
    const resolved = await promise;
    expect(resolved.approved).toBe(true);

    // 重复同体 → 200 幂等（返回已落账决策，不重复处理）
    const replay = await app.request("/api/action/act-delivered-idem", {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
    });
    expect(replay.status).toBe(200);
    const replayJson = await replay.json();
    expect(replayJson.success).toBe(true);
    expect(replayJson.delivered).toBe(false);
    expect(replayJson.prior).toBeTruthy();

    // 异体重放 → 422 ACTION_PAYLOAD_MISMATCH
    const conflict = await app.request("/api/action/act-delivered-idem", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { approved: false, note: "改主意了" } }),
    });
    expect(conflict.status).toBe(422);
    expect((await conflict.json()).code).toBe("ACTION_PAYLOAD_MISMATCH");
  });
});

// ==========================================
// 4. 路由：键名归一（TASK-091 新旧客户端口径一致）
// ==========================================

describe("键名归一：approved 读 values.approved；文案 note 优先、reason 兜底（TASK-091）", () => {
  it("新信封 deny：values.note 回填 response.note（供摘要与卡片回写一致消费）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-key-env", {
      toolName: "ui_approval_card",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-key-env", {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        kind: "submit",
        values: { approved: false, note: "太贵了，砍掉" },
        meta: { editedFields: [] },
      }),
    });
    expect(res.status).toBe(200);

    const resolved = await promise;
    expect(resolved.approved).toBe(false);
    expect(resolved.note).toBe("太贵了，砍掉");
    // 信封无 reason，不从 note 反推
    expect(resolved.reason).toBeUndefined();
  });

  it("旧形态 deny 仅 reason：note 兜底为 reason（与旧客户端展示口径一致）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-key-legacy", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-key-legacy", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: false, reason: "manual" }),
    });
    expect(res.status).toBe(200);

    const resolved = await promise;
    expect(resolved.approved).toBe(false);
    expect(resolved.reason).toBe("manual");
    expect(resolved.note).toBe("manual");
  });

  it("旧形态双键并存：顶层 note 不被 values 推导覆盖（note 优先）", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-key-both", {
      toolName: "bash_run",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-key-both", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved: false, reason: "manual", note: "预算不足" }),
    });
    expect(res.status).toBe(200);

    const resolved = await promise;
    expect(resolved.note).toBe("预算不足");
    expect(resolved.reason).toBe("manual");
  });

  it("客户端倒计时 deny 的 note=timeout 仅作展示标记，不反推为服务端超时裁决", async () => {
    const { app, actionHub } = createHarnessServer({ dbPath: ":memory:" });
    const promise = actionHub.waitForAction("act-key-timeout-note", {
      toolName: "ui_approval_card",
      args: {},
      timeoutMs: 5000,
    });

    const res = await app.request("/api/action/act-key-timeout-note", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ kind: "submit", values: { approved: false, note: "timeout" } }),
    });
    expect(res.status).toBe(200);

    const resolved = await promise;
    expect(resolved.approved).toBe(false);
    expect(resolved.note).toBe("timeout");
    // reason 不从 note 反推——否则摘要会误分类为「等待用户响应超时」的服务端裁决形态
    expect(resolved.reason).toBeUndefined();
  });

  it("摘要生成器 deny 分支防御兜底：note 缺失时 reason 进文案", () => {
    const digest = digestApprovalDecision({ toolName: "bash_run", reason: "manual" });
    expect(digest).toContain("用户驳回了「bash_run」的执行请求（原因：manual）。");
    // cancel/aborted/timeout 分支不受兜底影响
    expect(
      digestApprovalDecision({ toolName: "bash_run", reason: "aborted" })
    ).toContain("审批已被中止");
    expect(
      digestApprovalDecision({ toolName: "bash_run", reason: "timeout", timeoutMs: 1000 })
    ).toContain("等待用户响应超时");
  });
});
