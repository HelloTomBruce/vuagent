import { describe, expect, it } from "vitest";
import { createHarnessServer } from "../src/server.js";
import {
  isPathUnderPrefix,
  isHttpUrl,
  parseWorkspaceRoots,
  validateCreateModelProfileBody,
  validateCreateSessionBody,
  validateCreateWorkspaceBody,
  validateUpdateSessionBody,
} from "../src/core/http-body-guards.js";
import { isProviderKind } from "../src/storage/interfaces.js";

const JSON_HEADERS = { "Content-Type": "application/json", Origin: "http://localhost:5173" };

/* ==========================================================================
   单元：rootPath 前缀白名单
   ========================================================================== */

describe("parseWorkspaceRoots / isPathUnderPrefix（TASK-086）", () => {
  it("逗号分隔解析并 resolve 归一；空值/空白项过滤", () => {
    expect(parseWorkspaceRoots("/tmp/a, /tmp/b ,,")).toEqual(["/tmp/a", "/tmp/b"]);
    expect(parseWorkspaceRoots(undefined)).toEqual([]);
    expect(parseWorkspaceRoots("")).toEqual([]);
  });

  it("isPathUnderPrefix：等于前缀或位于前缀子路径为真；同级目录/前缀字符串碰撞为假", () => {
    expect(isPathUnderPrefix("/tmp/a", "/tmp/a")).toBe(true);
    expect(isPathUnderPrefix("/tmp/a/sub/file", "/tmp/a")).toBe(true);
    expect(isPathUnderPrefix("/tmp/ab", "/tmp/a")).toBe(false); // 前缀字符串碰撞（无 path.sep）
    expect(isPathUnderPrefix("/tmp/b", "/tmp/a")).toBe(false);
  });
});

/* ==========================================================================
   单元：工作区创建校验（rootPath 策略）
   ========================================================================== */

describe("validateCreateWorkspaceBody（TASK-086）", () => {
  const baseEnv = { VUAGENT_WORKSPACE_ROOTS: "" };

  it("合法 body 通过，rootPath 归一为绝对路径", () => {
    const r = validateCreateWorkspaceBody(
      { name: "demo", rootPath: "/tmp/demo/", permission: "read-write" },
      baseEnv
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("demo");
      expect(r.value.rootPath).toBe("/tmp/demo");
      expect(r.value.permission).toBe("read-write");
    }
  });

  it("缺字段/类型错 → 字段级错误", () => {
    expect(validateCreateWorkspaceBody(null, baseEnv).ok).toBe(false);
    expect(validateCreateWorkspaceBody([], baseEnv).ok).toBe(false);
    const noName = validateCreateWorkspaceBody({ rootPath: "/tmp/x" }, baseEnv);
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.error).toContain("name");
    const badRoot = validateCreateWorkspaceBody({ name: "n", rootPath: 123 }, baseEnv);
    expect(badRoot.ok).toBe(false);
    if (!badRoot.ok) expect(badRoot.error).toContain("rootPath");
    const badPerm = validateCreateWorkspaceBody({ name: "n", rootPath: "/tmp/x", permission: "auto" }, baseEnv);
    expect(badPerm.ok).toBe(false);
    if (!badPerm.ok) expect(badPerm.error).toContain("permission");
  });

  it("相对路径 rootPath 拒绝（防悄悄挂到进程 cwd）", () => {
    const r = validateCreateWorkspaceBody({ name: "n", rootPath: "relative/path" }, baseEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("绝对路径");
  });

  it("VUAGENT_WORKSPACE_ROOTS 配置后：白名单内放行、越界拒绝且错误含允许前缀", () => {
    const env = { VUAGENT_WORKSPACE_ROOTS: "/Users/me/projects, /tmp/sandbox" };
    const inside = validateCreateWorkspaceBody({ name: "n", rootPath: "/tmp/sandbox/app" }, env);
    expect(inside.ok).toBe(true);
    const outside = validateCreateWorkspaceBody({ name: "n", rootPath: "/etc" }, env);
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.error).toContain("VUAGENT_WORKSPACE_ROOTS");
      expect(outside.error).toContain("/tmp/sandbox");
    }
    // 同级目录不在前缀内（/tmp/sandboxx ≠ /tmp/sandbox）
    expect(validateCreateWorkspaceBody({ name: "n", rootPath: "/tmp/sandboxx" }, env).ok).toBe(false);
  });

  it("未配置白名单时仅绝对路径校验（现有部署形态不受影响）", () => {
    expect(validateCreateWorkspaceBody({ name: "n", rootPath: "/anywhere/else" }, baseEnv).ok).toBe(true);
  });
});

