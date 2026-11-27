/**
 * 内置供应商预设表 —— 全仓唯一事实源。
 *
 * 此前这份知识散在三处且互相漂移：
 *  - `server/core/provider-defaults.ts`：kind → 默认 baseUrl；
 *  - `console/types.ts` 的 `PROVIDER_OPTIONS`（下拉）与 `PROVIDER_PRESETS`（新建模型预填）；
 *  - `adapters/*` 里内联的协议头判断。
 * 新增一个供应商要改三处、还容易漏（漏了就是「选了 A 却打到 B 端点」）。
 *
 * 现在：**加供应商 = 加一条 preset**。服务端据此决定默认端点与协议路由，前端据此渲染
 * 下拉与预填，域名规则（`endpoint-headers.ts`）据此匹配需要特殊请求头的端点。
 *
 * 参考实现：DSH 的 pi-ai 供应商目录（`providers/*.js` 的 id/name/baseUrl 口径），
 * 只保留「国内可直连 + 主流网关 + 常见自建」这些真正会被用到的，不做无脑堆砌。
 */

/** 协议族：决定走哪个 driver 与鉴权头形态 */
export type ProviderProtocol = "openai" | "anthropic" | "azure" | "gemini" | "native";

/** 鉴权头形态（由协议族与端点共同决定，域名规则可覆盖） */
export type AuthStyle = "bearer" | "x-api-key" | "api-key" | "none";

/**
 * 供应商 id 的**字面量联合**，与下面的预设表互为约束：
 * - 预设里写了元组里没有的 id → 编译报错；
 * - 元组里有 id 却没写预设 → `providers.test.ts` 断言失败。
 *
 * 为什么不用 `ProviderKind = string`（0.7.1 的写法）：一旦放宽成 string，
 * `Record<ProviderKind, T>` 会退化成 `Record<string, T>`，穷尽性检查全部失效，
 * 新增供应商时「迁移默认名是 undefined」这类 bug 编译期再也拦不住（评审 R1）。
 */
export const PROVIDER_PRESET_IDS = [
  "deepseek",
  "qwen",
  "anthropic",
  "openai",
  "zhipu",
  "moonshot",
  "minimax",
  "doubao",
  "openrouter",
  "opencode",
  "siliconflow",
  "ollama",
  "lmstudio",
  "azure-openai",
  "gemini",
  "groq",
  "mistral",
  "xai",
  "moonshot-global",
  "together",
  "fireworks",
  "cerebras",
  "bailian-intl",
  "custom",
] as const;

export type ProviderId = (typeof PROVIDER_PRESET_IDS)[number];

export interface ProviderPreset {
  /** 落库的 provider 值（= ProviderKind = ProviderId） */
  id: ProviderId;
  /** UI 显示名 */
  label: string;
  protocol: ProviderProtocol;
  /** 默认端点（用户可覆盖） */
  baseUrl: string;
  authStyle: AuthStyle;
  /** 建议的密钥环境变量名（doctor / 提示文案用） */
  keyEnv?: string;
  /** 端点主机名（用于域名规则匹配与「端点是否被改过」的提示） */
  domain?: string;
  /** 新建第一个模型时的预填值 */
  suggestedModel?: string;
  /** 预填的上下文窗口 */
  contextWindow?: number;
  /** 特殊说明（展示在供应商表单下方） */
  note?: string;
  docsUrl?: string;
  /** 是否参与下拉默认排序（false 者排在「更多」区） */
  featured?: boolean;
}

