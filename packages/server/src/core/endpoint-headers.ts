/**
 * 按 **API 域名** 匹配的请求头规则（0.7.2）。
 *
 * 有些供应商不接受"标准 OpenAI/Anthropic 头"，必须在请求上补特定字段：
 *  - OpenCode Zen 按会话路由，要 `x-opencode-session: <sessionId>`；
 *  - Azure OpenAI 用 `api-key` 而非 `Authorization: Bearer`。
 *
 * 设计取舍（与用户确认）：**不开放用户自定义请求头**，而是内置规则表按端点域名自动
 * 匹配——用户只填 baseUrl 与密钥，规则由实现负责；想接规则外的网关就用 `custom` 预设。
 *
 * 参考实现：DSH 的做法是「配置层 `headers` 字典 + 每请求 `prepareHeaders` 钩子 +
 * 内置 provider 的 streams 包装（opencode 注入会话头）+ 归属头最后写入并胜出」。
 * 我们没有插件体系，把「动态算头」这段表达成模板占位符（`{{sessionId}}` 等），
 * 语义等价但不需要为每个供应商写代码。
 */
import { PRODUCT_UA, REPO_URL } from "./attribution.js";

/** 规则求值上下文（每请求一次） */
export interface EndpointRuleContext {
  baseUrl: string;
  /** 客户端协议族（openai / anthropic / azure / gemini） */
  protocol: string;
  apiKey?: string;
  sessionId?: string;
  turnId?: string;
  model?: string;
}

export interface EndpointHeaderRule {
  id: string;
  /** 人类可读名（doctor / 日志 / 测试断言用） */
  label: string;
  /** 域名匹配：精确或后缀（`openai.azure.com` 命中 `foo.openai.azure.com`） */
  domains: readonly string[];
  /** 该规则是否需要 ApiKey（Azure 规则要，缺 key 时跳过以免发出残缺请求） */
  requiresApiKey?: boolean;
  /** 缺上下文时的说明（doctor 里解释"域名命中但没注入"的原因） */
  requiresContext?: string;
  /** 生成请求头；返回空对象表示本次无需注入 */
  headers: (ctx: EndpointRuleContext) => Record<string, string>;
  /** 是否由规则接管鉴权头（接管后不再发 Authorization/x-api-key） */
  ownsAuth?: boolean;
  /** 附加说明（命中时写进启动日志/doctor，用户看得懂为什么多加了这个头） */
  note?: string;
}

/** 域名匹配：精确相等，或 host 以 `.domain` 结尾（子域） */
function hostMatches(host: string, domains: readonly string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 内置规则表。新增规则 = 加一条；不要在 driver 里写 if(host === ...)。
 */
export const ENDPOINT_HEADER_RULES: readonly EndpointHeaderRule[] = [
  {
    id: "opencode-session",
    label: "OpenCode Zen 会话路由头",
    domains: ["opencode.ai"],
    requiresContext: "需要会话上下文（请求时自动带上）",
    headers: (ctx): Record<string, string> =>
      ctx.sessionId ? { "x-opencode-session": ctx.sessionId } : {},
    note: "OpenCode Zen 按会话做路由，缺该头会命中错误的上游会话池。",
  },
  {
    id: "azure-api-key",
    label: "Azure OpenAI 鉴权头",
    domains: ["openai.azure.com", "cognitiveservices.azure.com", "ai.azure.com"],
    requiresApiKey: true,
    requiresContext: "需要供应商密钥",
    ownsAuth: true,
    headers: (ctx): Record<string, string> =>
      ctx.apiKey ? { "api-key": ctx.apiKey } : {},
    note: "Azure 用 api-key 头鉴权（不接受 Bearer）；api-version 见端点路径。",
  },
  {
    id: "openrouter-attribution",
    label: "OpenRouter 来源标识",
    domains: ["openrouter.ai"],
    headers: (): Record<string, string> => ({
      // OpenRouter 用这两个头做应用排行/限流统计，官方文档建议带上
      "HTTP-Referer": REPO_URL,
      "X-Title": "vuagent",
    }),
    note: "OpenRouter 建议带上来源头（排行与限流按应用统计）。",
  },
];

/** 解析结果：注入的头 + 命中的规则（便于日志/诊断，不含密钥） */
export interface ResolvedEndpointHeaders {
  headers: Record<string, string>;
  /** 域名命中且已注入的规则 */
  ruleIds: string[];
  /** 域名命中但因缺上下文未注入的规则（doctor / 诊断用） */
  skippedRuleIds: string[];
  /** 规则是否接管了鉴权头（driver 据此跳过默认鉴权头） */
  ownsAuth: boolean;
  /** 命中规则的人类可读说明 */
  notes: string[];
}

/**
 * 解析该请求应注入的头。
 * 只做「规则 → headers」的加法；与协议默认头、归属头的**合并顺序**由 driver 统一处理：
 *   协议默认头 → 规则头（可接管鉴权）→ 归属头（user-agent，用户可用环境变量覆盖）
 */
export function resolveEndpointHeaders(ctx: EndpointRuleContext): ResolvedEndpointHeaders {
  const host = hostOf(ctx.baseUrl);
  const out: ResolvedEndpointHeaders = { headers: {}, ruleIds: [], skippedRuleIds: [], ownsAuth: false, notes: [] };
  if (!host) return out;

  for (const rule of ENDPOINT_HEADER_RULES) {
    if (!hostMatches(host, rule.domains)) continue;
    if (rule.requiresApiKey && !ctx.apiKey) {
      out.skippedRuleIds.push(rule.id);
      continue;
    }
    const headers = rule.headers(ctx);
    if (Object.keys(headers).length === 0) {
      // 域名命中但本次无可用上下文（如 opencode 缺 sessionId）
      out.skippedRuleIds.push(rule.id);
      continue;
    }
    Object.assign(out.headers, headers);
    out.ruleIds.push(rule.id);
    if (rule.ownsAuth) out.ownsAuth = true;
    if (rule.note) out.notes.push(rule.note);
  }
  return out;
}

/**
 * 归属头：每个出站模型请求都带，标明"是谁发的"。
 *
 * 与 DSH 的差异：DSH 让归属头**压倒一切**；我们按用户决定允许覆盖——不少中转网关
 * 按 User-Agent 白名单/计费，硬性是会挡路的。覆盖方式：
 *   - `VUAGENT_USER_AGENT=xxx`        整串覆盖；
 *   - `VUAGENT_USER_AGENT_SUFFIX=xxx` 在默认串后追加产品后缀。
 */
export function attributionHeadersForRequest(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const full = (env.VUAGENT_USER_AGENT || "").trim();
  const suffix = (env.VUAGENT_USER_AGENT_SUFFIX || "").trim();
  const candidate = full || (suffix ? `${PRODUCT_UA} ${suffix}` : PRODUCT_UA);

  // header 值必须能通过 Fetch 校验：含换行/控制字符时 fetch 会抛 TypeError，
  // 用户只会看到"请求失败"。这里提前拦下并回落默认值，同时说清是哪一项配错了。
  try {
    new Headers([["user-agent", candidate]]);
  } catch {
    const which = full ? "VUAGENT_USER_AGENT" : "VUAGENT_USER_AGENT_SUFFIX";
    console.warn(`[vuagent] ${which} 不是合法的 User-Agent 值（含换行或控制字符），已回落默认值`);
    return { "user-agent": PRODUCT_UA };
  }
  return { "user-agent": candidate };
}
