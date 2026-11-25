/**
 * TASK-088：HTTP 限流中间件 + bash_run 子进程环境净化
 *
 * 限流：固定窗口计数（内存 store），key = IP + Bearer 指纹 + 作用域；
 * 探测类端点独立更严限额；/api/health 豁免；429 带 Retry-After；limit=0 关闭。
 * bash env：safe 白名单（密钥类键名一律剥离）/ strict 最小集 / inherit 完整继承；
 * 默认 safe（相对旧行为的安全收紧），printenv 读不到服务进程密钥。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MiddlewareHandler, Next } from "hono";
import {
  MemoryRateLimitStore,
  createRateLimitMiddleware,
  DEFAULT_RATE_LIMITS,
} from "../src/core/rate-limit.js";
import { buildChildEnv, createBashRunTool } from "../src/tools/system/bash-tool.js";
import { createHarnessServer } from "../src/server.js";
import type { ToolExecutionContext } from "../src/core/types.js";
import { ActionHub } from "../src/core/action-hub.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const H = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

/* ==========================================================================
   单元：MemoryRateLimitStore（固定窗口）
   ========================================================================== */

describe("MemoryRateLimitStore 固定窗口（TASK-088）", () => {
  it("窗口内累计计数；跨窗口重置；resetMs 为窗口余量", () => {
    let t = 0;
    const store = new MemoryRateLimitStore(() => t);
    expect(store.hit("k", 1000).count).toBe(1);
    t = 400;
    expect(store.hit("k", 1000).count).toBe(2);
    expect(store.hit("k", 1000).resetMs).toBe(600);
    t = 1000; // 跨过窗口边界 → 重置
    expect(store.hit("k", 1000).count).toBe(1);
  });

  it("不同 key 各自计数", () => {
    const store = new MemoryRateLimitStore(() => 0);
    expect(store.hit("a", 1000).count).toBe(1);
    expect(store.hit("a", 1000).count).toBe(2);
    expect(store.hit("b", 1000).count).toBe(1);
  });
});

/* ==========================================================================
   中间件行为（编程注入微小限额，验证 429/Retry-After/作用域分离/豁免）
   ========================================================================== */

function limiter(globalLimit: number, probeLimit: number) {
  return createRateLimitMiddleware({
    global: { windowMs: 60_000, limit: globalLimit },
    probe: { windowMs: 60_000, limit: probeLimit },
    store: new MemoryRateLimitStore(() => 0),
  });
}

const next = (() => Promise.resolve(new Response("ok"))) as unknown as Next;
const run = (mw: MiddlewareHandler, path: string, auth?: string, method = "POST") =>
  mw(fakeCtx(path, auth, method), next) as Promise<Response>;

/** 最小 Hono Context 形状（middleware 只消费 req.path / req.header / env / header / json） */
function fakeCtx(path: string, auth?: string, method = "POST") {
  const resHeaders: Record<string, string> = {};
  return {
    req: {
      path,
      method,
      header: (name: string) =>
        auth && name.toLowerCase() === "authorization" ? `Bearer ${auth}` : undefined,
    },
    env: undefined,
    header: (name: string, value: string) => {
      resHeaders[name] = value;
    },
    json: (body: unknown, status: number, headers?: Record<string, string>) =>
      new Response(JSON.stringify(body), { status, headers }),
  } as never;
}

/** 携 X-Forwarded-For 与模拟 socket 地址的上下文（XFF 信任语义用例） */
function ctxWithXff(xff: string, remoteAddress = "203.0.113.7") {
  return {
    req: {
      path: "/api/sessions",
      method: "POST",
      header: (name: string) => (name.toLowerCase() === "x-forwarded-for" ? xff : undefined),
    },
    env: { incoming: { socket: { remoteAddress } } },
    header: () => {},
    json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
  } as never;
}

