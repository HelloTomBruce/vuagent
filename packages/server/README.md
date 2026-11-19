# @vuagent/server

Vuagent Agent Harness 服务端：ReAct 循环、HITL 审批中断、工具沙箱、会话检查点、渐进式 SSE 流与遥测。

## 快速开始

```bash
pnpm --filter @vuagent/server dev        # tsx watch，默认 http://localhost:3001
PORT=3001 DB_PATH=.vuagent/harness.db pnpm start
```

## 安全模型（TASK-011）

**定位：默认形态是「本地单用户开发工具」，不是多租户服务。** 服务端具备执行任意本地命令的能力（bash 工具 + 工作区 rootPath），因此默认配置把信任边界收紧到本机；生产/远端部署需显式开启并自担风险（相关能力另立任务）。

### 威胁模型

恶意网页驱动 localhost 服务（跨站请求 / DNS rebinding）：`POST /api/workspaces` 携带任意 `rootPath` → 会话 `permission:"auto"` → `bash_run` 任意命令，形成 RCE 链。同机其他端口上被攻陷的开发服务同样属于此威胁面。

### 默认边界（零配置即安全）

| 防线 | 行为 |
| --- | --- |
| CORS / Origin 白名单 | 仅允许本地前端 Origin：`http://localhost:5173`、`http://localhost:4173`、`http://127.0.0.1:5173`、`http://127.0.0.1:4173`；其余 Origin 的请求被服务端直接 **403** 拒绝（不只是不下发 CORS 头）。无 `Origin` 头的请求（同源 / 非浏览器客户端）放行 |
| Bearer 鉴权 | 默认关闭（本地白名单已够用）；配置 `VUAGENT_TOKEN` 后 `/api/*` 全部要求 `Authorization: Bearer <token>`，**`/api/health` 免检**（存活探针，无敏感数据） |
| apiKey 脱敏 | `GET/POST/PATCH /api/settings/models` 的任何响应不包含明文 apiKey，只回显 `maskedApiKey`（`****` + 末 4 位）；明文仅存于服务端存储。PATCH 空 apiKey 或掩码值视为「保持原密钥」 |
| providerConfig 信任边界 | 默认拒绝前端携带 `providerConfig` / 含覆盖字段的 `modelOverride`（baseUrl/apiKey 等）的 `/api/chat` 请求（**403** + 明确文案），收窄 SSRF 面；`modelOverride: { id }` 仅允许切换**服务端已登记**的 profile |

### 环境变量

| 变量 | 作用 | 风险提示 |
| --- | --- | --- |
| `VUAGENT_TOKEN` | 启用 Bearer 鉴权；设置后 CORS 放开为任意 Origin，访问由令牌把守 | 令牌即本机执行权，请勿提交到仓库或日志 |
| `VUAGENT_ALLOW_BYO_PROVIDER` | 设为 `1`（或 `true`）开启「自备供应商」模式：放行前端携带 `providerConfig`/完整 `modelOverride` 的对话请求。**显式设置即锁定**对应的 `security.allowByoProvider` 配置项（`/api/config` 只读、PATCH 400） | 服务端将向**前端指定的任意 baseUrl** 发起请求并转发 apiKey，存在 SSRF 与凭据外带风险，仅在完全信任前端来源时开启 |
| `VUAGENT_ALLOW_PRIVATE_FETCH` | 设为 `1` 放行 `web_fetch` 访问私网/本机地址（默认拒绝，SSRF 防护）。**显式设置即锁定**对应的 `security.allowPrivateFetch` 配置项 | 开启后 web_fetch 可打内网服务，SSRF 面扩大；仅内网联调时开启 |
| `VUAGENT_CORS_ORIGINS` | 逗号分隔的白名单外追加 Origin（无需启用鉴权） | 只添加你完全控制的 Origin |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `DEFAULT_MODEL` | 服务端兜底模型凭据（未登记任何 profile 时使用） | — |

### 开启远端访问（显式行为）

```bash
# 方式一：令牌模式（推荐）。任意 Origin 可达，但必须携带令牌
VUAGENT_TOKEN=<强随机串> pnpm --filter @vuagent/server dev

# 方式二：仅扩大 Origin 白名单（不启用鉴权，仅限受控内网）
VUAGENT_CORS_ORIGINS=https://my-frontend.internal pnpm --filter @vuagent/server dev
```

前端令牌注入方式：`localStorage.setItem("vuagent_token", "<token>")`，或构建期注入 `VITE_VUAGENT_TOKEN`；Console API 客户端会自动携带 `Authorization` 头（含 SSE 流）。

**风险声明：** 本服务可执行任意本地命令、读写任意授予的工作区路径。开启远端访问等于把本机执行权暴露给令牌持有者；令牌经明文 HTTP 传输可被网络窃听，请勿在不可信网络中使用，生产部署需要 TLS + 完整多租户隔离（另立任务）。

### 与旧行为的差异（破坏性变更清单）

- `cors()` 全开 → 本地白名单（远端 Origin 请求 403）
- `GET /api/settings/models` 返回明文 `apiKey` → 改为 `maskedApiKey`
- `/api/chat` 接受任意 `providerConfig`/`modelOverride` → 默认 403，除非 BYO 开关或仅切换已登记 profile
- `PATCH /api/settings/models/:id` 传空 apiKey 会清空密钥 → 改为保留原密钥（如需轮换请传新明文）
- `PATCH /api/tools/:name` 接受任意 body 且只认 `enabled` → 现支持 `enabled`/`timeoutMs`/`requiresApproval`，**未知字段一律 400**（拼错的字段不再被静默忽略）