/* ==========================================================================
   单元：会话创建/更新校验
   ========================================================================== */

describe("validateCreateSessionBody / validateUpdateSessionBody（TASK-086）", () => {
  it("创建：workspaceId 必填，playground 载荷形状通过", () => {
    const bad = validateCreateSessionBody({ title: "t" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("workspaceId");
    const ok = validateCreateSessionBody({
      workspaceId: "ws-1",
      title: "新会话",
      activeModelProfileId: "prof-1",
      permission: "auto",
    });
    expect(ok.ok).toBe(true);
    const badPerm = validateCreateSessionBody({ workspaceId: "ws-1", permission: "danger" });
    expect(badPerm.ok).toBe(false);
    if (!badPerm.ok) expect(badPerm.error).toContain("permission");
  });

  it("更新：白名单字段 presence 校验；属主字段被丢弃", () => {
    const ok = validateUpdateSessionBody({ pinned: true, title: "改名", status: "archived", archived: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value).toEqual({ pinned: true, title: "改名", status: "archived", archived: true });
    }
    // turns/workspaceId/id 不在白名单：丢弃后为空对象（合法 PATCH，不改任何字段）
    const dropped = validateUpdateSessionBody({
      turns: [{ prompt: "inject" }],
      workspaceId: "ws-other",
      id: "sess-1",
    });
    expect(dropped.ok).toBe(true);
    if (dropped.ok) expect(dropped.value).toEqual({});
    // 非法类型 → 400 而非静默归一
    expect(validateUpdateSessionBody({ pinned: "yes" }).ok).toBe(false);
    expect(validateUpdateSessionBody({ title: "" }).ok).toBe(false);
    expect(validateUpdateSessionBody({ status: "hacked" }).ok).toBe(false);
  });
});

/* ==========================================================================
   单元：模型档案创建校验
   ========================================================================== */

describe("validateCreateModelProfileBody（TASK-086）", () => {
  it("必填 name/model/provider + provider 枚举闸门", () => {
    expect(validateCreateModelProfileBody({}, isProviderKind).ok).toBe(false);
    const badKind = validateCreateModelProfileBody(
      { name: "n", model: "m", provider: "not-a-kind" },
      isProviderKind
    );
    expect(badKind.ok).toBe(false);
    if (!badKind.ok) expect(badKind.error).toContain("provider 类型");
    const ok = validateCreateModelProfileBody(
      { name: "n", model: "m", provider: "openai", apiKey: "sk-x" },
      isProviderKind
    );
    expect(ok.ok).toBe(true);
  });

  it("baseUrl http(s) 校验；contextWindow 正数；对象字段类型闸门", () => {
    const badUrl = validateCreateModelProfileBody(
      { name: "n", model: "m", provider: "openai", baseUrl: "file:///etc" },
      isProviderKind
    );
    expect(badUrl.ok).toBe(false);
    if (!badUrl.ok) expect(badUrl.error).toContain("http(s)");
    const badWindow = validateCreateModelProfileBody(
      { name: "n", model: "m", provider: "openai", contextWindow: -1 },
      isProviderKind
    );
    expect(badWindow.ok).toBe(false);
    const badCaps = validateCreateModelProfileBody(
      { name: "n", model: "m", provider: "openai", capabilities: "x" },
      isProviderKind
    );
    expect(badCaps.ok).toBe(false);
  });

  it("isHttpUrl：http/https 通过，file/ftp/非法串拒绝", () => {
    expect(isHttpUrl("https://api.example.com/v1")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("ftp://x")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

/* ==========================================================================
   路由级：四端点 400/201 端到端
   ========================================================================== */

describe("路由输入校验端到端（TASK-086）", () => {
  it("POST /api/workspaces：合法 201；缺 name 400；相对路径 400", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const created = await app.request("/api/workspaces", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "ws-a", rootPath: "/tmp/va-test-workspace", permission: "read-write" }),
    });
    expect(created.status).toBe(201);
    const ws = (await created.json()) as { id: string; rootPath: string };
    expect(ws.rootPath).toBe("/tmp/va-test-workspace");

    const noName = await app.request("/api/workspaces", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ rootPath: "/tmp/x" }),
    });
    expect(noName.status).toBe(400);

    const relPath = await app.request("/api/workspaces", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "n", rootPath: "relative" }),
    });
    expect(relPath.status).toBe(400);
    expect(((await relPath.json()) as { error: string }).error).toContain("绝对路径");
  });

  it("POST /api/sessions：合法 201（title 缺省走仓储默认）；缺 workspaceId 400", async () => {
    const { app, workspaceRepo } = createHarnessServer({ dbPath: ":memory:" });
    const ws = await workspaceRepo.create({ name: "w", rootPath: "/tmp/va-test-sessions", permission: "read-write" });
    const created = await app.request("/api/sessions", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ workspaceId: ws.id }),
    });
    expect(created.status).toBe(201);
    const sess = (await created.json()) as { id: string; title: string };
    expect(sess.title).toBe("新建 Agent 对话");

    const missing = await app.request("/api/sessions", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: "t" }),
    });
    expect(missing.status).toBe(400);
  });

  it("PATCH /api/sessions/:id：元数据可改；turns 注入被丢弃；status 非法 400", async () => {
    const { app, workspaceRepo, sessionRepo } = createHarnessServer({ dbPath: ":memory:" });
    const ws = await workspaceRepo.create({ name: "w", rootPath: "/tmp/va-test-patch", permission: "read-write" });
    const sess = await sessionRepo.create({ workspaceId: ws.id });

    const renamed = await app.request(`/api/sessions/${sess.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: "renamed", pinned: true }),
    });
    expect(renamed.status).toBe(200);
    const after = await sessionRepo.get(sess.id);
    expect(after?.title).toBe("renamed");
    expect(after?.pinned).toBe(true);

    // 属主字段注入：turns 被丢弃（patch 成功但不动正文），workspaceId 不被迁移
    const inject = await app.request(`/api/sessions/${sess.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ turns: [{ prompt: "injected" }], workspaceId: "ws-other" }),
    });
    expect(inject.status).toBe(200);
    const afterInject = await sessionRepo.get(sess.id);
    expect(afterInject?.turns).toEqual([]);
    expect(afterInject?.workspaceId).toBe(ws.id);

    const badStatus = await app.request(`/api/sessions/${sess.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: "hacked" }),
    });
    expect(badStatus.status).toBe(400);
  });

  it("POST /api/settings/models：合法 201；provider 非法 400；非法 baseUrl 400", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const created = await app.request("/api/settings/models", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "P", provider: "openai", model: "gpt-x", apiKey: "sk-abc123456" }),
    });
    expect(created.status).toBe(201);

    const badProvider = await app.request("/api/settings/models", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "P", provider: "nope", model: "m" }),
    });
    expect(badProvider.status).toBe(400);

    const badUrl = await app.request("/api/settings/models", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "P", provider: "openai", model: "m", baseUrl: "javascript:alert(1)" }),
    });
    expect(badUrl.status).toBe(400);
  });
});
