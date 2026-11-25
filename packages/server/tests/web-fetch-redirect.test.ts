/**
 * TASK-087：web_fetch 重定向逐跳 SSRF 校验 + /api/* 全局 bodyLimit
 *
 * 1. redirect:"manual" 手动逐跳跟进——公网 URL 302 → 私网 IP 在第二跳被
 *    assertFetchableUrl 拦截（此前 redirect:"follow" 只校验首跳，可被 302 穿透）；
 * 2. 跳数封顶 3（拒绝无界跳转链）；Location 相对路径以当前 URL 为 base 解析；
 * 3. /api/* 非 chat 路由 1MB 请求体上限（/api/chat 跳过，仍走 32MB 专属上限）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebFetchTool, WEB_FETCH_MAX_REDIRECTS } from "../src/tools/web/web-tools.js";
import { createHarnessServer } from "../src/server.js";
import type { ToolExecutionContext } from "../src/core/types.js";
import { ActionHub } from "../src/core/action-hub.js";

const LOCAL_ORIGIN = "http://localhost:5173";
const H = { "Content-Type": "application/json", Origin: LOCAL_ORIGIN };

function ctxOf(args: Record<string, unknown>): ToolExecutionContext<Record<string, unknown>> {
  return {
    toolCallId: "call-redirect-test",
    args,
    workspace: {
      id: "w",
      name: "w",
      rootPath: "/tmp",
      permission: "read-write",
      createdAt: 0,
      updatedAt: 0,
    },
    actionHub: new ActionHub(),
    abortSignal: new AbortController().signal,
  };
}

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { location } });

/** URL → 响应 的脚本化 stub fetch，并记录每次请求的 URL */
function scriptFetch(routes: (url: string) => Response) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input instanceof URL ? input.href : input);
    calls.push(url);
    return routes(url);
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

describe("web_fetch 重定向逐跳 SSRF 校验（TASK-087）", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("公网 URL 302 → 私网 IP：第二跳被拒（fetch 只发生一次，错误含私网主机）", async () => {
    const tool = createWebFetchTool(() => false);
    const calls = scriptFetch(() => redirect("http://10.0.0.5/secret"));
    await expect(tool.execute(ctxOf({ url: "https://public.example.com/a" }))).rejects.toThrow(
      /SSRF|10\.0\.0\.5/
    );
    expect(calls).toHaveLength(1); // 第二跳在 fetch 之前被闸门拦截
  });

  it("公网链内 302（含相对 Location）逐跳复检后取到终态内容", async () => {
    const tool = createWebFetchTool(() => false);
    const calls = scriptFetch((url) => {
      if (url === "https://public.example.com/a") return redirect("/b");
      if (url === "https://public.example.com/b") return redirect("https://public.example.com/c");
      return new Response("final-content", { status: 200, headers: { "content-type": "text/plain" } });
    });
    const res = (await tool.execute(ctxOf({ url: "https://public.example.com/a" }))) as Record<
      string,
      unknown
    >;
    expect(res.status).toBe(200);
    expect(res.content).toBe("final-content");
    expect(res.url).toBe("https://public.example.com/c");
    expect(calls).toEqual([
      "https://public.example.com/a",
      "https://public.example.com/b", // 相对 Location 以当前 URL 为 base 解析
      "https://public.example.com/c",
    ]);
  });

  it(`跳数超过 ${WEB_FETCH_MAX_REDIRECTS} 上限拒绝（无界跳转链）`, async () => {
    const tool = createWebFetchTool(() => false);
    const calls = scriptFetch((url) =>
      redirect(`https://public.example.com/next-${url.length}-${Math.random()}`)
    );
    await expect(tool.execute(ctxOf({ url: "https://public.example.com/a" }))).rejects.toThrow(
      /跳数超过/
    );
    // 首跳 + 3 次跟进 = 4 次 fetch，第 4 个 3xx 在跟进前被跳数闸门拦下
    expect(calls).toHaveLength(WEB_FETCH_MAX_REDIRECTS + 1);
  });

  it("allowPrivate=true 时重定向到私网同样放行（部署级开关贯穿每一跳）", async () => {
    const tool = createWebFetchTool(() => true);
    scriptFetch((url) =>
      url === "https://public.example.com/a"
        ? redirect("http://127.0.0.1:45161/inner")
        : new Response("internal-ok", { status: 200 })
    );
    const res = (await tool.execute(ctxOf({ url: "https://public.example.com/a" }))) as Record<
      string,
      unknown
    >;
    expect(res.content).toBe("internal-ok");
  });

  it("首跳非法 URL 在 fetch 前拒绝；非 3xx（如 404）原样返回不误判为重定向", async () => {
    const tool = createWebFetchTool(() => false);
    scriptFetch(() => new Response("nope", { status: 404 }));
    const res = (await tool.execute(ctxOf({ url: "https://public.example.com/missing" }))) as Record<
      string,
      unknown
    >;
    expect(res.status).toBe(404);
    await expect(
      tool.execute(ctxOf({ url: "http://127.0.0.1:9/direct" }))
    ).rejects.toThrow(/SSRF/);
  });

  // IPv4-mapped IPv6 绕过面（审查 Required 修复回归锚点）：WHATWG URL 把
  // [::ffff:127.0.0.1] 的 hostname 归一为 [::ffff:7f00:1]——既非 "::1" 也不匹配
  // v4 正则，旧判定全放行；现先解出内嵌 v4 再走统一私网判定
  it.each([
    ["http://[::ffff:127.0.0.1]:9/mapped", "[::ffff:7f00:1]"],
    ["http://[::ffff:10.0.0.5]:9/internal", "[::ffff:a00:5]"],
    ["http://[::ffff:c0a8:1]:9/hex", "[::ffff:c0a8:1]"],
  ])("IPv4-mapped IPv6 私网地址首跳即拒：%s", async (url) => {
    const tool = createWebFetchTool(() => false);
    const calls = scriptFetch(() => new Response("should-not-run", { status: 200 }));
    await expect(tool.execute(ctxOf({ url }))).rejects.toThrow(/SSRF/);
    expect(calls).toHaveLength(0); // fetch 前拦截
  });

  it("IPv4-mapped IPv6 重定向跳同样拦截（逐跳复检同源生效）", async () => {
    const tool = createWebFetchTool(() => false);
    scriptFetch((url) =>
      url === "https://public.example.com/jump" ? redirect("http://[::ffff:192.168.1.1]:9/x") : new Response("ok", { status: 200 })
    );
    await expect(
      tool.execute(ctxOf({ url: "https://public.example.com/jump" }))
    ).rejects.toThrow(/SSRF/);
  });

  it("纯 IPv6 与公网 v4-mapped 形态不受影响（无过度拦截）", async () => {
    const tool = createWebFetchTool(() => false);
    scriptFetch((url) => (url.startsWith("https://public") ? new Response("fine", { status: 200 }) : new Response("no", { status: 500 })));
    const res = (await tool.execute(ctxOf({ url: "https://public.example.com/ok" }))) as Record<string, unknown>;
    expect(res.status).toBe(200);
    // 公网映射形态（::ffff:8.8.8.8）放行：fetch 正常执行并返回真实非 2xx（500）——
    // 工具契约「非 2xx 不抛异常」，放行 ≠ 抛错
    const mapped = (await tool.execute(ctxOf({ url: "http://[::ffff:8.8.8.8]:9/public-dns" }))) as Record<string, unknown>;
    expect(mapped.status).toBe(500);
  });
});

