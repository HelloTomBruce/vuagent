import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { MockDriver } from "./helpers/mock-driver.js";
import {
  DEFAULT_LOCAL_ORIGINS,
  isAllowedOrigin,
  isLoopbackHost,
  isProfileSelectionOnly,
  maskApiKey,
  resolveBindPlan,
  resolveSecurityConfig,
  sanitizeModelProfile,
} from "../src/security.js";

/** 绕过安全门的合法本地 Origin */
const LOCAL_ORIGIN = "http://localhost:5173";
const EVIL_ORIGIN = "https://evil.example.com";
const JSON_HEADERS = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

describe("安全基线中间件（TASK-011）：Origin 白名单 / Bearer 鉴权", () => {
  it("白名单本地 Origin 正常放行并下发 CORS 头", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/workspaces", { headers: { Origin: LOCAL_ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
  });

  it("非白名单 Origin 被主动拒绝（403）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/workspaces", { headers: { Origin: EVIL_ORIGIN } });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("VUAGENT_TOKEN");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("localhost 但端口不在白名单内同样拒绝（防同机恶意页面）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/workspaces", {
      headers: { Origin: "http://localhost:9999" },
    });
    expect(res.status).toBe(403);
  });

  it("无 Origin 头（同源/非浏览器客户端）正常放行", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/workspaces");
    expect(res.status).toBe(200);
  });

  it("/api/health 免检：任意 Origin、无令牌均可访问", async () => {
    const { app } = createHarnessServer({
      dbPath: ":memory:",
      security: { authToken: "secret-token" },
    });
    const res = await app.request("/api/health", { headers: { Origin: EVIL_ORIGIN } });
    expect(res.status).toBe(200);
  });

  it("配置 VUAGENT_TOKEN 后：缺令牌 401、错令牌 401、正确令牌放行", async () => {
    const { app } = createHarnessServer({
      dbPath: ":memory:",
      security: { authToken: "secret-token" },
    });

    const noAuth = await app.request("/api/workspaces");
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get("www-authenticate")).toBe("Bearer");

    const badAuth = await app.request("/api/workspaces", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(badAuth.status).toBe(401);

    const okAuth = await app.request("/api/workspaces", {
      headers: { Authorization: "Bearer secret-token" },
    });
    expect(okAuth.status).toBe(200);
  });

  it("启用令牌后远端 Origin 放行（访问由 Bearer 把守），带令牌全 API 正常", async () => {
    const { app } = createHarnessServer({
      dbPath: ":memory:",
      security: { authToken: "secret-token" },
    });
    const res = await app.request("/api/workspaces", {
      headers: { Origin: EVIL_ORIGIN, Authorization: "Bearer secret-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(EVIL_ORIGIN);
  });

  it("OPTIONS 预检不要求令牌，且允许 Authorization 头", async () => {
    const { app } = createHarnessServer({
      dbPath: ":memory:",
      security: { authToken: "secret-token" },
    });
    const res = await app.request("/api/workspaces", {
      method: "OPTIONS",
      headers: {
        Origin: "https://remote.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://remote.example.com");
    expect((res.headers.get("access-control-allow-headers") || "").toLowerCase()).toContain(
      "authorization"
    );
  });
});

describe("apiKey 脱敏回显（TASK-011）", () => {
  it("maskApiKey：保留末 4 位；短密钥不回显真实片段；空值 undefined", () => {
    expect(maskApiKey("sk-abcdef123456")).toBe("****3456");
    expect(maskApiKey("abcd")).toBe("****");
    expect(maskApiKey("")).toBeUndefined();
    expect(maskApiKey(undefined)).toBeUndefined();
  });

  it("sanitizeModelProfile：剥离明文 apiKey 并附带 maskedApiKey", () => {
    const sanitized = sanitizeModelProfile({
      id: "p1",
      name: "n",
      provider: "openai",
      model: "m",
      apiKey: "sk-abcdef123456",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(sanitized).not.toHaveProperty("apiKey");
    expect(sanitized.maskedApiKey).toBe("****3456");
  });

  it("创建/查询/更新模型的任何 HTTP 响应都不含明文 apiKey", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });

    const created = await app.request("/api/settings/models", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "Test Key Profile",
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "sk-abcdef123456",
      }),
    });
    expect(created.status).toBe(201);
    const createdJson = await created.json();
    expect(createdJson.apiKey).toBeUndefined();
    expect(createdJson.maskedApiKey).toBe("****3456");

    const list = await app.request("/api/settings/models", { headers: { Origin: LOCAL_ORIGIN } });
    const rawBody = await list.text();
    expect(rawBody).not.toContain("sk-abcdef123456");
    expect(rawBody).toContain("****3456");

    const listJson = JSON.parse(rawBody) as Array<Record<string, unknown>>;
    const target = listJson.find((p) => p.name === "Test Key Profile");
    expect(target).toBeTruthy();
    expect(target?.apiKey).toBeUndefined();
    expect(target?.maskedApiKey).toBe("****3456");

    // PATCH 不带 apiKey（脱敏回填场景）→ 服务端保留原密钥
    const patched = await app.request(`/api/settings/models/${target?.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Test Key Profile Renamed", apiKey: "" }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.text()).not.toContain("sk-abcdef123456");

    const after = await app.request("/api/settings/models", { headers: { Origin: LOCAL_ORIGIN } });
    const afterJson = JSON.parse(await after.text()) as Array<Record<string, unknown>>;
    const afterTarget = afterJson.find((p) => p.id === target?.id);
    expect(afterTarget?.name).toBe("Test Key Profile Renamed");
    expect(afterTarget?.maskedApiKey).toBe("****3456");
  });

  it("PATCH 回传 maskedApiKey 不会污染存储，传新密钥则覆盖", async () => {
    const { app, settingsRepo } = createHarnessServer({ dbPath: ":memory:" });

    await app.request("/api/settings/models", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "Mask Roundtrip",
        provider: "openai",
        model: "gpt-x",
        apiKey: "sk-original-key-8888",
      }),
    });
    const list = (await (
      await app.request("/api/settings/models", { headers: { Origin: LOCAL_ORIGIN } })
    ).json()) as Array<{ id: string; name: string }>;
    const id = list.find((p) => p.name === "Mask Roundtrip")!.id;

    // 误回传掩码字段：不得覆盖原密钥
    await app.request(`/api/settings/models/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ apiKey: "****8888", maskedApiKey: "****8888" }),
    });
    const stored = await settingsRepo.getProfile(id);
    expect(stored?.apiKey).toBe("sk-original-key-8888");
    expect(Object.hasOwn(stored ?? {}, "maskedApiKey")).toBe(false);

    // 显式输入新密钥：正常覆盖
    await app.request(`/api/settings/models/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ apiKey: "sk-rotated-key-9999" }),
    });
    const rotated = await settingsRepo.getProfile(id);
    expect(rotated?.apiKey).toBe("sk-rotated-key-9999");

    // 边界：以 **** 开头但与已存密钥掩码不相等的新密钥 = 真实新密钥，正常落库
    //（仅按前缀判断会把这类新密钥静默丢弃）
    await app.request(`/api/settings/models/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ apiKey: "****literal-new-key" }),
    });
    const literal = await settingsRepo.getProfile(id);
    expect(literal?.apiKey).toBe("****literal-new-key");
  });

  it("连通性探测支持 profileId 兜底：未重输密钥时复用服务端存储凭据", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });

    await app.request("/api/settings/models", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "Probe Fallback",
        provider: "openai",
        model: "probe-model-x",
        baseUrl: "http://127.0.0.1:9/v1",
        apiKey: "sk-stored-credential",
      }),
    });
    const list = (await (
      await app.request("/api/settings/models", { headers: { Origin: LOCAL_ORIGIN } })
    ).json()) as Array<{ id: string; name: string }>;
    const id = list.find((p) => p.name === "Probe Fallback")!.id;

    // 不携带 apiKey/baseUrl：应落回存储的 baseUrl（不可达端口 → ok:false 且 endpoint 匹配）
    const res = await app.request("/api/settings/models/test", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ profileId: id, model: "probe-model-x" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.endpoint).toBe("http://127.0.0.1:9/v1");
  });
});