describe("createRateLimitMiddleware（TASK-088）", () => {
  it("超限 429 + Retry-After + X-RateLimit 头；窗口语义由 store 保证", async () => {
    const mw = limiter(2, 2);
    const r1 = await run(mw, "/api/sessions");
    const r2 = await run(mw, "/api/sessions");
    const r3 = await run(mw, "/api/sessions");
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get("Retry-After")).toBe("60");
    const body = (await r3.json()) as { code: string };
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("探测端点独立计数：probe 限额打满不影响 global 作用域", async () => {
    const mw = limiter(10, 1);
    const ok = await run(mw, "/api/settings/models/p1/verify-capabilities");
    const over = await run(mw, "/api/settings/providers/pro1/models/discover");
    const globalStillOk = await run(mw, "/api/sessions");
    expect(ok.status).toBe(200);
    expect(over.status).toBe(429); // probe 第 2 次 → 429
    expect(globalStillOk.status).toBe(200); // global 桶不受影响
  });

  it("/api/health 豁免：无限打不 429", async () => {
    const mw = limiter(1, 1);
    for (let i = 0; i < 5; i++) {
      expect((await run(mw, "/api/health")).status).toBe(200);
    }
  });

  it("有效令牌分桶：同 IP 携不同【有效】令牌互不挤兑（isValidToken 确认后）", async () => {
    const mw = createRateLimitMiddleware({
      global: { windowMs: 60_000, limit: 1 },
      probe: { windowMs: 60_000, limit: 1 },
      store: new MemoryRateLimitStore(() => 0),
      isValidToken: (t) => t === "valid-a" || t === "valid-b",
    });
    expect((await run(mw, "/api/sessions", "valid-a")).status).toBe(200);
    expect((await run(mw, "/api/sessions", "valid-a")).status).toBe(429);
    expect((await run(mw, "/api/sessions", "valid-b")).status).toBe(200); // 另一有效令牌独立桶
  });

  it("无效令牌共享 IP 桶（防爆破关键）：换令牌无法重置计数", async () => {
    // 爆破形态：每个错误猜测都是不同令牌——旧「按请求方指纹分桶」口径下每次
    // 计数归 1 永不 429；现口径全部落 "-" 共享桶
    const mw = limiter(3, 3);
    for (let i = 0; i < 3; i++) {
      expect((await run(mw, "/api/sessions", `guess-${i}`)).status).toBe(200);
    }
    expect((await run(mw, "/api/sessions", "guess-999")).status).toBe(429); // 新令牌仍受限
    expect((await run(mw, "/api/sessions")).status).toBe(429); // 无令牌同桶
  });

  it("OPTIONS 预检不占预算（CORS 预检与真实请求同阶，计入会砍半浏览器配额）", async () => {
    const mw = limiter(1, 1);
    for (let i = 0; i < 5; i++) {
      expect((await run(mw, "/api/sessions", undefined, "OPTIONS")).status).toBe(200);
    }
    expect((await run(mw, "/api/sessions", undefined, "POST")).status).toBe(200);
    expect((await run(mw, "/api/sessions", undefined, "POST")).status).toBe(429);
  });

  it("直连（默认 trustProxy=false）：XFF 不采信，不同伪造 XFF 落同一桶", async () => {
    const mw = createRateLimitMiddleware({
      global: { windowMs: 60_000, limit: 1 },
      probe: { windowMs: 60_000, limit: 1 },
      store: new MemoryRateLimitStore(() => 0),
    });
    const ctx1 = ctxWithXff("9.9.9.1");
    const ctx2 = ctxWithXff("9.9.9.2");
    expect((await mw(ctx1, next) as Response).status).toBe(200);
    expect((await mw(ctx2, next) as Response).status).toBe(429); // 伪造换 XFF 不给新桶
  });

  it("trustProxy=true：采信 XFF【末段】（最近一跳可信代理追加的真实来源）", async () => {
    const mw = createRateLimitMiddleware({
      global: { windowMs: 60_000, limit: 1 },
      probe: { windowMs: 60_000, limit: 1 },
      store: new MemoryRateLimitStore(() => 0),
      trustProxy: true,
    });
    // 伪造前段不同、末段相同 → 同一真实客户端 → 同桶
    expect((await mw(ctxWithXff("1.1.1.1, 10.0.0.9"), next) as Response).status).toBe(200);
    expect((await mw(ctxWithXff("2.2.2.2, 10.0.0.9"), next) as Response).status).toBe(429);
    // 末段不同 → 不同客户端 → 新桶
    expect((await mw(ctxWithXff("2.2.2.2, 10.0.0.8"), next) as Response).status).toBe(200);
  });

  it("limit=0 关闭限流（跳过计数，无 429）", async () => {
    const mw = limiter(0, 0);
    for (let i = 0; i < 5; i++) {
      expect((await run(mw, "/api/sessions")).status).toBe(200);
    }
  });

  it("默认规则常量：全局 240 / 探测 12 每分钟", () => {
    expect(DEFAULT_RATE_LIMITS.global.limit).toBe(240);
    expect(DEFAULT_RATE_LIMITS.probe.limit).toBe(12);
    expect(DEFAULT_RATE_LIMITS.global.windowMs).toBe(60_000);
  });
});

/* ==========================================================================
   路由级：ServerOptions.rateLimit 注入 + 默认装配可用
   ========================================================================== */

describe("限流路由装配（TASK-088）", () => {
  it("注入 limit=2：第 3 次 POST /api/sessions（缺 workspaceId 也先过限流链）→ 429", async () => {
    const { app } = createHarnessServer({
      dbPath: ":memory:",
      rateLimit: {
        global: { windowMs: 60_000, limit: 2 },
        probe: { windowMs: 60_000, limit: 2 },
      },
    });
    const res1 = await app.request("/api/sessions", { method: "POST", headers: H, body: "{}" });
    const res2 = await app.request("/api/sessions", { method: "POST", headers: H, body: "{}" });
    const res3 = await app.request("/api/sessions", { method: "POST", headers: H, body: "{}" });
    expect(res1.status).toBe(400); // 业务校验正常（限流未拦截）
    expect(res2.status).toBe(400);
    expect(res3.status).toBe(429);
    expect(((await res3.json()) as { code: string }).code).toBe("RATE_LIMITED");
  });

  it("鉴权失败路径被限流（防爆破关键）：不同错令牌共享 IP 桶 → 硬顶 429", async () => {
    // 回归锚点：限流中间件现注册在鉴权之前——旧「鉴权之后计数」装配下此用例
    // 恒 300×401 零 429（限流器看不到失败流量）
    const { app } = createHarnessServer({
      dbPath: ":memory:",
      security: { authToken: "right-token" },
      rateLimit: {
        global: { windowMs: 60_000, limit: 3 },
        probe: { windowMs: 60_000, limit: 3 },
      },
    });
    const attempt = (token: string) =>
      app.request("/api/sessions", {
        method: "POST",
        headers: { ...H, Authorization: `Bearer ${token}` },
        body: "{}",
      });
    for (let i = 0; i < 3; i++) {
      const res = await attempt(`wrong-${i}`);
      expect(res.status).toBe(401); // 未超限：正常 401
    }
    const res4 = await attempt("wrong-999");
    expect(res4.status).toBe(429); // 爆破撞硬顶：换令牌无效
    expect(((await res4.json()) as { code: string }).code).toBe("RATE_LIMITED");
    // 有效令牌进独立指纹桶（合法访问不受爆破噪声牵连的设计取舍）
    const resOk = await app.request("/api/sessions", {
      method: "POST",
      headers: { ...H, Authorization: "Bearer right-token" },
      body: "{}",
    });
    expect(resOk.status).toBe(400); // 过限流链，落业务校验（缺 workspaceId）
  });

  it("默认装配（无注入）：常规测试流量不误伤（/api/workspaces 往返数 < 240）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    for (let i = 0; i < 30; i++) {
      const res = await app.request("/api/workspaces", { headers: { Origin: LOCAL_ORIGIN } });
      expect(res.status).toBe(200);
    }
  });
});

