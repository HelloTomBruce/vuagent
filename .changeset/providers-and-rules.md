---
"@vuagent/protocol": minor
"@vuagent/server": minor
"@vuagent/console": minor
---

供应商体系重做：内置清单从 6 家扩到 **24 家**，并按 **API 域名**自动注入厂商要求的请求头。

- **单一事实源**：供应商（端点 / 协议 / 鉴权形态 / 建议模型 / 上下文窗口）收敛到
  `protocol/providers.ts` 的一张预设表。此前这份知识散在三处（服务端 `provider-defaults.ts`、
  前端 `PROVIDER_OPTIONS`、`PROVIDER_PRESETS`），漂移的后果是「下拉里没有某家」或
  「选了它却预填到错的端点」。现在加供应商只改一处，服务端默认端点与前端下拉自动跟上。
- **新增内置**：智谱 GLM、Moonshot/Kimi（国内 + 国际）、MiniMax（Anthropic 兼容）、
  豆包/火山方舟、硅基流动、OpenRouter、OpenCode Zen、Azure OpenAI、Google Gemini、
  Groq、Mistral、xAI、Together、Fireworks、Cerebras、阿里云百炼国际站、LM Studio。
- **域名规则**（不开放用户自定义头，按端点域名自动匹配）：OpenCode Zen 注入
  `x-opencode-session`（会话路由）；Azure OpenAI 用 `api-key` **接管**鉴权（不再发
  `Authorization`）；OpenRouter 带来源头。规则外网关用 `custom` 预设。
- **归属头**：所有供应商请求带 `vuagent/<version> (+repo)`；可用 `VUAGENT_USER_AGENT`
  整串覆盖（部分网关按 UA 白名单放行）或 `VUAGENT_USER_AGENT_SUFFIX` 追加后缀。
- **诊断**：`vuagent doctor` 打印每个供应商的解析端点与命中/待上下文的规则。