describe("providerConfig / modelOverride 信任边界（TASK-011）", () => {
  function scriptedServer(allowByoProvider?: boolean) {
    const mockDriver = new MockDriver();
    mockDriver.setScript({
      steps: [[{ type: "text", text: "boundary-ok" }]],
    });
    return createHarnessServer({
      dbPath: ":memory:",
      modelDriver: mockDriver,
      security: allowByoProvider === undefined ? undefined : { allowByoProvider },
    });
  }

  it("默认拒绝携带 providerConfig 的 /api/chat 请求（403 + 明确文案）", async () => {
    const { app } = scriptedServer();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: "hi",
        providerConfig: { baseUrl: "http://attacker.example.com/v1", apiKey: "leak" },
      }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("PROVIDER_OVERRIDE_FORBIDDEN");
    expect(json.error).toContain("VUAGENT_ALLOW_BYO_PROVIDER");
    expect(json.error).toContain("modelProfileId");
  });

  it("默认放行仅切换已登记 profile 的 modelOverride（SSE 正常）", async () => {
    const { app } = scriptedServer();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: "hello",
        modelOverride: { id: "deepseek-v3" },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("boundary-ok");
    expect(text).toContain("data: [DONE]");
  });

  it("默认拒绝未登记 profile id 与带覆盖字段的 modelOverride", async () => {
    const { app } = scriptedServer();

    const unknownId = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ prompt: "hi", modelOverride: { id: "not-registered" } }),
    });
    expect(unknownId.status).toBe(403);

    const smuggled = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: "hi",
        modelOverride: { id: "deepseek-v3", baseUrl: "http://attacker.example.com/v1" },
      }),
    });
    expect(smuggled.status).toBe(403);
    expect((await smuggled.json()).error).toContain("VUAGENT_ALLOW_BYO_PROVIDER");
  });

  it("VUAGENT_ALLOW_BYO_PROVIDER=1 开启后 providerConfig 透传可用", async () => {
    const { app } = scriptedServer(true);
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        prompt: "byo hello",
        providerConfig: {
          id: "byo-profile",
          name: "BYO",
          provider: "openai",
          model: "mock-model",
          baseUrl: "http://byo.example.com/v1",
          apiKey: "byo-key",
        },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("boundary-ok");
    expect(text).toContain("data: [DONE]");
  });
});