describe("/api/* 全局 bodyLimit（TASK-087）", () => {
  it("非 chat 路由超 1MB → 413 + PAYLOAD_TOO_LARGE", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const huge = JSON.stringify({ name: "x", rootPath: "/tmp/x", blob: "y".repeat(2 * 1024 * 1024) });
    const res = await app.request("/api/workspaces", { method: "POST", headers: H, body: huge });
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
    expect(json.error).toContain("1MB");
  });

  it("/api/chat 不受 1MB 全局限额影响（2MB 载荷直达业务层而非 413）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const body = JSON.stringify({ prompt: "x".repeat(2 * 1024 * 1024) });
    const res = await app.request("/api/chat", { method: "POST", headers: H, body });
    expect(res.status).not.toBe(413);
  });

  it("上限之内实体请求正常到达路由（1MB 下富余）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/workspaces", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: "small", rootPath: "/tmp/small" }),
    });
    expect(res.status).toBe(201);
  });

  // 审查 Required 修复回归锚点：bodyLimit 注册顺序提前前，这两条 PATCH 路由
  // 因「后注册中间件不包裹先注册 handler」静默绕过 1MB 上限（2MB 全量进内存
  // 后才被字段校验 400 拒绝）
  it.each(["/api/tools/fs_read", "/api/config/execution"])("PATCH %s 超 1MB → 413（注册顺序覆盖面）", async (path) => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const huge = JSON.stringify({ blob: "y".repeat(2 * 1024 * 1024) });
    const res = await app.request(path, { method: "PATCH", headers: H, body: huge });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("/api/chat 32MB 上限生效：33MB → 413（专属上限未被全局跳过逻辑吞掉）", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const body = JSON.stringify({ prompt: "x".repeat(33 * 1024 * 1024) });
    const res = await app.request("/api/chat", { method: "POST", headers: H, body });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("PAYLOAD_TOO_LARGE");
  });
});
