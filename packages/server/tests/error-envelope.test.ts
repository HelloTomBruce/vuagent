/**
 * TASK-089：全局错误收口 + 请求 ID + secureHeaders + 日志脱敏
 *
 * - handler 抛错 → 统一 500 信封（err.message 不外泄，详情进服务端日志带 requestId）；
 * - 404 统一 JSON 信封（此前落 Hono 默认 text）；
 * - 响应头 x-request-id 与请求日志行 req= 对账；
 * - secureHeaders 安全响应头存在；
 * - sanitizeForLog：密钥键名掩码 + 长字符串截断。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { sanitizeForLog } from "../src/security.js";

const LOCAL_ORIGIN = "http://localhost:5173";

describe("全局错误收口（TASK-089）", () => {
  it("handler 抛错 → 500 信封：无内部 message 泄漏，含 code 与 requestId，详情进日志", async () => {
    const { app, workspaceRepo } = createHarnessServer({ dbPath: ":memory:" });
    // 破坏仓储依赖制造未捕获异常：消息携带「密钥样字符串」验证不外泄
    (workspaceRepo as unknown as { get: () => Promise<never> }).get = async () => {
      throw new Error("boom OPENAI_API_KEY=sk-leak-secret-value");
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await app.request("/api/workspaces/ws-x/files", { headers: { Origin: LOCAL_ORIGIN } });
      expect(res.status).toBe(500);
      const json = (await res.json()) as { error: string; code: string; requestId: string };
      expect(json.code).toBe("INTERNAL_ERROR");
      expect(json.requestId).toMatch(/^req-/);
      expect(json.error).not.toContain("sk-leak-secret-value");
      // 详情进服务端日志（NDJSON，带 requestId）
      expect(errorSpy).toHaveBeenCalled();
      const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("UNHANDLED_ERROR");
      expect(logged).toContain("sk-leak-secret-value"); // 详情留给服务端
      expect(logged).toContain(json.requestId);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("请求头透传 x-request-id 时沿用；响应头回带", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/workspaces", {
      headers: { Origin: LOCAL_ORIGIN, "x-request-id": "req-my-trace-1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req-my-trace-1");
  });

  it("未透传时生成 req-<8hex>，与请求日志行 req= 对账", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await app.request("/api/workspaces", { headers: { Origin: LOCAL_ORIGIN } });
      const requestId = res.headers.get("x-request-id");
      expect(requestId).toMatch(/^req-[0-9a-f]{8}$/);
      const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain(`req=${requestId}`);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("404 统一 JSON 信封", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/no-such-route", { headers: { Origin: LOCAL_ORIGIN } });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string; error: string };
    expect(json.code).toBe("NOT_FOUND");
    expect(json.error).toContain("/api/no-such-route");
  });

  it("secureHeaders 安全响应头存在", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBeTruthy();
  });
});

describe("sanitizeForLog 日志脱敏（TASK-089）", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("密钥样键名的字符串值被掩码", () => {
    const out = sanitizeForLog({
      apiKey: "sk-abcdef123456",
      VUAGENT_TOKEN: "top-secret",
      nested: { password: "hunter2", note: "safe" },
      authorization: "Bearer xyz",
    });
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("sk-abcdef123456");
    expect(out).not.toContain("top-secret");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("Bearer xyz");
    expect(out).toContain("safe");
  });

  it("长字符串截断（base64/文件内容不进日志正文）", () => {
    const out = sanitizeForLog({ blob: "x".repeat(2000), name: "ok" });
    expect(out).toContain("…[+1500 字符]");
    expect(out).toContain("ok");
  });

  it("整体行封顶 + 序列化失败回落 String()", () => {
    expect(sanitizeForLog("x".repeat(6000)).length).toBeLessThan(6000);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sanitizeForLog(circular)).toContain("[object Object]");
  });
});
