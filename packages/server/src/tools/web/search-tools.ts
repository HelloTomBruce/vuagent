import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "../../core/types.js";

/**
 * web_search（0.9.0 W2）：为「不知道 URL」的实时信息场景补上搜索——web_fetch 的
 * 工具描述早已预留该语义（「如已配置」），本文件兑现它。
 *
 * 设计（docs/design/v0.9-plan.md §3）：
 * - Provider 策略（Strategy）：SearchProvider 统一 {title,url,snippet} 输出，v0.9
 *   内置 Tavily / Brave 两家（REST 直连，无 SDK 依赖）；
 * - key 只走 env（TAVILY_API_KEY / BRAVE_API_KEY）：配置中心的 text 字段会明文
 *   回显（secret 字段类型是 0.10 工程），key 不进库；
 * - 无 key = 不注册（server.ts 组装点判断）——工具不存在就不进启停页/模型
 *   definitions，比「注册 + hideTools」更诚实；
 * - 安全职责分离：搜索 API 是出站 HTTPS 到固定厂商域名（无用户可控 URL，无 SSRF
 *   面）；结果只回 snippet+URL，**不自动 fetch**——抓取一律走 web_fetch 的既有
 *   SSRF 防线，搜索结果不构成绕过通道。
 */

/** 单条搜索结果（统一两家差异后的形态） */
export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  readonly id: "tavily" | "brave";
  search(query: string, maxResults: number, opts?: { topic?: string; timeRange?: string }): Promise<WebSearchHit[]>;
}

/** 结果字符截断（与 web_fetch 的截断契约同风格：snippets 逐条封顶） */
const SNIPPET_MAX_CHARS = 400;
const SEARCH_TIMEOUT_MS = 15_000;

function clip(text: string | undefined, max = SNIPPET_MAX_CHARS): string {
  const s = (text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Tavily：POST https://api.tavily.com/search */
export class TavilyProvider implements SearchProvider {
  readonly id = "tavily" as const;
  constructor(private apiKey: string) {}

  async search(query: string, maxResults: number, opts?: { topic?: string; timeRange?: string }): Promise<WebSearchHit[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        ...(opts?.topic && opts.topic !== "general" ? { topic: opts.topic } : {}),
        ...(opts?.timeRange ? { time_range: opts.timeRange } : {}),
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Tavily API 返回错误 (${res.status}): ${clip(body, 200)}`);
    }
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results || []).map((r) => ({
      title: clip(r.title, 200),
      url: r.url || "",
      snippet: clip(r.content),
    }));
  }
}

/** Brave Search API：GET https://api.search.brave.com/res/v1/web/search */
export class BraveProvider implements SearchProvider {
  readonly id = "brave" as const;
  constructor(private apiKey: string) {}

  async search(query: string, maxResults: number, opts?: { timeRange?: string }): Promise<WebSearchHit[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));
    if (opts?.timeRange) url.searchParams.set("freshness", opts.timeRange);
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Brave API 返回错误 (${res.status}): ${clip(body, 200)}`);
    }
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results || []).map((r) => ({
      title: clip(r.title, 200),
      url: r.url || "",
      snippet: clip(r.description),
    }));
  }
}

/**
 * 解析搜索配置（纯函数，可单测）：provider 由 env VUAGENT_SEARCH_PROVIDER 选择
 * （缺省 tavily），key 按 provider 取对应 env。两家 key 都缺失 → null（调用方不注册工具）。
 * 配置中心的 provider 选择留待 secret 字段类型工程落地后一并收敛（0.10）。
 */
export function resolveSearchConfig(
  env: NodeJS.ProcessEnv = process.env
): { provider: SearchProvider } | null {
  const providerId = (env.VUAGENT_SEARCH_PROVIDER || "").trim().toLowerCase() === "brave" ? "brave" : "tavily";
  const tavilyKey = (env.TAVILY_API_KEY || "").trim();
  const braveKey = (env.BRAVE_API_KEY || "").trim();
  if (providerId === "tavily") {
    return tavilyKey ? { provider: new TavilyProvider(tavilyKey) } : null;
  }
  return braveKey ? { provider: new BraveProvider(braveKey) } : null;
}

const WebSearchParamsSchema = Type.Object({
  query: Type.String({ description: "搜索关键词（自然语言或关键词组合）" }),
  max_results: Type.Optional(
    Type.Number({ description: "返回条数上限（1-10，缺省 5）", minimum: 1, maximum: 10 })
  ),
  topic: Type.Optional(
    Type.String({ description: "内容类别：general（缺省）或 news（新闻/时效类）" })
  ),
  time_range: Type.Optional(
    Type.String({ description: "时间过滤：如 day / week / month / year（Brave 映射为 freshness）" })
  ),
});

export function createWebSearchTool(provider: SearchProvider): HarnessTool {
  return {
    name: "web_search",
    description: [
      "搜索公网 Web 并返回 {title, url, snippet} 列表（查文档 / 查 issue / 查依赖版本等「不知道 URL」的实时信息场景）。",
      "执行契约：",
      "- 只回标题、链接与摘要，**不抓取正文**——需要页面内容时对结果 URL 调用 web_fetch（其 SSRF 防线照常生效）。",
      "- snippet 已截断（每条 ≤400 字符）；引用搜索结论时务必给出对应 url。",
      "- 搜索服务不可用/超时（约 15s）返回错误信息，可重试或改用其他关键词。",
    ].join("\n"),
    parameters: WebSearchParamsSchema,
    riskLevel: "low",
    requiresApproval: false,
    writesWorkspace: false,
    execute: async (ctx) => {
      const query = String(ctx.args?.query || "").trim();
      if (!query) {
        return { isError: true, error: "query 不能为空" };
      }
      const maxResults = Math.min(10, Math.max(1, Number(ctx.args?.max_results) || 5));
      const topic = ctx.args?.topic ? String(ctx.args.topic) : undefined;
      const timeRange = ctx.args?.time_range ? String(ctx.args.time_range) : undefined;
      const hits = await provider.search(query, maxResults, { topic, timeRange });
      return {
        query,
        provider: provider.id,
        count: hits.length,
        results: hits,
      };
    },
  };
}
