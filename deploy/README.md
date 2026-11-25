# deploy/ — 容器化部署

本目录提供 @vuagent/server 的容器化运行样例：`Dockerfile`（node:22-alpine 多阶段，non-root + HEALTHCHECK）与 `docker-compose.yml`（server + 可选 Redis + named volume 数据持久化）。

## 起停

```bash
cd deploy

# 基础形态（SQLite 单副本，数据落 named volume vuagent-data）
VUAGENT_TOKEN=$(openssl rand -hex 32) docker compose up -d --build

# 验证健康
docker compose ps                       # STATUS 应为 healthy
curl -s http://127.0.0.1:6880/api/health

# 跟踪运维日志（NDJSON，可用 jq 过滤）
docker compose logs -f server

# 可选 Redis 分布式形态（--profile redis；另需放开 server.environment 的 REDIS_URL 注释）
docker compose --profile redis up -d --build

# 停机
docker compose down          # 保留数据卷
docker compose down -v       # 连数据卷一并清除（谨慎）
```

镜像也可脱离 compose 直接构建：`docker build -f deploy/Dockerfile .`（构建上下文为仓库根）。运行形态说明（为何容器内以 node 直跑、tsx 经 `--import` 装载）见 Dockerfile 头部注释。

## 安全注意（务必阅读）

- **令牌即执行权**：容器内监听 `0.0.0.0`（端口映射的前提），绑定闸门要求必须配置 `VUAGENT_TOKEN`，否则服务拒绝启动。compose 已把该变量设为必填（未设置即拒绝起容器）。令牌请勿提交仓库或打进日志。
- 完整威胁模型与防线表见 [`packages/server/README.md`](../packages/server/README.md)「安全模型」一节；对外暴露建议收口到反向代理（TLS）并把宿主端口绑定到 `127.0.0.1`，仅代理可达。
- 仅限隔离网络联调的显式豁免：`VUAGENT_ALLOW_UNSAFE_NETWORK=1`（会以横幅警告进日志），替代令牌的逃生门，不要在生产使用。
- 数据卷 `vuagent-data` 挂在容器内 `/app/.vuagent`（SQLite 库文件）。SQLite 形态不支持多副本共享——横向扩容请启用 Redis profile 并阅读 server README「Redis 分布式形态的已知边界」。

## 环境变量

全量模板见根目录 [`.env.example`](../.env.example)；容器内通过 `server.environment` 注入（仓库不自动加载 `.env` 文件）。常用项：

| 变量 | 说明 |
| --- | --- |
| `PORT` | 容器内监听端口（缺省 6880） |
| `VUAGENT_HOST` | 容器内固定 `0.0.0.0`（端口映射前提），配合 `VUAGENT_TOKEN` |
| `VUAGENT_TOKEN` | Bearer 令牌，compose 必填 |
| `DB_PATH` | 固定 `/app/.vuagent/harness.db`（volume 挂载点） |
| `REDIS_URL` | 启用 Redis 分布式形态（配合 `--profile redis`） |
| `LOG_LEVEL` | 日志可见度 error/warn/info/debug（缺省 info） |