/**
 * 预设清单。顺序即下拉顺序：featured 在前（国内常用 + 主流），其余按需补充。
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek（官方）",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    authStyle: "bearer",
    keyEnv: "DEEPSEEK_API_KEY",
    domain: "api.deepseek.com",
    suggestedModel: "deepseek-chat",
    contextWindow: 128000,
    featured: true,
    docsUrl: "https://api-docs.deepseek.com",
  },
  {
    id: "qwen",
    label: "通义千问 / 阿里云百炼",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    authStyle: "bearer",
    keyEnv: "DASHSCOPE_API_KEY",
    domain: "dashscope.aliyuncs.com",
    suggestedModel: "qwen-plus",
    contextWindow: 128000,
    featured: true,
  },
  {
    id: "anthropic",
    label: "Anthropic（Claude）",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    authStyle: "x-api-key",
    keyEnv: "ANTHROPIC_API_KEY",
    domain: "api.anthropic.com",
    suggestedModel: "claude-sonnet-4-20250514",
    contextWindow: 200000,
    featured: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    authStyle: "bearer",
    keyEnv: "OPENAI_API_KEY",
    domain: "api.openai.com",
    suggestedModel: "gpt-4o",
    contextWindow: 128000,
    featured: true,
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    protocol: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    authStyle: "bearer",
    keyEnv: "ZHIPU_API_KEY",
    domain: "open.bigmodel.cn",
    suggestedModel: "glm-4-plus",
    contextWindow: 128000,
    featured: true,
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi（国内）",
    protocol: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    authStyle: "bearer",
    keyEnv: "MOONSHOT_API_KEY",
    domain: "api.moonshot.cn",
    suggestedModel: "moonshot-v1-8k",
    contextWindow: 128000,
    featured: true,
  },
  {
    id: "minimax",
    label: "MiniMax（Anthropic 兼容）",
    protocol: "anthropic",
    baseUrl: "https://api.minimaxi.com/anthropic",
    authStyle: "x-api-key",
    keyEnv: "MINIMAX_API_KEY",
    domain: "api.minimaxi.com",
    suggestedModel: "MiniMax-M2",
    contextWindow: 200000,
    note: "MiniMax 同时提供 OpenAI 兼容端点；此预设走其 Anthropic 兼容端点。",
    featured: true,
  },
  {
    id: "doubao",
    label: "豆包 / 火山方舟",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    authStyle: "bearer",
    keyEnv: "ARK_API_KEY",
    domain: "ark.cn-beijing.volces.com",
    suggestedModel: "doubao-pro-32k",
    contextWindow: 32000,
    note: "模型名需填「推理接入点 ID」（ep-xxxx）或已开通的模型名。",
    featured: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter（聚合网关）",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    authStyle: "bearer",
    keyEnv: "OPENROUTER_API_KEY",
    domain: "openrouter.ai",
    suggestedModel: "anthropic/claude-sonnet-4",
    contextWindow: 200000,
    featured: true,
    docsUrl: "https://openrouter.ai/docs",
  },
  {
    id: "opencode",
    label: "OpenCode Zen",
    protocol: "openai",
    baseUrl: "https://opencode.ai/inference/openai/v1",
    authStyle: "bearer",
    keyEnv: "OPENCODE_API_KEY",
    domain: "opencode.ai",
    suggestedModel: "claude-sonnet-4",
    contextWindow: 200000,
    note: "该网关按会话做路由：会自动附带 x-opencode-session 请求头（按域名规则注入）。",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    protocol: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    authStyle: "bearer",
    keyEnv: "SILICONFLOW_API_KEY",
    domain: "api.siliconflow.cn",
    suggestedModel: "deepseek-ai/DeepSeek-V3",
    contextWindow: 128000,
    featured: true,
  },
  {
    id: "ollama",
    label: "Ollama（本地）",
    protocol: "openai",
    baseUrl: "http://localhost:11434/v1",
    authStyle: "none",
    domain: "localhost",
    suggestedModel: "qwen2.5-coder:7b",
    contextWindow: 32000,
  },
  {
    id: "lmstudio",
    label: "LM Studio（本地）",
    protocol: "openai",
    baseUrl: "http://localhost:1234/v1",
    authStyle: "none",
    domain: "localhost",
    suggestedModel: "local-model",
    contextWindow: 32000,
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    protocol: "azure",
    baseUrl: "https://YOUR-RESOURCE.openai.azure.com/openai/v1",
    authStyle: "api-key",
    keyEnv: "AZURE_OPENAI_API_KEY",
    domain: "openai.azure.com",
    suggestedModel: "gpt-4o",
    contextWindow: 128000,
    note: "端点填你的资源域名；鉴权用 api-key 头（域名规则自动切换）。部署名需与模型一致。",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    authStyle: "bearer",
    keyEnv: "GEMINI_API_KEY",
    domain: "generativelanguage.googleapis.com",
    suggestedModel: "gemini-2.0-flash",
    contextWindow: 1000000,
    note: "走 Gemini 的 OpenAI 兼容层（/v1beta/openai）。",
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    authStyle: "bearer",
    keyEnv: "GROQ_API_KEY",
    domain: "api.groq.com",
    suggestedModel: "llama-3.3-70b-versatile",
    contextWindow: 128000,
  },
  {
    id: "mistral",
    label: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    authStyle: "bearer",
    keyEnv: "MISTRAL_API_KEY",
    domain: "api.mistral.ai",
    suggestedModel: "mistral-large-latest",
    contextWindow: 128000,
  },
  {
    id: "xai",
    label: "xAI Grok",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    authStyle: "bearer",
    keyEnv: "XAI_API_KEY",
    domain: "api.x.ai",
    suggestedModel: "grok-2-latest",
    contextWindow: 131072,
  },
  {
    id: "moonshot-global",
    label: "Moonshot AI（国际站）",
    protocol: "openai",
    baseUrl: "https://api.moonshot.ai/v1",
    authStyle: "bearer",
    keyEnv: "MOONSHOT_API_KEY",
    domain: "api.moonshot.ai",
    suggestedModel: "moonshot-v1-8k",
    contextWindow: 128000,
  },
  {
    id: "together",
    label: "Together AI",
    protocol: "openai",
    baseUrl: "https://api.together.ai/v1",
    authStyle: "bearer",
    keyEnv: "TOGETHER_API_KEY",
    domain: "api.together.ai",
    contextWindow: 128000,
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    protocol: "openai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    authStyle: "bearer",
    keyEnv: "FIREWORKS_API_KEY",
    domain: "api.fireworks.ai",
    contextWindow: 128000,
  },
  {
    id: "cerebras",
    label: "Cerebras",
    protocol: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    authStyle: "bearer",
    keyEnv: "CEREBRAS_API_KEY",
    domain: "api.cerebras.ai",
    contextWindow: 128000,
  },
  {
    id: "bailian-intl",
    label: "阿里云百炼（国际站）",
    protocol: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    authStyle: "bearer",
    keyEnv: "DASHSCOPE_API_KEY",
    domain: "dashscope-intl.aliyuncs.com",
    suggestedModel: "qwen-plus",
    contextWindow: 128000,
  },
  {
    id: "custom",
    label: "自定义（OpenAI 兼容）",
    protocol: "openai",
    baseUrl: "http://localhost:8000/v1",
    authStyle: "bearer",
    suggestedModel: "custom-model",
    contextWindow: 32000,
    note: "任何 OpenAI 兼容端点：自建 vLLM / Ollama / 中转网关都填这里。",
  },
];

/** id → 预设（未知 id 返回 undefined，调用方决定兜底） */
export const PROVIDER_PRESET_BY_ID: Readonly<Partial<Record<ProviderId, ProviderPreset>>> =
  Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p]));

/** 取预设；未知 id 回落 `custom`（绝不抛错：旧库可能存着已删除的供应商 id） */
export function providerPreset(id: string): ProviderPreset {
  // 入参可能是库里的历史 id 或 HTTP 来的任意字符串 → 索引前收窄到已知 id
  const known = (PROVIDER_PRESETS_IDS as readonly string[]).includes(id);
  const preset = known ? PROVIDER_PRESET_BY_ID[id as ProviderId] : undefined;
  return preset ?? (PROVIDER_PRESET_BY_ID.custom as ProviderPreset);
}

/** 全部供应商 id（运行时枚举，用于入参校验）；直接复用元组，避免第二份清单 */
export const PROVIDER_PRESETS_IDS: readonly ProviderId[] = PROVIDER_PRESET_IDS;
