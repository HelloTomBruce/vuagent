/**
 * web_search 工具（0.9.0 W2）：
 * - resolveSearchConfig：provider 选择 / key 缺失 → null（不注册）
 * - 工具契约：参数校验（空 query / max_results 钳制）/ 结果截断 / provider 错误传播
 * Provider 真实 API 不进 CI（fetch mock 覆盖两家响应形态）。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  BraveProvider,
  TavilyProvider,
  createWebSearchTool,
  resolveSearchConfig,
} from "../src/tools/web/search-tools.js";
import { ToolRegistry } from "../src/core/tool-registry.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("resolveSearchConfig", () => {
  it("两家 key 都缺失 → null（不注册工具）", () => {
    expect(resolveSearchConfig({})).toBeNull();
    expect(resolveSearchConfig({ TAVILY_API_KEY: "  " })).toBeNull();
  });

  it("缺省 provider=tavily：有 TAVILY_API_KEY → TavilyProvider", () => {
    const cfg = resolveSearchConfig({ TAVILY_API_KEY: "tvly-x" });
    expect(cfg?.provider.id).toBe("tavily");
  });

  it("VUAGENT_SEARCH_PROVIDER=brave：用 BRAVE_API_KEY，无则 null（不回落 tavily key）", () => {
    expect(resolveSearchConfig({ VUAGENT_SEARCH_PROVIDER: "brave", TAVILY_API_KEY: "k" })).toBeNull();
    const cfg = resolveSearchConfig({ VUAGENT_SEARCH_PROVIDER: "brave", BRAVE_API_KEY: "b" });
    expect(cfg?.provider.id).toBe("brave");
  });

  it("未知 provider 值回落 tavily（大小写不敏感）", () => {
    const cfg = resolveSearchConfig({ VUAGENT_SEARCH_PROVIDER: "Brave ", BRAVE_API_KEY: "b" });
    expect(cfg?.provider.id).toBe("brave");
    expect(resolveSearchConfig({ VUAGENT_SEARCH_PROVIDER: "bogus", TAVILY_API_KEY: "t" })?.provider.id).toBe("tavily");
  });
});

describe("TavilyProvider", () => {
  it("POST 请求体携带 key/query/max_results，结果统一为 {title,url,snippet}", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return new Response(
        JSON.stringify({
          results: [
            { title: "  A  B ", url: "https://a.example", content: "  x".repeat(300) },
            { title: "no-url", content: "c2" },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const hits = await new TavilyProvider("k").search("q", 5, { topic: "news" });
    expect(captured!.url).toBe("https://api.tavily.com/search");
    const body = JSON.parse(String(captured!.init.body));
    expect(body.api_key).toBe("k");
    expect(body.query).toBe("q");
    expect(body.max_results).toBe(5);
    expect(body.topic).toBe("news");
    expect(hits[0].title).toBe("A B");
    expect(hits[0].snippet.endsWith("…")).toBe(true); // 截断
    expect(hits[1].url).toBe("");
  });

  it("非 2xx 抛错并带 status", async () => {
    globalThis.fetch = (async () => new Response("bad key", { status: 401 })) as typeof fetch;
    await expect(new TavilyProvider("k").search("q", 5)).rejects.toThrow(/401/);
  });
});

describe("BraveProvider", () => {
  it("GET 请求带 X-Subscription-Token 与 count，读 web.results", async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), init: init! };
      return new Response(
        JSON.stringify({
          web: { results: [{ title: "B", url: "https://b.example", description: "desc" }] },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const hits = await new BraveProvider("bk").search("q", 3, { timeRange: "week" });
    expect(captured!.url).toContain("https://api.search.brave.com/res/v1/web/search");
    expect(captured!.url).toContain("count=3");
    expect(captured!.url).toContain("freshness=week");
    expect((captured!.init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("bk");
    expect(hits[0]).toEqual({ title: "B", url: "https://b.example", snippet: "desc" });
  });
});

describe("web_search 工具契约", () => {
  it("registry 校验：query 缺失被参数闸门拦截（TypeBox required）", async () => {
    const tool = createWebSearchTool(new TavilyProvider("k"));
    const registry = new ToolRegistry().register(tool);
    const gate = registry.validateParams("web_search", {});
    expect(gate.ok).toBe(false);
  });

  it("执行：max_results 钳制到 1-10，provider 错误如实上抛（registry.execute 兜底捕获）", async () => {
    let receivedMax = 0;
    const tool = createWebSearchTool({
      id: "tavily",
      search: async (_q: string, m: number) => {
        receivedMax = m;
        throw new Error("boom");
      },
    });
    await expect(
      tool.execute({ toolCallId: "t1", args: { query: "q", max_results: 99 } } as never)
    ).rejects.toThrow("boom");
    expect(receivedMax).toBe(10); // 钳制
  });

  it("成功路径返回 query/provider/count/results", async () => {
    const tool = createWebSearchTool({
      id: "brave",
      search: async () => [{ title: "T", url: "https://x", snippet: "s" }],
    });
    const res = (await tool.execute({
      toolCallId: "t1",
      args: { query: "vue" },
    } as never)) as { query: string; provider: string; count: number; results: unknown[] };
    expect(res.query).toBe("vue");
    expect(res.provider).toBe("brave");
    expect(res.count).toBe(1);
    expect(res.results).toHaveLength(1);
  });
});