/* ==========================================================================
   bash 子进程环境净化
   ========================================================================== */

describe("buildChildEnv 环境净化（TASK-088）", () => {
  const sourceEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/user",
    LANG: "zh_CN.UTF-8",
    OPENAI_API_KEY: "sk-leak",
    VUAGENT_TOKEN: "secret-token",
    DB_PASSWORD: "hunter2",
    SOME_TOKEN: "leak",
    API_CREDENTIALS: "leak",
  };

  it("safe：白名单保留 PATH/HOME/LANG，密钥类键一律剥离", () => {
    const env = buildChildEnv("safe", sourceEnv);
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/user");
    expect(env.LANG).toBe("zh_CN.UTF-8");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.VUAGENT_TOKEN).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.SOME_TOKEN).toBeUndefined();
    expect(env.API_CREDENTIALS).toBeUndefined();
    expect(Object.keys(env)).not.toEqual(expect.arrayContaining([expect.stringMatching(/KEY|TOKEN|SECRET|PASSWORD/i)]));
  });

  it("safe：代理变量保留（基础设施非密钥——缺失会致受管代理下子进程网络命令全失败）", () => {
    const env = buildChildEnv("safe", {
      ...sourceEnv,
      HTTPS_PROXY: "http://proxy.corp:3128",
      NO_PROXY: "localhost,*.corp",
      https_proxy: "http://proxy.corp:3128",
    });
    expect(env.HTTPS_PROXY).toBe("http://proxy.corp:3128");
    expect(env.NO_PROXY).toBe("localhost,*.corp");
    expect(env.https_proxy).toBe("http://proxy.corp:3128");
  });

  it("strict：仅最小集（PATH/TMPDIR/SYSTEMROOT）", () => {
    const env = buildChildEnv("strict", { PATH: "/bin", HOME: "/home/user", TMPDIR: "/tmp" });
    expect(env.PATH).toBe("/bin");
    expect(env.TMPDIR).toBe("/tmp");
    expect(env.HOME).toBeUndefined();
    expect(env.HTTPS_PROXY).toBeUndefined(); // strict 不含代理（最小集口径不变）
  });

  it("inherit：完整继承（显式选择的风险口径）", () => {
    const env = buildChildEnv("inherit", sourceEnv);
    expect(env.OPENAI_API_KEY).toBe("sk-leak");
    expect(env.VUAGENT_TOKEN).toBe("secret-token");
  });

  it("键名匹配大小写不敏感（Windows 形态 path/token 同样纳入白名单/剥离）", () => {
    const env = buildChildEnv("safe", { path: "/bin", someToken: "leak", Token: "leak" });
    expect(env.path).toBe("/bin");
    expect(env.someToken).toBeUndefined();
    expect(env.Token).toBeUndefined();
  });
});