## 配置中心（TASK-024）

分层配置的唯一来源是 `core/config-schema.ts` 的 `CONFIG_SCHEMA`：服务端持有 schema（字段类型/默认值/min/max/options/风险等级/env 锁），前端设置页表驱动渲染，**新增配置项只需加 schema 条目，零组件改动**。

| 端点 | 说明 |
| --- | --- |
| `GET /api/config` | 返回 `{ namespaces: [{ id, title, description, fields, values, isDefault }] }`；`values` 是**生效值**（默认 ∪ 存储覆盖，含钳制/截断结果）；`fields[].locked` 表示该项当前被环境变量锁定（UI 据此只读） |
| `PATCH /api/config/:namespace` | 部分更新（少传的 key 不动）。严格校验：未知 key / 类型不符 / select 非法 / env 锁定 → **400**；number 越界钳制、text 超长截断后落库。返回落库后的生效值 |
| `POST /api/config/:namespace/reset` | 删除该命名空间的覆盖记录，恢复全默认 |

命名空间：

| id | 配置项 |
| --- | --- |
| `execution` | `maxSteps`、`approvalTimeoutMs`、`contextBudgetRatio`、`preserveRecentTurns`、`maxToolResultChars` |
| `security` | `defaultPermissionMode`（新建会话缺省档）、`allowPrivateFetch`、`allowByoProvider`（后两项可被 env 锁定） |
| `tools` | `bashTimeoutCeilingMs`（bash 命令超时的全局封顶） |
| `prompt` | `customInstructions`、`includeEnvironmentBlock`、`includePermissionBlock` |

**env 是部署级强制锁**：`envLock` 指向的环境变量一旦显式设置（无论值可否解析），该字段生效值由 env 决定、PATCH 一律 400；不可解析时 **fail-closed 回落字段默认**（管理员的拼写错误不会静默放行存储层配置）。清除环境变量后恢复「配置中心」口径。

配置无缓存、逐次读库——PATCH 后立刻生效：执行层下一轮、工具策略下一次调用、提示词下一轮组装即读取新值。

## 工具配置（TASK-019 / TASK-026）

| 端点 | 说明 |
| --- | --- |
| `GET /api/tools` | registry 元数据 ∪ 全局配置：`name/description/riskLevel/writesWorkspace/requiresApproval/enabled/timeoutMs/source`。`requiresApproval` 返回**生效值**（推导 ∪ 覆盖） |
| `PATCH /api/tools/:name` | body 支持 `{ enabled?, timeoutMs?, requiresApproval? }`，字段可组合；未知工具 404、未知字段/类型不符/`timeoutMs < 1000` → 400 |

语义要点：

- **缺记录 = 启用**，禁用即从模型可见的 function definitions 中移除；调用侧另有逐调用实时兜底（上下文里残留旧定义时返回结构化「已被禁用」错误）
- **`timeoutMs` 覆盖**：`bash_run` 生效命令超时 = `per-tool > 模型请求 > 默认 30s`，再按 `tools.bashTimeoutCeilingMs`（默认 60s）封顶；其他工具覆盖执行器 60s 超时上限
- **`requiresApproval` 覆盖是 deny-wins**：`true` 可为低风险工具追加审批；`false` **不会**放宽 `requiresApproval`/`riskLevel === "high"` 的既有推导——安全项只能升不能降
- API 的 `timeoutMs ≥ 1000` 下限是 UI 防呆；引擎层对仓库直写的覆盖接受 ≥1ms（有意分层）

## 架构导览

```
src/
├── index.ts                 # 入口（直跑时启动 HTTP 监听）
├── server.ts                # Hono 路由 + 组件装配（createHarnessServer）
├── security.ts              # 安全基线：Origin 白名单 / Bearer 鉴权 / apiKey 脱敏 / providerConfig 边界
├── core/
│   ├── agent-loop.ts        # ReAct 主循环（卡片/遥测/检查点）
│   ├── session-execution-hub.ts  # 会话后台执行 + SSE 重放订阅（与 HTTP 连接解耦）
│   ├── action-hub.ts        # HITL 挂起动作与审批恢复
│   ├── tool-registry.ts     # 工具注册中心（definitions 过滤 + 执行超时竞速）
│   ├── config-schema.ts     # CONFIG_SCHEMA：配置项唯一来源（前端表驱动渲染）
│   ├── config-resolver.ts   # 配置解析：读路径容错 / 写路径严格 / env 强制锁
│   ├── system-prompt.ts     # 系统提示组装（环境/权限/纪律块 + 自定义指令）
│   ├── permissions.ts       # 权限模式交集解析
│   ├── context-compactor.ts # 上下文裁剪与 token 统计
│   └── stream-orchestrator.ts    # SSE 事件格式化
├── adapters/                # 模型驱动（OpenAI 兼容 / Mock）
├── storage/                 # 领域实体 + 仓库（SQLite / Memory 驱动）
│   └── repositories/        # workspace/session/settings/tool-config/harness-config
└── tools/                   # 内置系统工具（fs 读写编辑 / bash / glob / grep）与 web 工具
```

## 测试

```bash
pnpm --filter @vuagent/server test   # vitest，含 tests/security.test.ts 安全基线回归
```
