# @vuagent/console

## 0.8.0

### Minor Changes

- 180d4bf: 供应商体系重做：内置清单从 6 家扩到 **24 家**，并按 **API 域名**自动注入厂商要求的请求头。
  
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

### Patch Changes

- 5cc76ab: 新建供应商时可直接「添加模型」，不必先点「创建供应商」：面板在「新建中」态放行模型表单，
  点「添加模型」会先落库供应商（名称/类型/端点/密钥），再进入添加模型流程；
  空表单提交有明确校验提示（「请填写模型名称与模型标识」）。空供应商态的引导文案同步更新。
- eb3bc5a: 修复「点新建工作区却让我手打路径」的两个根因：
  
  1. **取消被当成失败**：原生框点取消时 osascript 以 `用户已取消 (-128)` 非零退出，旧实现一律回 500，前端于是「降级」成手动输入路径。现在接口区分三态——`200 {cancelled:true}`（静默）、`201 workspace`（选中）、`503 PICKER_UNAVAILABLE`（带可执行 hint：装 zenity / 从图形终端启动）、`409 PICKER_BUSY`（已有一个框在等，不叠框）；原生框改用 execFile 传参（免 shell 引号问题）并有 10 分钟上限。
  2. **自托管 console 的写请求全部 403**（更严重）：Origin 白名单只有 dev 端口（5173/4173/6991/6995），而 CLI 把 console 托管在 `127.0.0.1:6880`，浏览器对 POST/PATCH/DELETE 会带 `Origin: http://127.0.0.1:6880` → 新建工作区/新建会话/发消息/审批全部被拒（GET 无 Origin 所以列表能看，容易误判「后端正常」）。现在放行「Origin 的 host == 请求 Host 且为回环地址」的同源请求；DNS rebinding 仍被挡（攻击者域名重绑时 Host/Origin 同为该域名，非回环）。

## 0.7.1

### Patch Changes

- 938186f: 修复 0.7.0 生产 console 样式崩坏：结构抽取后 `apps/console` 薄壳只调 `mountConsole()`，漏了 `@vuagent/ui/tokens.css` 与 `shell.css` 的引入——发布产物里没有 `--va-*` 设计令牌（全部样式留白）、`body` 带 8px 默认外边距、`html/body/#app` 满高链断裂（控制台被压成半屏）。
  
  修法：把令牌与页面基础样式的引入下沉到 `@vuagent/console-app` 入口，任何宿主（生产壳 / 开发壳 / 第三方）import 即自动带上，杜绝「某个壳忘了引」的漂移。同时给 `scripts/check-pack.mjs` 增加**产物样式自足性**门禁：console 包必须自带 `--va-bg` / `--va-ink` 令牌、`.va-console` 组件样式与满高布局，否则发布前直接失败（这类缺陷此前能一路发到 npm）。

## 0.7.0

### Minor Changes

- e9353b9: Console 结构抽取（T16）：`@vuagent/console` 的生产产物改由新的 `apps/console` 薄壳产出（一句 `mountConsole` 挂载），源码库 `@vuagent/console-app`（私有）由生产壳与开发壳 `apps/playground` 共用——「开发看到什么 = 生产看到什么」。产物仍为纯静态包（`dist/index.html` + assets、零运行时依赖），`@vuagent/cli` 的包内解析路径不变。
- d484f41: CLI 与 Console 首发：`npm i -g @vuagent/cli` 后 `vuagent` 一条命令起 harness 服务 + console（同端口同源）。数据目录规范：默认 `~/.vuagent`（`--data-dir` / `VUAGENT_HOME` 可覆盖，`--db` 只覆盖库文件），`vuagent paths` 打印每条路径及来源；同一数据目录第二实例默认拒绝（退出码 3）；`--port 0` 随机端口、`--workspace` 免选目录、`--no-open` / CI 下自动不开浏览器；优雅停机先关库后删锁。
