# 部署与生产运维实践

> `@vuagent/server` 是面向生产设计的 Node.js 服务端，启动迅速、架构无守护污染，能够以最小成本集成进现代容器编排与云原生基建中。

---

## 快速启动

::: code-group

```bash [开发模式 (热重载)]
pnpm --filter @vuagent/server dev
# 默认监听 http://localhost:3001
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
# 服务端口与主机
PORT=3001
HOST=0.0.0.0

# 安全基线配置
# 允许的前端跨域 Origin，多个用逗号分隔
CORS_ORIGIN=http://localhost:5173,https://my-admin.company.com
# 服务接口鉴权 Token（若配置，前端请求需携带 Authorization: Bearer <TOKEN>）
AUTH_BEARER_TOKEN=my_production_secure_token

# 存储模式: "sqlite" (默认单机) 或 "redis" (高可用分布式)
STORAGE_DRIVER=sqlite
SQLITE_DB_PATH=./data/vuagent.db

# 若使用 Redis 模式
REDIS_URL=redis://:password@10.0.0.8:6379/0

# 全局模型默认配置（可选，亦可在 UI 设置中心在线配置）
DEFAULT_PROVIDER=openai
DEFAULT_MODEL=deepseek-chat
DEFAULT_API_KEY=sk-xxxxxx
DEFAULT_BASE_URL=https://api.deepseek.com/v1
```

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
ENV PORT=3001
EXPOSE 3001

CMD ["pnpm", "--filter", "@vuagent/server", "start"]
```

### 2. 编写 docker-compose.yml

```yaml
version: "3.8"

services:
  vuagent-server:
    build: .
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - CORS_ORIGIN=http://localhost:5173
      - STORAGE_DRIVER=sqlite
      - SQLITE_DB_PATH=/data/vuagent.db
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
