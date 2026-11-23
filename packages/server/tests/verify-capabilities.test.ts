/**
 * 能力验证探测（TASK-057）
 *
 * 三态 verdict：ok（端点接受）/ fail（4xx 参数类拒绝 → 声明与实际不符）/
 * inconclusive（鉴权/网络/超时，null）。信任边界：凭据不出服务端、
 * 端点取自已存配置、未勾选能力不发请求。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHarnessServer } from "../src/server.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const H = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

interface Harness {
  app: ReturnType<typeof createHarnessServer>["app"];
}
function makeHarness(): Harness {
  const { app } = createHarnessServer({ dbPath: ":memory:" });
  return { app };
}

async function createModel(app: Harness["app"], caps: Record<string, unknown>) {
  return createModelAt(app, caps, { name: "P", provider: "custom", baseUrl: "http://probe.test/v1", apiKey: "sk-1" });
}

/** 指定供应商形态建模型（Anthropic 原生端点路径用） */
async function createModelAt(
  app: Harness["app"],
  caps: Record<string, unknown>,
  provider: Record<string, unknown>
) {
  const prov = await (
    await app.request("/api/settings/providers", {
      method: "POST",
      headers: H,
      body: JSON.stringify(provider),
    })
  ).json();
  return (
    await app.request(`/api/settings/providers/${prov.id}/models`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "M", model: "m", capabilities: caps }),
    })
  ).json();
}

describe("verify-capabilities", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("未勾选能力：不发起任何探测请求", async () => {
    const { app } = makeHarness();
    const model = await createModel(app, {});
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (...a: unknown[]) => {
      calls.push(a);
      return new Response("{}", { status: 200 });
    }));

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(json.results).toEqual([]);
    expect(json.note).toContain("未勾选");
  });

  it("端点拒绝图片参数（4xx 且 body 提及 image）→ fail + 建议取消勾选", async () => {
    const { app } = makeHarness();
    const model = await createModel(app, { inputModalities: ["text", "image"] });
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "image content type is not supported" } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    ));

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].capability).toBe("image");
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].detail).toContain("建议取消勾选");
  });

  it("端点接受 → ok:true；探测请求体含图片 parts 与 max_tokens=1", async () => {
    const { app } = makeHarness();
    const model = await createModel(app, {
      inputModalities: ["text", "image"],
      reasoning: { supported: true, supportedEfforts: ["low", "high"] },
    });
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { body?: string }) => {
        bodies.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response("{}", { status: 200 });
      })
    );

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(json.results).toHaveLength(2);
    expect(json.results.every((r: { ok: boolean }) => r.ok === true)).toBe(true);
    // 请求形态断言：图片 parts + max_tokens=1 + effort 最低档；端点取自已存配置
    expect(bodies[0].url).toBe("http://probe.test/v1/chat/completions");
    expect(bodies[0].body.max_tokens).toBe(1);
    expect(JSON.stringify(bodies[0].body.messages)).toContain("image_url");
    expect(bodies[1].body.reasoning_effort).toBe("low");
    expect(bodies[1].body.max_tokens).toBe(1);
  });

  it("鉴权失败（401）→ inconclusive（null），不误判能力", async () => {
    const { app } = makeHarness();
    const model = await createModel(app, { inputModalities: ["text", "image"] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })));

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(json.results[0].ok).toBeNull();
    expect(json.results[0].detail).toContain("鉴权失败");
  });

  it("不存在的模型 → 404", async () => {
    const { app } = makeHarness();
    const res = await app.request("/api/settings/models/ghost/verify-capabilities", { method: "POST", headers: H });
    expect(res.status).toBe(404);
  });

  it("TASK-080 Anthropic 路径：thinking 探测 max_tokens > budget_tokens，鉴权走 x-api-key", async () => {
    const { app } = makeHarness();
    const model = await createModelAt(
      app,
      { reasoning: { supported: true, supportedEfforts: ["low", "high"] } },
      { name: "A", provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant-1" }
    );
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
        calls.push({
          url: String(url),
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: JSON.parse(String(init?.body ?? "{}")),
        });
        return new Response("{}", { status: 200 });
      })
    );

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].capability).toBe("reasoning");
    expect(json.results[0].ok).toBe(true);
    // 请求形态：Messages 协议端点 + x-api-key + budget 1024 / max_tokens 2048（> budget，防恒 400 误报）
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers["x-api-key"]).toBe("sk-ant-1");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect((calls[0].body.thinking as { budget_tokens: number }).budget_tokens).toBe(1024);
    expect(calls[0].body.max_tokens).toBe(2048);
  });

  it("TASK-080 报错只提 max_tokens（未指向被测参数）→ inconclusive 而非 fail", async () => {
    const { app } = makeHarness();
    const model = await createModel(app, { reasoning: { supported: true, supportedEfforts: ["low"] } });
    // 模拟 o 系端点：拒 max_tokens 而非拒 reasoning_effort —— 不能据此判能力不符
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(json.results[0].capability).toBe("reasoning");
    expect(json.results[0].ok).toBeNull();
    expect(json.results[0].detail).toContain("无法判定");
    expect(json.results[0].detail).not.toContain("建议取消勾选");
  });

  it("TASK-080 报错指向被测参数本身 → 仍判 fail（建议取消勾选）", async () => {
    const { app } = makeHarness();
    const model = await createModel(app, { reasoning: { supported: true, supportedEfforts: ["low"] } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model." } }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].detail).toContain("建议取消勾选");
  });

  it("TASK-080 Anthropic 报错只提 max_tokens 上限 → inconclusive，不误判 thinking 能力", async () => {
    const { app } = makeHarness();
    const model = await createModelAt(
      app,
      { reasoning: { supported: true, supportedEfforts: ["low"] } },
      { name: "A", provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant-1" }
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { type: "invalid_request_error", message: "max_tokens: 2048 exceeds the gateway limit for this model" } }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const res = await app.request(`/api/settings/models/${model.id}/verify-capabilities`, { method: "POST", headers: H });
    const json = await res.json();
    expect(json.results[0].ok).toBeNull();
    expect(json.results[0].detail).not.toContain("建议取消勾选");
  });
});
