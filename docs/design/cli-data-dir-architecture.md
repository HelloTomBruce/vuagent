# CLI 启动形态与数据目录规范（设计与实施方案）

> 状态：**设计待评审**（未开工）。目标版本：`@vuagent/cli` 0.7.0 首个可用形态。
> 已拍板的三条默认（本轮决策，后续实现以此为准）：
> 1. 默认数据目录 **`~/.vuagent`**（Windows 用 `%LOCALAPPDATA%\vuagent`），**不**默认走 XDG；
> 2. 同一数据目录的第二个实例 **默认拒绝启动**（不是警告放行）；
> 3. 轮次数据 **全部保留**（不做默认 retention），清理只能是用户显式动作。
>
> 一句话目标：`npm i -g @vuagent/cli` 之后，`vuagent` 一条命令起「harness 服务 + console 页面」，状态落在一个**可预测、可备份、可迁移**的用户级目录里。

## 1. 目标与非目标

**目标**

- 单进程、单端口（默认 `127.0.0.1:6880`）同时提供 `/api/*` 与 console 静态页面，同源因此不需要 CORS/代理；
- 数据位置**显式可打印**：`vuagent paths` 给出每个路径及其来源（flag / env / default）；
- 数据目录**单一根**，与 CWD 彻底解耦（今天 `pnpm --filter @vuagent/server dev` 会把库写进 `packages/server/.vuagent/`）；
- 单实例语义：第二次启动直接被拒绝，并给出「复用现有实例 / 换目录 / 清残留锁」三条出路；
- 备份/导出/迁移/体检是 CLI 的一等命令，而不是用户自己 `cp` 数据库。

**非目标（本轮明确不做）**

- 后台守护进程化（`--daemon` / launchd / systemd 自动安装）——先用前台 + 文档给 tmux/pm2/launchd 片段；
- 自动迁移用户已有的散落数据库（只探测 + 提示 `vuagent migrate`）；
- 多用户/共享盘形态（SQLite 放 NFS/SMB 明确不支持；企业形态继续走 Redis，见 §9）；
- 端到端加密、审计日志落盘（P3 之后再议）。

## 2. 现状与问题（实测证据）

