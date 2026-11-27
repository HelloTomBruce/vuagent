# 内置供应商与请求头规则

端点、协议、鉴权形态、域名规则都由 `packages/protocol/src/providers.ts` 的**一张预设表**驱动：
新增供应商只改那一个文件，服务端默认端点与前端下拉自动跟上。

## 预置供应商

内置 **24 家**，覆盖国内常用与主流网关：

- **国内**：DeepSeek、通义千问/百炼（国内 + 国际站）、智谱 GLM、Moonshot/Kimi（国内 + 国际站）、
  MiniMax（Anthropic 兼容）、豆包/火山方舟、硅基流动
- **国际**：OpenAI、Anthropic、Google Gemini、Azure OpenAI、Groq、Mistral、xAI、
  Together、Fireworks、Cerebras、OpenRouter
- **网关/自建**：OpenCode Zen、Ollama、LM Studio、自定义（OpenAI 兼容）

> 端点、协议、鉴权形态、建议模型、上下文窗口的**唯一事实源**是
> `packages/protocol/src/providers.ts` 的预设表——本页刻意不再罗列逐家参数，避免手抄漂移。
> 想知道当前实例实际解析成什么：

```bash
vuagent doctor     # 每个供应商的解析端点 + 命中的域名规则
```

## 按域名自动注入的请求头

**不需要用户配置**：按 `baseUrl` 的域名匹配内置规则，命中即注入。

| 域名 | 注入 | 原因 |
|---|---|---|
| `opencode.ai`（含子域） | `x-opencode-session: <sessionId>` | 该网关按会话路由，缺头会命中错误的上游会话池 |
| `*.openai.azure.com`、`*.cognitiveservices.azure.com`、`*.ai.azure.com` | `api-key: <key>`（**接管**鉴权，不再发 `Authorization`） | Azure 不接受 Bearer |
| `openrouter.ai` | `HTTP-Referer`、`X-Title` | OpenRouter 按应用统计排行/限流 |

规则外的网关用 `custom` 预设。想确认某个端点命中了哪些规则：

```bash
vuagent doctor        # 打印每个供应商的解析后端点与命中的规则
```

## 归属头（User-Agent）

每个供应商请求都带 `vuagent/<version> (+https://github.com/HelloTomBruce/vuagent)`，
便于网关识别来源、也便于排障对账。部分中转网关按 UA 白名单/计费，可覆盖：

| 环境变量 | 作用 |
|---|---|
| `VUAGENT_USER_AGENT` | **整串覆盖**（如 `my-gateway/1.0`） |
| `VUAGENT_USER_AGENT_SUFFIX` | 在默认串后追加（如 `acme` → `vuagent/0.7.2 (+…) acme`） |

空字符串视为未设置。

## 合并顺序

```
协议默认头（Content-Type / anthropic-version）
  → 域名规则头（可能接管鉴权：Azure 的 api-key）
  → 归属头（user-agent，可被上面的环境变量覆盖）
  → traceparent（有出站链路时）
```