describe("resolveSecurityConfig 环境变量解析", () => {
  beforeEach(() => {
    vi.stubEnv("VUAGENT_TOKEN", "");
    vi.stubEnv("VUAGENT_ALLOW_BYO_PROVIDER", "");
    vi.stubEnv("VUAGENT_CORS_ORIGINS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("默认：无令牌、BYO 关闭、仅本地白名单", () => {
    const config = resolveSecurityConfig();
    expect(config.authToken).toBe("");
    expect(config.allowByoProvider).toBe(false);
    for (const origin of DEFAULT_LOCAL_ORIGINS) {
      expect(isAllowedOrigin(origin, config)).toBe(true);
    }
    expect(isAllowedOrigin("https://any.example.com", config)).toBe(false);
  });

  it("VUAGENT_TOKEN / VUAGENT_ALLOW_BYO_PROVIDER / VUAGENT_CORS_ORIGINS 生效", () => {
    vi.stubEnv("VUAGENT_TOKEN", "  t0k3n  ");
    vi.stubEnv("VUAGENT_ALLOW_BYO_PROVIDER", "1");
    vi.stubEnv("VUAGENT_CORS_ORIGINS", "https://a.example.com, https://b.example.com");
    const config = resolveSecurityConfig();
    expect(config.authToken).toBe("t0k3n");
    expect(config.allowByoProvider).toBe(true);
    expect(isAllowedOrigin("https://a.example.com", config)).toBe(true);
    expect(isAllowedOrigin("https://c.example.com", config)).toBe(false);
  });
});

describe("isProfileSelectionOnly 单元", () => {
  it("仅 { id: string } 形态返回 true，其余返回 false", () => {
    expect(isProfileSelectionOnly({ id: "prof-1" })).toBe(true);
    expect(isProfileSelectionOnly({ id: "prof-1", baseUrl: "http://x" })).toBe(false);
    expect(isProfileSelectionOnly({})).toBe(false);
    expect(isProfileSelectionOnly("prof-1")).toBe(false);
    expect(isProfileSelectionOnly(null)).toBe(false);
    expect(isProfileSelectionOnly(undefined)).toBe(false);
    expect(isProfileSelectionOnly(["prof-1"])).toBe(false);
  });
});

describe("绑定闸门 resolveBindPlan（TASK-085）", () => {
  const baseEnv = { VUAGENT_HOST: "", VUAGENT_TOKEN: "", VUAGENT_ALLOW_UNSAFE_NETWORK: "" };

  it("默认绑 127.0.0.1：回环、不拒绝、不豁免", () => {
    const plan = resolveBindPlan({ ...baseEnv });
    expect(plan.host).toBe("127.0.0.1");
    expect(plan.external).toBe(false);
    expect(plan.refused).toBe(false);
    expect(plan.unsafeExempted).toBe(false);
    expect(plan.refusalReason).toBe("");
  });

  it("isLoopbackHost：localhost / 127.x / ::1 / [::1] 视为回环；0.0.0.0 / 内网 IP / 域名非回环", () => {
    for (const host of ["localhost", "LOCALHOST", "127.0.0.1", "127.8.8.8", "::1", "[::1]", "  ::1  "]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ["0.0.0.0", "192.168.1.5", "example.com", "[::]", ""]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it("对外绑定（0.0.0.0）且无令牌 → 拒绝启动，指引含令牌与豁免开关", () => {
    const plan = resolveBindPlan({ ...baseEnv, VUAGENT_HOST: "0.0.0.0" });
    expect(plan.host).toBe("0.0.0.0");
    expect(plan.external).toBe(true);
    expect(plan.refused).toBe(true);
    expect(plan.unsafeExempted).toBe(false);
    expect(plan.refusalReason).toContain("VUAGENT_TOKEN");
    expect(plan.refusalReason).toContain("VUAGENT_ALLOW_UNSAFE_NETWORK");
    expect(plan.refusalReason).toContain("127.0.0.1");
  });

  it("内网 IP 对外绑定同样受闸门约束（回环判断不看私网段）", () => {
    expect(resolveBindPlan({ ...baseEnv, VUAGENT_HOST: "192.168.1.5" }).refused).toBe(true);
  });

  it("VUAGENT_ALLOW_UNSAFE_NETWORK=1 豁免放行（unsafeExempted，非 refused）", () => {
    const plan = resolveBindPlan({
      ...baseEnv,
      VUAGENT_HOST: "0.0.0.0",
      VUAGENT_ALLOW_UNSAFE_NETWORK: "1",
    });
    expect(plan.external).toBe(true);
    expect(plan.refused).toBe(false);
    expect(plan.unsafeExempted).toBe(true);
  });

  it("对外绑定 + 已配置令牌 → 正常放行且不视为豁免", () => {
    const plan = resolveBindPlan({
      ...baseEnv,
      VUAGENT_HOST: "192.168.1.5",
      VUAGENT_TOKEN: "secret-token",
    });
    expect(plan.external).toBe(true);
    expect(plan.refused).toBe(false);
    expect(plan.unsafeExempted).toBe(false);
  });

  it("令牌仅空白等同未配置（拒绝）；含实际内容则放行（trim 口径与 resolveSecurityConfig 一致）", () => {
    expect(resolveBindPlan({ ...baseEnv, VUAGENT_HOST: "0.0.0.0", VUAGENT_TOKEN: "   " }).refused).toBe(
      true
    );
    expect(resolveBindPlan({ ...baseEnv, VUAGENT_HOST: "0.0.0.0", VUAGENT_TOKEN: " t " }).refused).toBe(
      false
    );
  });

  it("回环绑定下令牌无关紧要：无令牌也放行", () => {
    const plan = resolveBindPlan({ ...baseEnv, VUAGENT_HOST: "localhost" });
    expect(plan.host).toBe("localhost");
    expect(plan.refused).toBe(false);
  });
});
