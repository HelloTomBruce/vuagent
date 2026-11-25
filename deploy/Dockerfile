# Vuagent Server 容器镜像（TASK-095）
# 用法：docker build -f deploy/Dockerfile .（构建上下文 = 仓库根，见 deploy/docker-compose.yml）
#
# ── 跑法取舍：源码进镜像 + tsx 装载，而非 tsc 产物 ───────────────────────────
# 本仓库是 pnpm workspace，且 packages/protocol 与 packages/server 的 package.json
# exports 在「仓库内」形态都指向 src/*.ts（dist 入口仅存在于 publishConfig，发布时才生效）。
# 若运行镜像跑 tsc 产物（node dist/index.js），@vuagent/protocol 仍会经 workspace
# 软链解析到 protocol 的 src/*.ts——纯 Node 无法加载 .ts，必须再改写包清单或改用
# 打包器，得不偿失。因此选择：源码进镜像 + tsx 运行时（tsx 为全局依赖，4.x 自带
# esbuild，无需额外转译配置）。
#   · builder 阶段因此只做一次 prod 依赖安装，不做 tsc 构建：运行镜像无任何构建
#     产物可装，tsc 编译自检属 CI 门禁（ci.yml typecheck/build），放进镜像构建会把
#     「镜像可构建性」与主干在途的类型修复耦合，弊大于利（实测 Sandbox 推演确认）。
#   · tsx 是 server 的 devDependency（不进 prod 安装树），故运行阶段单独全局安装；
#     运行镜像只带 server + protocol 两个 workspace 成员（源码 + prod deps）+ 全局
#     tsx；ui / playground / docs / examples 与服务器运行时无关，不进镜像。
#   · 启动形态为 `node --import tsx`（NODE_PATH 指向全局 node_modules 供解析）：
#     node 本尊作 PID1 原生接收 SIGTERM，优雅停机链（20s 抽干）在容器中真实生效
#     ——若由 tsx 包装进程作 PID1，信号转发未经验证，docker stop 超时即 SIGKILL。
# ─────────────────────────────────────────────────────────────────────────────

# ========== 阶段一：prod 依赖安装（dev deps 不进镜像） ==========
FROM node:22-alpine AS builder

# pnpm 大版本与 CI（pnpm/action-setup version: 12）对齐；lockfile 为 v9 格式
RUN npm install -g pnpm@12

WORKDIR /app

# 1) 全部 workspace 成员的 package.json 先于源码进场：
#    pnpm install --frozen-lockfile 要求 lockfile 中每个 importer 的清单在场，
#    缺一个即「lockfile 与 workspace 不一致」失败。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/ui/package.json packages/ui/
COPY apps/docs/package.json apps/docs/
COPY apps/playground/package.json apps/playground/
COPY examples/server/package.json examples/server/
COPY examples/agent-gallery/package.json examples/agent-gallery/

# 2) 仅 prod 依赖树（tsx/typescript 等 dev deps 一律不进镜像，见文件头取舍说明）；
#    prune 清扫 install --prod 残留的孤儿 store 条目（实测 .pnpm 360 → ~52 条目）
RUN pnpm install --prod --frozen-lockfile && pnpm prune --prod

# 3) 运行时源码进场（tsx 直跑，无需编译）
COPY packages/protocol ./packages/protocol
COPY packages/server ./packages/server

# ========== 阶段二：运行镜像（prod deps + 源码 + tsx，non-root） ==========
FROM node:22-alpine

# tsx 经 --import 装载（取舍说明见文件头）；busybox wget 为 alpine 自带，HEALTHCHECK 免装包
RUN npm install -g tsx@4 \
  && addgroup -S vuagent \
  && adduser -S vuagent -G vuagent

# 数据目录显式钉到镜像级固定路径，named volume 挂载点稳定（覆盖 .vuagent 相对路径缺省）
ENV NODE_ENV=production \
  PORT=6880 \
  DB_PATH=/app/.vuagent/harness.db

WORKDIR /app

# 从 builder 原样搬运（pnpm 的 node_modules 为相对符号链接，目标路径一致故仍可解析）
COPY --from=builder --chown=vuagent:vuagent /app/node_modules ./node_modules
COPY --from=builder --chown=vuagent:vuagent /app/packages/protocol ./packages/protocol
COPY --from=builder --chown=vuagent:vuagent /app/packages/server ./packages/server

# 数据目录预建并归属运行用户（挂 named volume 时 Docker 会继承该属主）
RUN mkdir -p /app/.vuagent && chown vuagent:vuagent /app/.vuagent

USER vuagent
WORKDIR /app/packages/server

EXPOSE 6880

# 存活探针：/api/health 免鉴权（健康检查在 Bearer 白名单内），busybox wget 对
# 4xx/5xx 以非零码退出，天然可用作探针。注意：发布端口前需 VUAGENT_HOST=0.0.0.0
# + VUAGENT_TOKEN（绑定闸门，见 deploy/docker-compose.yml 安全默认）。
# 探针钉在 127.0.0.1——0.0.0.0 绑定覆盖回环故可用；若自定义 VUAGENT_HOST 钉到
# 具体外网 IP（不覆盖回环），需同步改本探针地址。
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:6880/api/health || exit 1

# node 作 PID1（审查 V1 修复）：tsx 直跑时 tsx 包装进程是 PID1，SIGTERM 是否被
# 其转发给 node 子进程未经验证——若不转发，优雅停机整条链（20s 抽干）在容器中
# 形同虚设，docker stop 超时后 SIGKILL。改为 node 直跑（--import tsx 装载 TS），
# node 原生接收并处理 SIGTERM（index.ts 的 shutdown 链直接生效）。
# NODE_PATH 指向全局 node_modules 使 --import tsx 能解析全局安装的 tsx 包。
# index.ts 的直跑判定按 argv[1] 路径尾匹配 "packages/server/src/index.ts"，
# 本 WORKDIR + 相对脚本路径恰好命中，serve/绑定闸门逻辑照常生效。
ENV NODE_PATH=/usr/local/lib/node_modules
CMD ["node", "--import", "tsx", "src/index.ts"]
