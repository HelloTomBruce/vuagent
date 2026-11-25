/**
 * TASK-095/096（主线条目）：health deep 深度探测 + LOG_LEVEL 请求日志门控
 *
 * - /api/health?deep=1：db 探针 + redis 探针（启用时），degraded → 503；
 * - 默认浅探行为不变（liveness 兼容既有断言）；
 * - 请求日志受 LOG_LEVEL 门控（error 级静默 info 请求行）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarnessServer } from "../src/server.js";
import { MemoryStorageDriver } from "../src/storage/drivers/memory.driver.js";
import type { IStorageDriver } from "../src/storage/drivers/base.driver.js";

const LOCAL_ORIGIN = "http://localhost:5173";

/** 故障注入驱动：get 直接抛错（模拟底层存储不可用） */
function brokenDriver(): IStorageDriver {
  const base = new MemoryStorageDriver();
  return {
    get: async () => {
      throw new Error("db connection lost");
    },
    set: base.set.bind(base),
    delete: base.delete.bind(base),
    list: base.list.bind(base),
    clear: base.clear.bind(base),
  };
}

describe("health deep 深度探测（TASK-096）", () => {
  it("默认浅探：不带 checks 字段（liveness 兼容）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe("ok");
    expect(json.checks).toBeUndefined();
  });

  it("deep=1：db 探针 ok，含 latencyMs", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/health?deep=1");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      checks: Record<string, { ok: boolean; latencyMs: number }>;
    };
    expect(json.status).toBe("ok");
    expect(json.checks.db.ok).toBe(true);
    expect(typeof json.checks.db.latencyMs).toBe("number");
  });

  it("deep=1：存储故障桩 → 503 degraded；detail 脱敏（原文只进服务端日志，不回未鉴权调用方）", async () => {
    const logSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { app } = createHarnessServer({ storageDriver: brokenDriver() });
    const res = await app.request("/api/health?deep=1");
    expect(res.status).toBe(503);
    const json = (await res.json()) as {
      status: string;
      checks: Record<string, { ok: boolean; detail?: string }>;
    };
    expect(json.status).toBe("degraded");
    expect(json.checks.db.ok).toBe(false);
    // 审查 Required 修复回归锚点：health 免鉴权免限流，驱动层 err.message
    // （可含 sqlite 路径/redis 主机原文）不再回显给调用方，只落服务端日志
    expect(json.checks.db.detail).not.toContain("db connection lost");
    expect(json.checks.db.detail).toContain("服务端日志");
    const logged = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("HEALTH_PROBE_FAILED");
    expect(logged).toContain("db connection lost"); // 原因进日志供排查
    logSpy.mockRestore();
  });
});

describe("LOG_LEVEL 请求日志门控（TASK-096）", () => {
  beforeEach(() => {
    vi.stubEnv("LOG_LEVEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("LOG_LEVEL=error：info 级请求日志静默", async () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await app.request("/api/workspaces", { headers: { Origin: LOCAL_ORIGIN } });
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("[Vuagent Server] GET /api/workspaces");
  });

  it("LOG_LEVEL 缺省：请求日志照常输出", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await app.request("/api/workspaces", { headers: { Origin: LOCAL_ORIGIN } });
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[Vuagent Server] GET /api/workspaces");
  });
});
