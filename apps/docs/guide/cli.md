# CLI 一条命令跑起来（`@vuagent/cli`）

> 0.7.0 起：`npm i -g @vuagent/cli` → `vuagent` 一条命令把 **harness 服务 + web console** 起在同一个端口，状态全部落在 `~/.vuagent`。

## 安装与首次启动

```bash
npm i -g @vuagent/cli
vuagent
```

首启会打印**数据路径与来源**，并自动打开浏览器（CI / 无 TTY 时自动关闭）：

```
vuagent 0.7.0
  data     /Users/you/.vuagent            (default)
  db       sqlite  /Users/you/.vuagent/harness.db   (default)
  server   http://127.0.0.1:6880
  console  http://127.0.0.1:6880/console   (package)
  hint     未检测到模型凭据：设置 OPENAI_API_KEY / ANTHROPIC_API_KEY，或在 console → 设置 中添加供应商
```

模型凭据两条路：环境变量（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`），或在 console 的「设置 → 供应商」里配置（存库）。

## 数据目录（唯一事实源）

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | `--data-dir <path>` | 显式目录 |
| 2 | `VUAGENT_HOME` | CI / 容器 / 共享卷 |
| 3 | 平台默认 | macOS/Linux `~/.vuagent`；Windows `%LOCALAPPDATA%\vuagent` |
| 4 | `--db <path>` / `DB_PATH` | **只覆盖库文件**，其余仍按上面派生（`":memory:"` = 纯内存试跑） |

```
~/.vuagent/
├── harness.db (+ -wal / -shm)     全部状态（会话/审批/成本/配置）
├── config/model-pricing.json      计价表（缺省 = 只记量不记钱）
├── logs/  exports/  run/  tmp/
```

`vuagent paths` 随时打印每条路径**及其来源**（`flag` / `env:VUAGENT_HOME` / `default`），根除「配了没生效」。

边界：`~/.vuagent` 只装会话与配置；**被 Agent 修改的文件永远在你的 workspace 目录下**。

## 单实例语义

同一数据目录同时只允许一个实例（SQLite 双写会串会话/成本/审批）。第二次启动**默认拒绝**：

```
✗ 该数据目录已有实例在运行：pid 12345, 端口 6880, 数据目录 /Users/you/.vuagent
  复用： open http://127.0.0.1:6880/console
  另起： vuagent --data-dir ~/.vuagent-alt
  清残留： vuagent doctor --fix-lock   （仅在确认进程已死时使用）
```

退出码 `3`（脚本可判定）。`VUAGENT_ALLOW_SHARED=1` 仅供测试 / Redis 分布式形态，自担双写风险。

## 常用选项

| 选项 | 作用 |
|---|---|
| `--port <n>` | 端口（默认 6880；`0` = 随机并打印实际值） |
| `--host <host>` | 绑定地址（默认 127.0.0.1；对外绑定**必须**配 `VUAGENT_TOKEN`） |
| `--workspace <path>` | 确保以该路径为根的工作区存在（headless 免「选文件夹」） |
| `--console-dir <p>` | 自定义 console 静态资源（开发期指向 `apps/console/dist`） |
| `--open` / `--no-open` | 是否自动开浏览器 |

## 运维命令

```bash
vuagent doctor [--fix-lock] [--json]   # 体检：库完整性/体积、WAL 阈值、最大 turn 行、
                                      # top sessions、锁、端口、凭据、console 资源
vuagent backup [--out <path>]         # VACUUM INTO 安全快照（写中可执行）→ exports/
vuagent export [--out <file>]         # 逻辑导出（schemaVersion JSON，可检视/跨机）
vuagent import <file> [--strategy skip|overwrite]
vuagent migrate --from <db>           # 旧散落库（CWD 时代 ./.vuagent/harness.db）→ 当前目录
vuagent migrate --checkpoints [--dry-run] [--vacuum]
                                      # 0.6.x 数据拆行迁移：内联快照 → 独立集合
vuagent prune --older-than 30d [--keep <id>…] [--vacuum] [--dry-run]
                                      # 显式清理（轮次默认全保留，不做自动 retention）
```

**备份不能 `cp`**：WAL 里有未落盘的页，直接拷主库会拿到不一致快照——`vuagent backup` 走 `VACUUM INTO`（顺带整理空间，实测 121 MB → 51.6 MB）。

**升级到 0.7 后建议**：

```bash
vuagent doctor                       # 看最大 turn 行是否 > 3MB（0.6 数据特征）
vuagent migrate --checkpoints --dry-run
vuagent migrate --checkpoints --vacuum
```

## 与直接跑 server 的关系

`@vuagent/server` 仍可单独作为库 / 服务使用（容器化、集群、Redis 形态）。CLI 只是把它包起来：显式给 `dbPath`、托管 console 静态资源、加单实例锁与数据目录规范。两条路径的数据格式完全一致——CLI 建的库可以直接用 server 打开，反之亦然。

## 常见问题

| 现象 | 处理 |
|---|---|
| `✗ 端口 6880 已被占用` | `vuagent --port 0`，或 `vuagent doctor` 看占用 |
| `node:sqlite` 不可用 / 实验特性警告 | 需 Node ≥ 22.13（`engines` 已声明）；警告本身不影响运行 |
| 装了 `vuagent` 但命令找不到 | 检查 npm 全局 bin 是否在 `PATH`（`npm prefix -g`） |
| 打开页面 404 / 白屏 | `vuagent doctor` 看 console 资源与 `/api/health` |
