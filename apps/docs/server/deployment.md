# 部署与生产运维实践

> `@vuagent/server` 是面向生产设计的 Node.js 服务端，启动迅速、架构无守护污染，能够以最小成本集成进现代容器编排与云原生基建中。

---

## 快速启动

::: code-group

```bash [开发模式 (热重载)]
pnpm --filter @vuagent/server dev
# 默认监听 http://localhost:6880
```

```bash [生产直跑模式]
# 使用 tsx 直接运行入口（免繁琐编译，专为现代容器化设计）
pnpm --filter @vuagent/server start
```

:::

> [!NOTE] 无密钥自愈沙箱
> 服务端首次启动无需配置真实的大模型 API Key。系统内置了无密钥沙箱演示分支，能够自动生成模拟的计划、代码比对和终端执行流，方便你在本地或内网环境先行验证前端与后端的全链路连通性。

---

## 核心环境变量

在服务根目录下创建 `.env` 或在容器中注入环境变量：

```ini
# ── 服务端口与绑定（0.7.0 真值表：以下变量名与代码一一对应）──
PORT=6880
# 绑定闸门：默认 127.0.0.1（回环）；对外绑定必须同时配置 VUAGENT_TOKEN，
# 否则拒绝启动（显式豁免见 VUAGENT_ALLOW_UNSAFE_NETWORK=1，仅限隔离网络）
VUAGENT_HOST=0.0.0.0
VUAGENT_TOKEN=my_production_secure_token

# ── 存储（SQLite 单机 / Redis 分布式）──
# 数据库文件；CLI 形态下由数据目录派生（~/.vuagent/harness.db），
# 直接跑 server 时用它指定。":memory:" = 纯内存试跑
DB_PATH=./data/vuagent.db
# 配置后启用 Redis 形态（多副本共享实体 + 跨副本轮次租约），无需 STORAGE_DRIVER 开关
REDIS_URL=redis://:password@10.0.0.8:6379/0
# 多副本实例标识（缺省 hostname），用于租约归属与启动清扫
VUAGENT_INSTANCE_ID=replica-1

# ── 模型默认配置（可选；亦可在 console「设置 → 供应商」在线配置并存库）──
OPENAI_API_KEY=sk-xxxxxx
OPENAI_BASE_URL=https://api.deepseek.com/v1
ANTHROPIC_API_KEY=sk-ant-xxxxxx

# ── 运维与安全开关（按需）──
LOG_LEVEL=info                          # error | warn | info | debug
VUAGENT_ALLOW_PRIVATE_FETCH=1           # 允许 web 工具访问内网地址（默认禁止）
VUAGENT_BASH_ENV_POLICY=allowlist       # bash 子进程环境策略
```

| 旧名（不生效） | 真名（生效） |
|---|---|
| `HOST` | `VUAGENT_HOST` |
| `SQLITE_DB_PATH` | `DB_PATH` |
| `STORAGE_DRIVER=redis` | `REDIS_URL`（配置即启用 Redis 形态） |
| `AUTH_BEARER_TOKEN` | `VUAGENT_TOKEN` |
| `DEFAULT_PROVIDER` / `DEFAULT_MODEL` / `DEFAULT_API_KEY` / `DEFAULT_BASE_URL` | `OPENAI_API_KEY` / `OPENAI_BASE_URL`，或在 console「设置 → 供应商」配置 |

::: warning 0.6.x 及更早文档中的废弃变量
`SQLITE_DB_PATH`、`STORAGE_DRIVER`、`AUTH_BEARER_TOKEN`、`DEFAULT_PROVIDER`、`DEFAULT_MODEL`、`DEFAULT_API_KEY`、`DEFAULT_BASE_URL`、`HOST` **代码从不读取**（旧文档漂移）。请按上表改用 `DB_PATH` / `REDIS_URL` / `VUAGENT_TOKEN` / `OPENAI_*` / `ANTHROPIC_API_KEY` / `VUAGENT_HOST`。
:::

---

## 存储模式：SQLite vs Redis

| 模式 | 适用场景 | 优势 | 注意事项 |
| :--- | :--- | :--- | :--- |
| **SQLite (默认)** | 单机部署、开发环境、中轻量内部系统 | 零运维依赖、开箱即用、单文件便携备份 | 仅支持单实例运行，不适用于多 Pod 负载均衡 |
| **Redis** | 企业级高可用集群、云原生多实例部署 | 支持分布式 Pub/Sub 事件广播、共享会话锁与重放缓冲 | 需要外部高可用 Redis 服务支撑 |

---

## Docker 容器化部署

### 1. 编写 Dockerfile

```dockerfile
FROM node:20-alpine AS runner
WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 拷贝代码依赖清单并安装
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=6880
EXPOSE 6880

CMD ["pnpm", "--filter", "@vuagent/server", "start"]
```

### 2. 编写 docker-compose.yml

```yaml
version: "3.8"

services:
  vuagent-server:
    build: .
    ports:
      - "6880:6880"
    environment:
      - PORT=6880
      - VUAGENT_HOST=0.0.0.0
      - VUAGENT_TOKEN=${VUAGENT_TOKEN:?对外绑定必须配置}   # 未配置时服务拒绝启动
      - DB_PATH=/data/harness.db
      - LOG_LEVEL=info
    volumes:
      - vuagent_data:/data
    restart: always

volumes:
  vuagent_data:
```

---

## 健康检查与可观测性

* **健康检查端点**：`GET /health`，返回 `200 OK {"status":"ok","uptime":1283}`，用于 K8s liveness / readiness 探针；
* **模型发现与探针**：`GET /api/settings/providers/:id/models/discover`，用于验证指定模型供应商的端点与凭据是否有效；
* **可观测性双轨**：
  * **运维侧**：标准结构化 stdout JSON 日志，便于接入 ELK、Prometheus / Grafana 或云厂商日志系统；
  * **用户侧**：向前端广播 `traj`（轨迹）与 `usage`（Token 水位）事件，前端直接呈现进度台账。