| 事实 | 证据 |
|---|---|
| 默认库路径相对 **CWD** | [index.ts](../../packages/server/src/index.ts#L43-L44)：`process.env.DB_PATH \|\| ".vuagent/harness.db"` |
| 库形态的**默认值是内存库** | [server.ts](../../packages/server/src/server.ts#L436-L442)：`dbPath` 缺省 `:memory:`（库被当嵌入件用，CLI 必须显式传） |
| 计价表也相对 CWD | [pricing-table.ts](../../packages/server/src/core/pricing-table.ts#L23)：缺省 `${cwd}/config/model-pricing.json` |
| **双库漂移已发生** | 仓库根 `.vuagent/harness.db` 16 KB（空库）；真正在用的是 `packages/server/.vuagent/harness.db` **112 MB + 9 MB WAL**（5 会话 / 31 turn / 82 条成本；`session_turns` 单集合 43 MB）——因为 `pnpm --filter … dev` 的 CWD 是 `packages/server` |
| WAL 膨胀可观 | 对上面那份库 `PRAGMA wal_checkpoint(TRUNCATE)` + `VACUUM INTO` 实测：**121 MB → 51.6 MB** |
| 文档与代码的 env 名不一致 | [deployment.md](../../apps/docs/server/deployment.md#L32-L52) 写 `SQLITE_DB_PATH / STORAGE_DRIVER / AUTH_BEARER_TOKEN / DEFAULT_PROVIDER / DEFAULT_API_KEY`，而 `packages/server/src` 里**一处都不读**；真实读的是 `DB_PATH / VUAGENT_TOKEN / VUAGENT_HOST / REDIS_URL / OPENAI_* / ANTHROPIC_*` |
| 服务不托管前端 | [server.ts](../../packages/server/src/server.ts) 只有 `/api/*`，无 `serveStatic`、无 `/`、无 SPA fallback |
| console 是 dev-only 私有应用 | [apps/playground/package.json](../../apps/playground/package.json)：`private: true`、0.1.0；靠 [vite.config.ts](../../apps/playground/vite.config.ts#L19-L23) 的 dev 代理 `/api → 6880`；客户端全部相对路径（如 [client.ts](../../apps/playground/src/console/api/client.ts#L513)） |

结论：**「一条命令」缺的不是启动脚本，而是三件基础设施**——(a) 显式数据根，(b) 单实例语义，(c) 同源静态托管 + 可发布的 console 产物。

## 3. 总体架构

```
                 npm i -g @vuagent/cli
                          │
                    bin: vuagent
                          │
        ┌─────────────────┴──────────────────┐
        │                                    │
  @vuagent/server（库）               @vuagent/console（资源包）
  createHarnessServer()                dist/index.html + assets/*
  + console 静态托管（新增）            （构建产物随包发布）
        │                                    │
        └──────────► 同一端口 127.0.0.1:6880 ◄┘
                     /api/*  → harness
                     /assets/* → 静态（immutable）
                     其它 GET  → index.html（SPA fallback）
```

- **CLI 只做编排**：解析参数 → 解析数据路径 → 抢锁 → 建 server（显式传 `dbPath`/`consoleDir`）→ 监听 → 打印地址 → 挂信号；不塞业务逻辑。
- **服务保持库语义无副作用**：`createHarnessServer()` 不传 `dbPath` 依旧 `:memory:`（现有行为不变，避免嵌入式用法被偷偷写盘）；只有 `console`/`dbPath` 显式传入才托管前端。
- **数据目录解析下沉到 server 包**（`resolveDataPaths()`），CLI 与 `node dist/index.js` 共用同一套规则，避免两处漂移。

### 3.1 启动时序（`vuagent start` 的确定性顺序）

```
解析参数/环境 ──► resolveDataPaths() ──► mkdir -p (0700) ──► 抢 run/harness.lock (wx)
                                                            │
                                          ┌─────────────────┴─────────────────┐
                                      抢到锁                              锁被占用
                                          │                                   │
                      探测 console 资源目录（cli 内置/--console-dir）      pid 存活? ─是─► 退出码 3 + 三条出路
                                          │                                   │否
                      打开 SQLite（显式 dbPath，wal_checkpoint 告警阈值）   rename .stale → 重试一次
                                          │
                      createHarnessServer({ dbPath, console:{dir} })
                                          │
                      serve({ fetch, port, hostname }) ──► 打印 data/db/server/console + hint
                                          │
                      SIGINT/SIGTERM ──► 停受理 ──► 等 in-flight（≤20s）──► close() ──► 删锁 ──► exit 0
```

顺序上的硬约束：**先抢锁再开库再监听**（反过来会出现「端口已占但库里已经写了半截迁移/checkpoint」）；退出路径上**先关库再删锁**（否则另一个实例可能抢到锁却读到正在关闭的库）。

### 3.2 console 产物怎么来（结构性决策）

现状：console 源码在 `apps/playground/src/{Console.vue, console/**}`（console 目录 **65 个文件 / .ts+.vue 约 1.03 万行**，另有 `Console.vue` 1,500 行），外部依赖只有 `vue / lucide-vue-next / markdown-it / @vuagent/ui / @vuagent/protocol`；**不依赖 vue-router**（router 只在 playground 壳里），也没有任何 playground 专属引用——**可干净抽取**。

| 方案 | 做法 | 代价 | 建议 |
|---|---|---|---|
| **B（先上）** | `apps/playground` 增加 `vite build --mode console`：只注册 `/console` 路由，`index.html` 标题改为 `Vuagent Console`；产物以 `@vuagent/console` 包发布（`private` 去掉、`files: ["dist"]`） | 小；dev/demo 与生产共用一份代码 | **P0 采用**，先把「一条命令」链路打通 |
| **A（后做）** | 抽 `packages/console`（库：`mountConsole(el, opts)` + 全部视图/composables），`apps/console` 做生产薄壳，`apps/playground` 变成 dev/demo 壳并依赖它 | 中等（一次性搬 65 文件 + 改导入路径 + 两处入口） | **P1 做**，为后续「只发 console 不发 demo」定结构 |

拒绝的备选：把 console 打进 `@vuagent/server`（UI 每次改动都要发 server 版本，包体膨胀，且库用户被迫下载前端）；单文件可执行（SEA）打包（跨平台签名/体积问题，收益不匹配）。

## 4. 数据目录规范（核心）

### 4.1 解析优先级（单一事实源：`resolveDataPaths()`）

```
1. --data-dir <path>           显式目录
2. $VUAGENT_HOME               显式目录（CI / 容器 / 共享卷）
3. 平台默认
   macOS / Linux :  ~/.vuagent
   Windows       :  %LOCALAPPDATA%\vuagent  (缺省回退 ~/.vuagent)
4. --db <path> / $DB_PATH      只覆盖「库文件」，目录其余仍按 3（容器挂单文件场景）
```

- 每条返回都带 `source`（`flag` / `env:VUAGENT_HOME` / `default` / `env:DB_PATH`），`vuagent paths` 原样打印，根除「配了但没生效」。
- **不再有 CWD 相对路径**：库、计价表、日志、锁全部由数据根派生。
- 兼容口子只在**显式**层面：`DB_PATH` 仍认可（文档标注「只影响库文件」）。

### 4.2 目录布局

```
~/.vuagent/                     (0700)
├── harness.db                  (0600) 全部状态：kv_store 九个集合
├── harness.db-wal / -shm
├── config/model-pricing.json          计价表（缺省空表 = 只记量不记钱）
├── logs/harness.log            运行日志（含启动横幅、迁移/备份审计行）
├── exports/                    backup/export 产物
├── run/harness.lock            单实例锁（§5）
└── tmp/                        短生命周期（导出中转、VACUUM 目标）
```

**数据面**（实测一个真实库的集合分布）：`workspaces / sessions / session_turns / model_profiles / providers / tool_configs / harness_config / settings_meta / cost_records`。没有独立文件仓；图片 base64 不落库（只元数据 + `[图片]` 占位）；日志只由 CLI 落 `logs/`（服务本体仍 stdout/NDJSON）。

**边界**：`~/.vuagent` 只装会话/审批/成本/配置；**被 Agent 修改的文件永远在 workspace `rootPath` 下**（现有 search-tools 已把 `.vuagent` 加入忽略集合，迁到 home 后无需改动）。

### 4.3 权限与平台细节

- POSIX：目录 `0o700`、库与锁 `0o600`；启动时若发现过宽权限（如 0o755）在 `doctor` 报警，不自动 chmod（避免动用户目录）。
- Windows：无 chmod 语义，`%LOCALAPPDATA%` 默认即用户私有；锁文件用 `open(..., 'wx')` 语义相同。
- 符号链接数据目录：允许，但 `paths` 打印**解析后的 realpath** 与原始输入两行，便于排查容器挂载。

### 4.4 首次启动

数据根不存在 → 递归创建（0700）→ 建空库 → 打印：

```
vuagent 0.7.0
  data     /Users/you/.vuagent        (default)
  db       sqlite  /Users/you/.vuagent/harness.db   (新建 12 KB)
  server   http://127.0.0.1:6880
  console  http://127.0.0.1:6880/console
  hint     未检测到模型凭据：设置 OPENAI_API_KEY / ANTHROPIC_API_KEY，或在 console → 设置 中添加供应商
```

## 5. 单实例锁（默认拒绝）

**语义**：同一数据目录同时只允许一个 `vuagent` 服务进程（SQLite WAL 能扛双写，但两个实例共享一份 WAL 的语义是「双主」，成本/审批/会话列表都会出现竞态，用户体验上就是"我明明发了消息却没反应"）。

**实现**：`run/harness.lock`，内容 JSON：

```json
{ "pid": 12345, "startedAt": 1795749018163, "port": 6880, "host": "127.0.0.1", "version": "0.7.0", "cwd": "/Users/you/code/x" }
```

流程：`open(lock, 'wx', 0o600)` → 成功则写入并持有；`EEXIST` → 读锁 → 用 `process.kill(pid, 0)` 探活：

- **存活** → 退出码 `3`，打印：

  ```
  ✗ 该数据目录已有实例在运行：pid 12345, 端口 6880, 数据目录 /Users/you/.vuagent
    复用： open http://127.0.0.1:6880/console
    另起： vuagent --data-dir ~/.vuagent-alt
    清残留： vuagent doctor --fix-lock        (仅在确认进程已死时使用)
  ```
- **不存在**（ESRCH / 空文件 / JSON 损坏）→ 视为残留：`rename(lock → lock.stale.<ts>)` 后重试一次 `open(…,'wx')`；再失败即退出（并发启动的极端竞态，失败方放弃比双写安全）。

**逃逸口子**：`VUAGENT_ALLOW_SHARED=1`（仅测试/Redis 分布式形态使用，文档标注"自担双写风险"）。用户要的是「拒绝」，所以**不做**成 `--allow-shared` 那种日常可见的开关。

**清理**：正常退出（含 SIGINT/SIGTERM）删除锁；`doctor --fix-lock` 手动兜底。锁文件永不进备份。

## 6. 静态托管与 SPA

**服务端**：新增可选选项（默认关闭，库用户零影响）：

```ts
export interface ServerOptions {
  // …
  /** console 静态资源目录（传入即托管；缺省不托管，仅 API） */
  console?: {
    dir: string;
    /** SPA 入口文件，默认 index.html */
    entry?: string;
    /** 缓存策略：/assets/* 长缓存 + immutable，其余 no-cache */
    immutableAssets?: boolean;
  };
}
```

路由顺序（必须在所有 `/api` 之后挂载）：

1. `/api/*` 业务路由与 `/api/health`（不变）；
2. `serveStatic({ root: dir })` —— 命中真实文件（`@hono/node-server/serve-static`，已是 server 依赖，实测可 import）；
3. 兜底 `GET *`：`/api` 前缀继续 404 JSON（不吞 API 错误），其余一律回 `index.html`（history 路由必需）。

缓存：`/assets/*` → `public, max-age=31536000, immutable`（vite 产物带内容哈希）；`index.html` → `no-cache`。

**安全边界**：console 只在「回环绑定」或「已配置 `VUAGENT_TOKEN`」时托管；绑定 `0.0.0.0` 且无 token 时沿用现有 `resolveBindPlan()` 的拒绝/豁免逻辑（[security.ts](../../packages/server/src/security.ts#L177-L194)），并在启动横幅把「console 已对内网开放」显式喊出来。静态根之外禁止穿越（`serveStatic` 自带 root 约束）。

**CLI 侧解析 console 目录**：

```
--console-dir <path>      显式（开发：apps/playground/dist）
$VUAGENT_CONSOLE_DIR      显式
require.resolve("@vuagent/console/dist/index.html")  → dirname   （发布形态）
```

`@vuagent/console` 需在 `exports` 里放开 `"./dist/index.html"`（否则 `exports` 封装会挡住 resolve）。

## 7. CLI 命令面

| 命令 | 作用 | 退出码 |
|---|---|---|
| `vuagent` / `vuagent start` | 起服务 + console；`--port`（`0` = 随机并打印实际端口）、`--host`、`--open`、`--data-dir`、`--db`、`--console-dir`、`--workspace <path>`、`--no-open` | 0 / 3=锁冲突 / 1=错误 |
| `vuagent paths` | 打印 data/db/logs/exports/lock/console 目录及各自 `source` | 0 |
| `vuagent doctor [--fix-lock]` | Node 版本与 `node:sqlite` 探测、库完整性与 WAL 体积、目录权限、端口占用、模型凭据、console 资源完整性；`--json` 供脚本 | 0 / 1 |
| `vuagent backup [--out <path>]` | `VACUUM INTO exports/harness-<ts>.db`（写中也能安全快照） | 0 |
| `vuagent export [--out <json>]` | 结构化导出（workspaces/sessions/turns/配置），带 `schemaVersion` | 0 |
| `vuagent import <json> [--strategy skip\|overwrite]` | 导入；id 冲突按策略处理并汇总 | 0 |
| `vuagent migrate --from <db> [--dry-run]` | 从旧库（如 `./.vuagent/harness.db`）搬迁：先 VACUUM 备份 → 逐集合复制 → 冲突汇总 | 0 |
| `vuagent prune [--older-than 30d] [--keep <id>…] [--vacuum]` | 显式清理（**默认不触发**，因为轮次全保留）；`--vacuum` 顺带回收空间 | 0 |
| `vuagent --version` / `--help` | 版本/帮助 | 0 |

通用：`--json` 输出机器可读结果；日志走 `logs/harness.log` + stderr 摘要；`SIGINT/SIGTERM` 走既有优雅停机（停受理 → 等在途轮次抽干上限 20s → 关库 → 删锁 → exit）。

**首启探测（只提示不动作）**：若发现 `./.vuagent/harness.db`、`packages/server/.vuagent/harness.db` 等历史库，打印一行：

```
hint 检测到历史数据库：./.vuagent/harness.db（16 KB，空）
     搬迁到当前数据目录：vuagent migrate --from ./.vuagent/harness.db
```

## 8. 备份 / 导出 / 迁移 / 体积

- **备份必须 `VACUUM INTO`**，不能 `cp`（WAL 里有未 checkpoint 的页，直接拷会得到不一致快照；实测 121 MB 的库（112 MB 主库 + 9 MB WAL）压缩快照 51.6 MB）。`node:sqlite` 的 `DatabaseSync.exec("VACUUM INTO '<path>'")` 已验证可用；路径用单引号 SQL 字面量并做转义。
- **导出**用于跨机/跨版本：`{ schemaVersion, exportedAt, workspaces, sessions, turns, config }`；导入按 `schemaVersion` 校验，未知高版本直接拒绝。
- **迁移**：源库与目标库同为 `kv_store` 形态，逐集合按 `id` 复制；默认 `--dry-run` 先打印「将复制 N 个会话 / M 个 turn / 冲突 K」，用户确认后执行；执行前对源库做一次 `VACUUM INTO` 备份到 `exports/`。
- **体积治理**：轮次全保留（决策 3），但 `doctor` 输出：

  ```
  db 112 MB (主库) + 9.2 MB (WAL)   ← WAL 超过 32 MB 时提示 `vuagent backup`（顺带 checkpoint）
  top sessions by size: sess-…a1  43.1 MB / 31 turns
  ```
  用户要瘦身只有两条显式路径：`prune --older-than`、`prune --keep <id>`。

## 9. 环境变量真值表（顺手修文档漂移）

**新增**

| 变量 | 含义 |
|---|---|
| `VUAGENT_HOME` | 数据目录（等价 `--data-dir`） |
| `VUAGENT_CONSOLE_DIR` | console 资源目录（开发/自定义构建） |
| `VUAGENT_ALLOW_SHARED` | 仅测试/分布式形态：跳过单实例锁 |

**既有（文档需按此改写）**：`PORT`、`DB_PATH`（只覆盖库文件）、`VUAGENT_HOST`、`VUAGENT_TOKEN`、`VUAGENT_INSTANCE_ID`、`REDIS_URL`、`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `ANTHROPIC_API_KEY`、`VUAGENT_ALLOW_PRIVATE_FETCH`、`VUAGENT_BASH_ENV_POLICY`、`LOG_LEVEL`。

**删除**（代码从未读、文档仍在写）：`SQLITE_DB_PATH`、`STORAGE_DRIVER`、`AUTH_BEARER_TOKEN`、`DEFAULT_PROVIDER`、`DEFAULT_MODEL`、`DEFAULT_API_KEY`、`DEFAULT_BASE_URL`、`HOST`。迁移说明：旧读者若照文档配置 → 启动横幅提示「`SQLITE_DB_PATH` 已废弃，请用 `VUAGENT_HOME` 或 `--data-dir`」，避免静默不生效。

## 10. 发布与版本

- 新包 `@vuagent/cli`：`"bin": { "vuagent": "./dist/main.js" }`、`files: ["dist"]`、`engines.node: ">=22.13"`、`prepublishOnly: pnpm build`；`main.js` 首行 shebang（`#!/usr/bin/env node`，tsc 保留）＋启动时探测 `node:sqlite`（可用性靠运行时探测，不靠版本号字符串）。
- `@vuagent/console`：`private` 去掉、`files: ["dist"]`、`exports` 放开 `./dist/index.html`。
- 依赖关系：`@vuagent/cli` → `@vuagent/server` + `@vuagent/console`（`workspace:*` → 发布时替换为具体版本）。
- **版本策略**：`@vuagent/cli` 与 `@vuagent/server`/`@vuagent/console` 必须同轮发布（CLI 依赖 server 新选项），建议把三者都纳入 `.changeset/config.json` 的 `fixed` 组（现有组为 protocol/server/ui），即五包同版本；好处是避免「CLI 0.7 配 server 0.6 找不到 `console` 选项」。
- 发布链（已落地）：版本编排走 [release.yml](../../.github/workflows/release.yml)（仅 version），发包走 [publish.yml](../../.github/workflows/publish.yml)（tag/dispatch → 门禁 → `changeset publish --tag` → 冒烟）。发布顺序：`pnpm build` 必须按 `protocol → ui → server → console(playground) → cli` 顺序产出；根 `build` 脚本补 `--filter @vuagent/console` 与 `--filter @vuagent/cli`，CI 的 registry/llms 门禁不受影响。
- `npm pack` 审查项：cli 包里不应出现 `src/`、`node_modules`、`.env`；console 包只应含 `dist/`（不含 demo 路由，P0 阶段若共用 playground 产物需在 `--mode console` 里把 demo 路由裁掉，否则用户能打开 `/m1` 等内部页面）。

## 11. 兼容与迁移路径

1. **库形态不变**：`createHarnessServer()` 缺省仍 `:memory:`；`@vuagent/server` 直接 `node dist/index.js` 时走新的 `resolveDataPaths()`（行为变化：不再写 CWD），启动横幅打印一次「数据目录已从 CWD 迁到 ~/.vuagent，旧库需 migrate」。
2. **仓库内开发不变**：`pnpm console` 仍双进程 + vite 代理；dev 时 `.vuagent/` 留在仓库（.gitignore 已覆盖）。
3. **老用户**：库在 `./.vuagent` 或 `packages/server/.vuagent` 的，首启只提示不搬（决策：不自动迁移，避免把 112 MB 库在用户不知情时挪走）。

## 12. 测试与验收

**单测（`packages/cli/tests`，vitest + happy-dom 不需要）**

- `resolveDataPaths`：flag/env/default 优先级矩阵 × 平台（darwin/linux/win32 注入 `process.platform` + 假 `homedir`）× `DB_PATH` 只覆盖库文件；
- 锁：并发两个进程（spawn 子进程）第二个退出码 3；残留锁（写入不存在的 pid）可被抢占；`--fix-lock` 清理；
- `backup`：对临时库 `VACUUM INTO` 产物可用 `PRAGMA integrity_check`；WAL 中未 checkpoint 的数据在备份里可见（回归「不能直接 cp」）；
- `export/import`：往返一致（集合行数、会话 id、成本记录）；`schemaVersion` 不兼容拒绝；
- `migrate`：源库 → 空目标库，冲突策略与汇总输出；
- `doctor`：`--json` 结构稳定（落一份 snapshot）。

**server 侧测试**

- `console: { dir }` 托管：`/assets/x.js` 200 + immutable；`/console`（history 深链）→ 200 且 body 为 index.html；`/api/nope` → 404 JSON（不被 SPA 吞）；`console` 未传 → `/` 404（现有行为不变）；
- 安全：`VUAGENT_HOST=0.0.0.0` 无 token 时静态也不托管（或按现有豁免逻辑一致）。

**冒烟（CI 外，手工脚本 `scripts/cli-smoke.mjs` 可选）**

```
npm pack → 装到临时 prefix → VUAGENT_HOME=$(mktemp -d) vuagent --port 0 --no-open &
→ curl /api/health → curl /console（含 <div id="app">）→ vuagent paths → kill → 重启不报锁
```

**验收标准（P0）**

- [ ] `npm i -g` 后单条命令起来，浏览器打开 console 能看到首屏；
- [ ] 所有状态只落在 `~/.vuagent`（`find` 仓库目录零新增）；
- [ ] 第二次启动退出码 3 且提示三条出路；
- [ ] `vuagent paths` 打印的 `source` 与实际生效一致（flag/env/default 各验一次）；
- [ ] `vuagent backup` 产物可被 `sqlite3 … integrity_check` 通过，体积 ≈ VACUUM 后大小。

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `node:sqlite` 仍属实验特性，Node 会往 stderr 打 `ExperimentalWarning` | 用户误判为启动失败 | CLI 捕获该 warning 一次并转成一行说明（或启动横幅标注）；`engines.node` + 运行时探测双保险 |
| 同机已有 6880 占用（用户当前就是这么跑的） | 启动失败 | 端口占用检测 + 明确提示 + `--port 0` |
| 数据目录权限过宽 / 库在共享盘 | 泄露 / 损坏 | `doctor` 报警；NFS 明确不支持；`VUAGENT_ALLOW_SHARED` 才放行多实例 |
| console 静态资源与 API 同源后，误绑 `0.0.0.0` | 内网可访问工作台 | 沿用绑定闸门；启动横幅显著标红；`doctor` 检查绑定与 token |
| P0 共用 playground 产物导致 demo 路由被发布 | 用户看到内部页面 | `--mode console` 构建裁掉 demo 路由（拒绝发布未裁剪产物，作为发布门禁） |
| 112 MB 级库的备份耗时/磁盘 | 首次 backup 阻塞 | backup 走流式提示「正在 VACUUM…」，输出产物大小；`doctor` 预告体积 |
| Windows 路径（`%LOCALAPPDATA%`、锁语义、chmod 缺失） | 跨平台行为不一致 | P3 专项：Windows CI job + 路径矩阵单测；锁用 `wx` 语义而非 flock |

## 14. 阶段拆分

> 排期与任务编号以整体规划 [v0.7-plan.md](./v0.7-plan.md) 为准（本节保留 W1 视角的阶段划分）；性能治理 W2 详见 [checkpoint-store-split.md](./checkpoint-store-split.md)。

| 阶段 | 内容 | 交付物 | 估时 |
|---|---|---|---|
| **P0 骨架** | `resolveDataPaths` + 锁 + server `console` 托管 + `--mode console` 构建 + `vuagent start`（含信号/端口/打印） | 可 `npm pack` 安装、单命令跑通 | 1.5–2 天 |
| **P1 运维面** | `paths / doctor / backup / export / import / migrate / prune`；env 真值表落地 + 旧名提示 | 数据可备份可迁移可体检 | 1–1.5 天 |
| **P2 发布链** | 新包元数据（bin/files/engines/exports）、changesets fixed 五包、根 build 顺序、release 审查项、README + `apps/docs/guide/cli.md`、R4 docs 漂移修正 | `0.7.0-rc` 可发布 | 1 天 |
| **P3 结构抽取（可选）** | 方案 A：抽 `packages/console` + `apps/console` 薄壳；Windows 兼容验证；`--daemon` 片段文档 | 结构收敛 | 2 天 |
| **P4 性能治理（建议与本轮并做，见 §16）** | checkpoint 拆行 + 详情接口瘦身 + 自适应节流 | 单会话长轮次不再阻塞、切会话从 36 MB/300 ms 降到亚 MB 级 | 1.5–2.5 天 |

## 15. 改动清单（文件级）

| 文件 / 目录 | 改动 |
|---|---|
| `packages/cli/`（新包） | `package.json`（bin/files/engines）、`src/main.ts`（参数解析与调度）、`src/commands/{start,paths,doctor,backup,export,import,migrate,prune}.ts`、`src/lib/{paths,lock,console-resolve,log}.ts` |
| `packages/server/src/storage/paths.ts`（新增） | `resolveDataPaths()`：flag/env/default 三级解析 + `source` 标注 + 平台默认 |
| `packages/server/src/server.ts` | `ServerOptions.console`；`/api` 之后挂 `serveStatic` + SPA fallback + 缓存头；未传 `console` 时行为不变 |
| `packages/server/src/index.ts` | 直接运行入口改用 `resolveDataPaths()`；启动横幅打印数据目录与来源；旧 env 名（`SQLITE_DB_PATH` 等）一次性废弃提示 |
| `packages/server/src/core/pricing-table.ts` | 缺省计价表路径 `${cwd}/config/…` → `<dataDir>/config/model-pricing.json` |
| `apps/playground/vite.config.ts` + `src/main.ts` + `index.html` | `--mode console`：只注册 `/console` 与 `/` 重定向、标题 `Vuagent Console`、裁掉 demo 路由 |
| `apps/playground/package.json` | 方案 B 时补发布元数据；方案 A 时改为依赖 `@vuagent/console` |
| `.changeset/config.json` | `fixed` 组扩到五包（protocol/server/ui/console/cli），或按 §15-2 的替代口径 |
| 根 `package.json` | `build` 顺序补 `@vuagent/console`、`@vuagent/cli`；新增 `cli:smoke` 脚本 |
| `.github/workflows/ci.yml` | 主体无需改（`pnpm -r` 已覆盖新包）；可选增加 `npm pack` 内容审查 job |
| `apps/docs/guide/cli.md`（新增） | 安装、首启、`paths/doctor/backup/migrate` 用法、数据目录说明 |
| `apps/docs/server/deployment.md` | 按 §9 真值表重写 env 段，删除 5 个不存在的变量名 |

## 16. 性能基线（实测）与容量判断

**方法**：复制真实库（112 MB 主库 + 9 MB WAL，5 会话 / 32 turn）到临时目录，用仓库自身的 `SQLiteStorageDriver` + `SessionRepository`（`dist`）压测；HTTP 侧直接打当前运行中的服务。命令与脚本可复现，不含推测。

### 16.1 实测数字

| 项 | 结果 |
|---|---|
| 最大单 turn 行 | **≈12.4 MB（UTF-8）**，32 个 checkpoint，其中 `messagesSnapshot` 占 **12.25 MB**，单个快照均值 **392 KB** |
| 同行的「真实业务数据」 | content 0.01 MB / thought 0.02 MB / cards 0.06 MB / telemetry.events 0.03 MB |
| `JSON.parse` + `JSON.stringify` 该行 | 16.6 ms + 17.0 ms（纯序列化就 ~34 ms） |
| `updateTurn`（写该行） | 中位 **112 ms**（首次 262 ms，热态 73 ms）；小行（≈0.9 KB）**0.8 ms** |
| 8 个会话并发写（各一次 12 MB 行） | 总耗时 **484–787 ms**，期间**事件循环最长阻塞 484 ms（≈29 帧）** |
| `repo.get(最大会话)`（8 turn / 27.8 MB） | **114 ms** |
| `GET /api/sessions/<最大会话>` | **36.7 MB / 296 ms**（另一会话 29.3 MB / 213 ms）——本机回环 |
| `GET /api/sessions`（列表） | **1.3 KB / 1 ms**（TASK-093 元数据瘦身达标） |
| `wal_checkpoint(TRUNCATE)` + `VACUUM INTO` | 121 MB → **51.6 MB**（WAL 膨胀可观） |

### 16.2 根因（不是"进程数"，是三个点乘出来的）

1. **每步进度落盘整行重写**：[turn-persistence.ts](../../packages/server/src/core/turn-persistence.ts#L133-L157) 的 `persistProgress` 把 `checkpoints`（含全部 `messagesSnapshot`）随 `updateTurn` 整体重写。落盘频率已被 250 ms 防抖控制住，但**单次成本随步数线性增长、随上下文线性增长 → turn 内总写入是 O(步数²)**：32 步 × 392 KB ≈ 12 MB/次，且每 250 ms 重写一次。
2. **同步 SQLite 阻塞主线程**：`node:sqlite` 的 `DatabaseSync` 是同步 API（[sqlite.driver.ts](../../packages/server/src/storage/drivers/sqlite.driver.ts#L33)），一次 12 MB 行的读-改-写全程占着事件循环；同进程所有会话的 SSE 推送只能排队（实测 484 ms 冻结）。
3. **详情接口整包下发快照**：`GET /api/sessions/:id` 直接返回含 `checkpoints.messagesSnapshot` 的 turn 实体 → **36.7 MB/会话**，前端还要 JSON.parse + 常驻内存。会话越多、轮次越长，切会话越慢。

### 16.3 什么规模会卡

| 场景 | 现状表现 |
|---|---|
| 单会话、短轮次（<5 步） | 无感（写 0.8–2 ms） |
| 单会话、长轮次（30+ 步 / 大上下文） | 每 250 ms 一次 70–110 ms 阻塞，流式输出**可见顿挫** |
| 3–8 会话并发流式（长轮次） | 峰值阻塞 300–500 ms，跨会话互相拖累（"我这边卡住了"） |
| 会话数 50–100 | 侧栏无感（1 ms / 1.3 KB）；**切到大会话 200–300 ms + 30 MB 传输** |
| 会话数 500+ / 库数 GB | 启动恢复扫描、备份、迁移变慢；WAL 膨胀；`doctor` 必须把体积可见化 |

结论：**单进程架构本身够用**（模型调用是异步 IO，SSE 只在 step 边界落盘），真正卡的是「checkpoint 快照被当成 turn 行的一部分反复整行重写/下发」这一个结构问题。

### 16.4 修复排序（收益/成本）

| 优先级 | 动作 | 预期 | 成本 |
|---|---|---|---|
| **P4-1** | checkpoint 拆独立 append-only 行（`session_checkpoints`，键 `sessionId:turnId:index`）；进度落盘不再带快照 | 单次写 112 ms → **<2 ms**；turn 行 12 MB → ~0.2 MB | 1–1.5 天（含 DB 迁移 + 恢复读取适配） |
| **P4-2** | 详情接口瘦身：`/api/sessions/:id` 只回摘要，checkpoints 走 `/api/sessions/:id/checkpoints?turn=` 按需 | 切会话 36.7 MB/296 ms → **亚 MB / <50 ms** | 0.5 天（protocol 兼容：旧客户端读不到 checkpoints 时回退现有字段） |
| **P4-3** | 自适应节流（行越大写越稀）+ 跨会话单写队列合并 | 并发流式峰值阻塞减半 | 0.5 天 |
| **P4-4** | SQLite 移入 `worker_thread`（主线程只投递写任务） | 彻底消除主线程阻塞；API 变异步 | 2–3 天（可选，先不做） |
| **常驻** | `doctor` 输出：最大 turn 行、详情接口体积、WAL 阈值（>32 MB 提示 `backup`）、top sessions by size | 问题可见化，避免"悄悄变慢" | 随 P1 落地 |

**与 CLI 的关系**：CLI 不需要为性能做任何事，但 `doctor` 应把这几个指标变成一等公民；P4-1/P4-2 建议与本轮并行（它们决定"会话量大时会不会卡"的用户感知，而 CLI 决定"能不能一条命令跑起来"）。

## 17. 待确认（影响实现细节，不阻塞设计）

1. **console 目录名**：发布包用 `@vuagent/console`，它的构建入口是先走方案 B（playground `--mode console`）还是直接做方案 A？我建议 P0 走 B、P1 补 A。
2. **版本组**：把 cli/console 并入现有 `fixed` 五包同版本，还是 cli 独立版本但硬绑 `@vuagent/server@^x.y`？我建议前者（当前项目就是「一套版本号」的口径）。
3. **`--open` 默认开还是关**：本地交互默认开浏览器更贴近「一条命令」体验，但 CI/无桌面会失败；建议默认开、`--no-open` 关，且 `CI` / 无 TTY 时自动关。
4. **日志落盘**：默认写 `logs/harness.log`（含轮转策略：单文件 10 MB × 3），还是保持纯 stdout 由用户重定向？建议默认落盘（否则 CLI 后台跑就没有痕迹）。
5. **config.json**：是否引入 `~/.vuagent/config.json`（端口/host/open/pricing 的持久默认）？建议 **P1 再议**，P0 只认 flag + env，少一层优先级就少一类「配了不生效」。
