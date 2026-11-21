/**
 * 供应商路由集成测试（P0 Provider 1:N Model）
 *
 * 覆盖 review 发现的盲区：新增的 5 个 provider 路由此前零 HTTP 层测试。
 * 重点验证「不该被前端控制的东西」确实控住了：
 *   · 入参白名单（不能覆盖 id / 时间戳）
 *   · provider 枚举校验 / baseUrl 协议校验
 *   · 删除守卫（无 cascade 时 409）
 *   · 模型建在供应商下时继承 provider 类型，且不落 baseUrl/apiKey
 *   · /models 响应绝不泄漏明文密钥
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHarnessServer } from "../src/server.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const JSON_HEADERS = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

interface Harness {
  app: ReturnType<typeof createHarnessServer>["app"];
}

function makeHarness(): Harness {
  const { app } = createHarnessServer({ dbPath: ":memory:" });
  return { app };
}

async function createProvider(app: Harness["app"], body: Record<string, unknown>) {
  const res = await app.request("/api/settings/providers", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("供应商路由：创建与白名单", () => {
  let app: Harness["app"];
  beforeEach(() => {
    app = makeHarness().app;
  });

  it("创建供应商：返回脱敏结果，不含明文密钥", async () => {
    const { status, json } = await createProvider(app, {
      name: "DeepSeek 官方",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-secret-abcd1234",
    });
    expect(status).toBe(201);
    expect(json.name).toBe("DeepSeek 官方");
    expect(Object.hasOwn(json, "apiKey")).toBe(false);
    expect(json.maskedApiKey).toContain("1234");
    expect(JSON.stringify(json)).not.toContain("sk-secret-abcd1234");
  });

  it("创建供应商：名称必填", async () => {
    const { status } = await createProvider(app, { name: "   ", provider: "openai" });
    expect(status).toBe(400);
  });

  it("创建供应商：非法 provider 枚举回落 custom", async () => {
    const { json } = await createProvider(app, { name: "X", provider: "not-a-provider" });
    expect(json.provider).toBe("custom");
  });

  it("创建供应商：拒绝非 http(s) 的 baseUrl", async () => {
    for (const bad of ["file:///etc/passwd", "ftp://example.com", "not-a-url"]) {
      const { status } = await createProvider(app, { name: "X", provider: "custom", baseUrl: bad });
      expect(status, bad).toBe(400);
    }
  });

  it("创建供应商：前端指定的 id 不会被采纳（防覆盖已有记录）", async () => {
    const first = await createProvider(app, {
      id: "hijack-me",
      name: "A",
      provider: "openai",
      apiKey: "sk-a-1111",
    });
    expect(first.json.id).not.toBe("hijack-me");

    // 再用同一个 id 建一个，不应覆盖第一条
    await createProvider(app, { id: "hijack-me", name: "B", provider: "openai" });
    const list = await (await app.request("/api/settings/providers", { headers: { Origin: LOCAL_ORIGIN } })).json();
    const names = list.map((p: { name: string }) => p.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(list).toHaveLength(2);
  });

  it("更新供应商：改凭证回显掩码更新，且不影响其它字段", async () => {
    const created = await createProvider(app, {
      name: "P",
      provider: "openai",
      baseUrl: "https://api.old.com/v1",
      apiKey: "sk-old-0001",
    });
    const res = await app.request(`/api/settings/providers/${created.json.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ baseUrl: "https://api.new.com/v1", apiKey: "sk-new-9999" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.baseUrl).toBe("https://api.new.com/v1");
    expect(json.maskedApiKey).toContain("9999");
    expect(json.name).toBe("P"); // 未传字段保持不变
  });

  it("更新不存在的供应商返回 404", async () => {
    const res = await app.request("/api/settings/providers/nope", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "X" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("供应商路由：模型挂载", () => {
  let app: Harness["app"];
  beforeEach(() => {
    app = makeHarness().app;
  });

  it("在供应商下建模型：继承 provider 类型，不落 baseUrl/apiKey", async () => {
    const prov = await createProvider(app, {
      name: "P",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-shared-1234",
    });

    const res = await app.request(`/api/settings/providers/${prov.json.id}/models`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "DeepSeek Chat",
        model: "deepseek-chat",
        contextWindow: 128000,
        // 恶意/多余字段：应被白名单挡掉
        baseUrl: "https://attacker.example.com",
        apiKey: "sk-evil",
        provider: "openai",
        providerId: "other-provider",
      }),
    });
    expect(res.status).toBe(201);
    const model = await res.json();

    expect(model.providerId).toBe(prov.json.id);
    expect(model.provider).toBe("deepseek"); // 取自供应商，而非前端
    expect(model.baseUrl).toBeUndefined();
    expect(model.apiKey).toBeUndefined();
    expect(Object.hasOwn(model, "maskedApiKey")).toBe(false);
  });

  it("一个供应商下可挂多个模型（核心诉求）", async () => {
    const prov = await createProvider(app, { name: "P", provider: "custom", apiKey: "sk-1" });
    for (const id of ["m1", "m2", "m3"]) {
      const r = await app.request(`/api/settings/providers/${prov.json.id}/models`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: id, model: id }),
      });
      expect(r.status).toBe(201);
    }
    const list = await (await app.request("/api/settings/providers", { headers: { Origin: LOCAL_ORIGIN } })).json();
    const target = list.find((p: { id: string }) => p.id === prov.json.id);
    expect(target.models).toHaveLength(3);
  });

  it("模型名或标识为空返回 400", async () => {
    const prov = await createProvider(app, { name: "P", provider: "custom" });
    const res = await app.request(`/api/settings/providers/${prov.json.id}/models`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "有名字" }),
    });
    expect(res.status).toBe(400);
  });

  it("往不存在的供应商下建模型返回 404", async () => {
    const res = await app.request("/api/settings/providers/ghost/models", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "n", model: "m" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("供应商路由：删除守卫", () => {
  let app: Harness["app"];
  beforeEach(() => {
    app = makeHarness().app;
  });

  it("仍挂着模型时拒绝删除并返回 409 + boundModels", async () => {
    const prov = await createProvider(app, { name: "P", provider: "custom" });
    await app.request(`/api/settings/providers/${prov.json.id}/models`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "M", model: "m" }),
    });

    const res = await app.request(`/api/settings/providers/${prov.json.id}`, {
      method: "DELETE",
      headers: { Origin: LOCAL_ORIGIN },
    });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.boundModels).toBe(1);
    expect(json.error).toContain("1");
  });

  it("cascade=true 时连带删除其下模型", async () => {
    const prov = await createProvider(app, { name: "P", provider: "custom" });
    for (const id of ["a", "b"]) {
      await app.request(`/api/settings/providers/${prov.json.id}/models`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: id, model: id }),
      });
    }

    const res = await app.request(`/api/settings/providers/${prov.json.id}?cascade=true`, {
      method: "DELETE",
      headers: { Origin: LOCAL_ORIGIN },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).removedModels).toBe(2);

    const list = await (await app.request("/api/settings/providers", { headers: { Origin: LOCAL_ORIGIN } })).json();
    expect(list).toHaveLength(0);
  });

  it("删除不存在的供应商返回 404", async () => {
    const res = await app.request("/api/settings/providers/ghost", {
      method: "DELETE",
      headers: { Origin: LOCAL_ORIGIN },
    });
    expect(res.status).toBe(404);
  });
});

describe("供应商路由：模型列表发现", () => {
  it("供应商不存在返回 404", async () => {
    const { app } = makeHarness();
    const res = await app.request("/api/settings/providers/ghost/models/discover", {
      headers: { Origin: LOCAL_ORIGIN },
    });
    expect(res.status).toBe(404);
  });

  it("非法 baseUrl 在写入口就被拦下（discover 拿不到非 http(s) 端点）", async () => {
    const { app } = makeHarness();
    const created = await createProvider(app, { name: "P", provider: "custom" });

    const patch = await app.request(`/api/settings/providers/${created.json.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ baseUrl: "file:///etc/passwd" }),
    });
    expect(patch.status).toBe(400);

    // 原 baseUrl 未被污染
    const list = await (await app.request("/api/settings/providers", { headers: { Origin: LOCAL_ORIGIN } })).json();
    const target = list.find((p: { id: string }) => p.id === created.json.id);
    expect(target.baseUrl).toBeUndefined();
  });
});

describe("review 修复回归：默认端点映射与 PATCH 校验", () => {
  it("PATCH 供应商：name 非字符串或空白 → 400，不静默清空名称", async () => {
    const { app } = makeHarness();
    const created = await createProvider(app, { name: "P", provider: "openai" });

    for (const bad of [123, "   "]) {
      const res = await app.request(`/api/settings/providers/${created.json.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: bad }),
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }

    // 原名称未被污染
    const list = await (await app.request("/api/settings/providers", { headers: { Origin: LOCAL_ORIGIN } })).json();
    expect(list.find((p: { id: string }) => p.id === created.json.id).name).toBe("P");
  });

  it("PATCH 模型：name/model 非字符串 → 400", async () => {
    const { app } = makeHarness();
    const prov = await createProvider(app, { name: "P", provider: "custom" });
    const model = await (
      await app.request(`/api/settings/providers/${prov.json.id}/models`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "M", model: "m" }),
      })
    ).json();

    for (const bad of [{ name: 42 }, { model: false }]) {
      const res = await app.request(`/api/settings/models/${model.id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(bad),
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("discover 默认端点按供应商类型路由：anthropic 未配 baseUrl 打官方端点 + x-api-key", async () => {
    const { app } = makeHarness();
    const created = await createProvider(app, {
      name: "Claude",
      provider: "anthropic",
      apiKey: "sk-ant-secret-0001",
    });

    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { headers?: Record<string, string> }) => {
        calls.push({ url: String(url), headers: { ...(init?.headers ?? {}) } });
        return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-4" }] }), { status: 200 });
      })
    );

    try {
      const res = await app.request(`/api/settings/providers/${created.json.id}/models/discover`, {
        headers: { Origin: LOCAL_ORIGIN },
      });
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.models).toEqual(["claude-sonnet-4"]);
      // 修复前：兜底到 api.openai.com，x-api-key 打在错误端点上必然 401
      expect(calls[0].url).toBe("https://api.anthropic.com/v1/models");
      expect(calls[0].headers["x-api-key"]).toBe("sk-ant-secret-0001");
      expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
      expect(calls[0].headers.Authorization).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("discover：deepseek 未配 baseUrl 默认打官方端点（不再兜到 OpenAI）", async () => {
    const { app } = makeHarness();
    const created = await createProvider(app, { name: "DS", provider: "deepseek", apiKey: "sk-ds-1" });

    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), { status: 200 });
      })
    );

    try {
      await app.request(`/api/settings/providers/${created.json.id}/models/discover`, {
        headers: { Origin: LOCAL_ORIGIN },
      });
      expect(urls[0]).toBe("https://api.deepseek.com/v1/models");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