describe("bash_run 环境策略执行（TASK-088）", () => {
  beforeEach(() => {
    process.env.VUAGENT_TEST_SECRET_MARKER = "leak-marker-42";
  });
  afterEach(() => {
    delete process.env.VUAGENT_TEST_SECRET_MARKER;
    vi.restoreAllMocks();
  });

  function ctxOf(command: string): ToolExecutionContext<Record<string, unknown>> {
    return {
      toolCallId: "call-env",
      args: { command },
      workspace: {
        id: "w",
        name: "w",
        rootPath: process.cwd(),
        permission: "read-write",
        createdAt: 0,
        updatedAt: 0,
      },
      actionHub: new ActionHub(),
      abortSignal: new AbortController().signal,
    };
  }

  it("safe：printenv 读不到服务进程密钥变量", async () => {
    const tool = createBashRunTool(() => "safe");
    const res = (await tool.execute(ctxOf("printenv VUAGENT_TEST_SECRET_MARKER"))) as {
      stdout: string;
      exitCode: number;
    };
    expect(res.stdout).not.toContain("leak-marker-42");
  });

  it("inherit：printenv 可读（显式选择），验证机制本身有效", async () => {
    const tool = createBashRunTool(() => "inherit");
    const res = (await tool.execute(ctxOf("printenv VUAGENT_TEST_SECRET_MARKER"))) as {
      stdout: string;
    };
    expect(res.stdout).toContain("leak-marker-42");
  });
});
