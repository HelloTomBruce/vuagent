import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "../../core/types.js";

/** 抓取内容字符上限（对齐 DSH web_fetch 的截断契约） */
export const WEB_FETCH_MAX_CHARS = 50_000;
/** 响应体读取上限（字节）：先按字节封顶再截字符，防超大响应吃满内存 */
const WEB_FETCH_MAX_BYTES = 512 * 1024;

/**
 * SSRF 防护（纯函数，可单测）：仅放行 http(s) 的公网地址。
 * - 主机名黑名单：localhost / *.local / loopback IP（127.x/0.0.0.0/::1）
 * - IPv4 私网段：10/8、172.16-31、192.168/16、169.254 链路本地、0/8
 * - IPv6 常见私有前缀：fc/fd（ULA）、fe80（链路本地）
 * 已知限制：基于主机名的静态校验，不解析 DNS——公网域名解析到私网 IP 的
 * rebinding 不在此防线内（本地单用户工具的威胁模型见 security.ts）。
 *
 * 私网放行开关（TASK-026 接入配置中心）：
 * allowPrivate 由调用方解析——env VUAGENT_ALLOW_PRIVATE_FETCH 显式设置时为部署级
 * 强制锁（env 值直接生效）；未设置时走配置中心 security.allowPrivateFetch。
 * 缺省参数保留 env 直读行为（向后兼容旧调用方）。
 */
export function assertFetchableUrl(
  rawUrl: string,
  allowPrivate: boolean = process.env.VUAGENT_ALLOW_PRIVATE_FETCH === "1"
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`无效 URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`仅支持 http(s) 协议，收到 [${url.protocol}]`);
  }

  if (allowPrivate) return url;

  const host = url.hostname.toLowerCase();
  const isLocalhost =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "::1" ||
    host === "[::1]";
  let isPrivate = isLocalhost;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    isPrivate ||= a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  // IPv6 ULA（fc/fd）与链路本地（fe80）前缀
  if (/^f[cd]/.test(host) || host.startsWith("fe80")) isPrivate = true;

  if (isPrivate) {
    throw new Error(
      `[Security Violation] 拒绝访问私网/本机地址 [${host}]（SSRF 防护）。如确需访问内网服务，在「设置 → 安全」开启「允许抓取私网地址」，或以环境变量 VUAGENT_ALLOW_PRIVATE_FETCH=1 启动服务（部署级强制锁）`
    );
  }
  return url;
}

/**
 * 构造 web_fetch 工具（TASK-026 工厂化）。
 * resolveAllowPrivate：每次执行时解析「是否放行私网」——生产装配从配置中心
 * security.allowPrivateFetch 取值（env 锁定由 resolver 内处理），运行中改档即时生效；
 * 缺省回落 env 直读（向后兼容旧装配方式）。
 */
export function createWebFetchTool(
  resolveAllowPrivate: () => boolean | Promise<boolean> = () =>
    process.env.VUAGENT_ALLOW_PRIVATE_FETCH === "1"
): HarnessTool {
  return {
    name: "web_fetch",
    description: [
      "抓取一个公网 http(s) URL 并把内容解码为文本返回（读取网页/接口响应用）。",
      "执行契约：",
      "- 仅支持 http(s)；默认拒绝私网/本机地址（SSRF 防护），内网联调需在设置中开启「允许抓取私网地址」或设 VUAGENT_ALLOW_PRIVATE_FETCH=1。",
      "- 返回 { url, status, contentType, truncated, content }；content 为响应体文本（HTML 不做解析，原样返回），超 50000 字符截断（truncated=true），并按 512KB 字节上限提前封顶。",
      "- 非 2xx 响应不抛异常，返回真实 status 与响应体（错误页也是信息）；网络不可达/超时（默认跟随重定向，连接层超时约 30s）返回错误信息。",
      "- 需要实时信息请配合 web_search（如已配置）；本工具只抓取给定 URL，不做内容抽取或摘要。",
    ].join("\n"),
    parameters: Type.Object({
      url: Type.String({ description: "要抓取的完整 http(s) URL（含协议）" }),
    }),
    riskLevel: "medium",
    requiresApproval: false,
    writesWorkspace: false,
    execute: async (ctx) => {
      const rawUrl = String(ctx.args.url || "").trim();
      const url = assertFetchableUrl(rawUrl, await resolveAllowPrivate());

    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "vuagent-web-fetch/0.1 (+local-harness)" },
    });

    const contentType = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.subarray(0, WEB_FETCH_MAX_BYTES).toString("utf-8");
    const byteTruncated = buf.length > WEB_FETCH_MAX_BYTES;
    const truncated = byteTruncated || text.length > WEB_FETCH_MAX_CHARS;

    return {
      url: res.url || url.href,
      status: res.status,
      contentType,
      truncated,
      content: text.slice(0, WEB_FETCH_MAX_CHARS),
    };
    },
  };
}

/**
 * 兼容导出：env 直读装配（旧行为）。server.ts 生产装配改用
 * createWebFetchTool(configResolver 解析) 以获得运行中生效的配置中心口径。
 */
export const WebFetchTool: HarnessTool = createWebFetchTool();
