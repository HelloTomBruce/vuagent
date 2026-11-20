# @vuagent/server

Vuagent Agent Harness 服务端：以 ReAct 循环驱动模型与工具的协作，内建 HITL 审批中断、工具沙箱、会话级检查点、渐进式 SSE 流与双轨可观测。

## 快速开始

```bash
pnpm install

pnpm --filter @vuagent/server dev          # 开发热载（tsx watch），默认 http://localhost:3001
pnpm --filter @vuagent/server start        # 直跑（tsx，免构建），部署用此入口 + 环境变量
pnpm --filter @vuagent/server test         # 全量测试
pnpm --filter @vuagent/server verify:redis redis://127.0.0.1:6379  # Redis 形态部署验证
```

无模型凭据时服务照常启动：内置无密钥沙箱演示分支（固定脚本渲染计划/差异/终端卡片）引导配置真实模型；配置凭据后即走真实执行路径。进程管理与容器化按部署方惯例包装 `start` 入口即可（服务自身无守护语义）。

## 总体架构

服务端是一条「HTTP 准入 → 执行枢纽 → ReAct 循环 → 工具沙箱 → 模型驱动」的分层链路，横切四块基础设施（存储 / 配置中心 / 安全基线 / 可观测）：

```
 HTTP 层（Hono 路由 + 安全基线）
 │  Origin 白名单 / Bearer 鉴权 / apiKey 脱敏 / providerConfig 边界
 │  轮次准入洋葱管线：并发门禁 → 配额门禁（core/admission.ts，可组合中间件）
 ▼
 会话执行枢纽（SessionExecutionHub）
 │  执行与 HTTP 连接解耦：后台执行 · 事件重放 · 多端订阅 · 并发仲裁
 ▼
 ReAct 主循环（AgentLoop）
 │  配置解析 → 上下文组装 → [模型流式响应 → 卡片收敛 → 工具执行段 → 结果喂回] × N → 终态收尾
 │      │                                   │
 │      │ 上下文压缩器                        │ 工具执行段（守卫链 core/tool-guards.ts）
 │      │ (token 预算 / 滑动窗口)            │ 启停仲裁 → 工作区闸门 → 权限交集
 ▼      │                                   │ → HITL 审批 → 沙箱执行 → 结果入上下文
 模型驱动层（IModelDriver）
    OpenAI 兼容 + Anthropic 原生驱动 + 韧性层（错误分类 / 指数退避 / 降级链）；可注入测试替身

 横切：存储（SQLite / Memory 仓库层）· 配置中心（schema 驱动 + env 强制锁）
       安全基线 · 可观测双轨（运维 sink + UI 轨迹台账）
```

### 一次对话的完整生命周期

1. **准入**：安全基线校验（Origin / 鉴权 / providerConfig 边界）→ 并发仲裁（同会话已有运行则拒绝或顶替）；
2. **落 running 行**：轮次记录即时入库，进程崩溃后可被诚实恢复（见下）；
3. **ReAct 回环**：每轮先按请求 ∩ 全局配置解析执行参数（maxSteps / 审批超时 / 上下文预算），再进入「模型流式响应 → 工具执行段」循环，直至模型不再发起工具调用、触及步数上限或看门狗超时；
4. **工具执行段**（每步）：启停仲裁（禁用即移出模型可见定义 + 调用侧兜底报错）→ 工作区闸门（read-only 工作区拦截写工具）→ 权限交集判定 → 高风险工具转 HITL 挂起 → TypeBox 入参校验 + 超时竞速执行 → ui_* 卡片原地收敛 → 结果就地喂回上下文；
5. **终态收尾**：done/error 幂等替换 running 行、token 用量与成本记账、轨迹台账落库、`turn_end` 广播。

所有落库路径均为 best-effort / fail-open：持久化故障不阻断主链路，但会以运维事件显式告警。

## 核心设计决策

### 执行与 HTTP 连接解耦

这是全服务端最重要的架构决策。若 Agent 执行生命周期绑定在单一 SSE 连接上，用户切换会话、断网刷新都会杀死执行中的任务。会话执行枢纽把两者拆开：

- **后台持续执行**：Agent 循环在枢纽内运行，事件进缓冲区；HTTP 连接只是缓冲区的订阅者，断了重连即可；
- **事件重放缓冲**：重连或切回会话时按序重放全部事件，`seq` 广播序号支持增量去重；
- **多端订阅**：多个 SSE 连接（多标签页 / 多设备）可同时监听同一运行中的会话；
- **并发语义**：同会话同时只允许一轮执行（冲突返回 409）；新请求可「顶替」旧轮——旧轮标记中止后**继续抽干事件流直至落库完成**，保证不丢已产生的进度。

### 权限模型：交集解析 + 同源声明

- 生效权限模式 = **请求级 ∩ 会话级，更严者生效**（auto < review < read-only）；请求未声明默认 `review`，未识别值按 `review` 降级——安全语义 fail-closed，绝不放行；
- 系统提示词中声明的模式与工具仲裁强制执行的模式**来自同一个纯函数**：模型被告知的规则与引擎执行的规则同源，口径漂移在结构上不可能；
- 审批覆盖是 **deny-wins**：配置可以为低风险工具追加审批，但不会放宽既有的高风险推导——安全项只能升不能降。

### HITL 审批：挂起协程而非轮询

高风险工具调用时，工具执行协程整体挂起（Promise 语义），审批决策经 HTTP 回调直达唤醒；超时自动拒绝（`reason: "timeout"`），用户中止同理。挂起记录按会话索引，跨会话审批收件箱凭此跳转。审批是**恢复点也是检查点**：决策连同上下文快照落库，崩溃后恢复不丢审批现场。

### 上下文管理：按 token 而非按轮次

- 预算以 token 为口径（tokenizer 计数）：自动滑动窗口保留最近轮次 + 摘要折叠更早历史。按轮次保留不可控——轮次间的 token 差异可达两个数量级；
- 手动压缩注入摘要占位消息，被折叠轮次彻底退出上下文；历史重建按逐轮 checkpoint 快照回放**本提问之后**的消息，避免逐轮全量重放导致内容成倍重复；
- 单条工具结果超长截断，`usage` 事件按「系统提示 / 历史 / 工具」三段下发水位估算，前端上下文仪表直接消费。

### 模型层：诚实重试边界 + 按序降级链

韧性层对请求失败分类（鉴权 / 限流 / 服务端 / 网络 / 上下文溢出等）并按分类决定指数退避重试（尊重 `Retry-After`）。关键边界：**只重试「HTTP 响应返回之前」的失败**——流已开始吐字后的中断不做透明重跑，因为调用方已消费增量，重跑会重复输出。这类失败按已分类错误上抛，由上层决定策略。

在重试耗尽之上，主档案可配置**按序降级链**（`execution.modelFallbackIds`）：仅流开始前的限流 / 服务端 / 网络类失败触发切换备用档案（凭证错、请求非法、窗口溢出换档案无意义，不降级），切换经轨迹事件与 `model_fallback` 运维事件双轨可见。

### 执行预算：三维熔断

单轮执行受三道预算闸约束，超限自动中止并保留已完成进度：

- **步数**：`maxSteps`（模型-工具往返上限）；
- **墙钟**：`turnTimeoutMs` 整轮看门狗；
- **token**：`maxRunTokens` 单轮累计消耗（输入+输出计费口径跨步求和）——防单轮跑飞，与跨请求的滚动窗口配额（finops 准入）互补。

### 上下文窗口动态解析

生效窗口 = 档案显式值 > 模型名前缀查表（保守档位，宁小勿大）> 未知模型回落 128k，最终钳制在 [8k, 2M]——修正档案漏填/错填导致的过早压缩或滑动窗口失效，`usage` 事件与前端仪表使用同一解析结果。

### 显式终态协议：finish_task + 交付断言

`execution.finishTaskMode` 提供两档语义：

- **off（默认）**：自然停机——模型不再调用工具即完成，finish_task 对模型不可见（引擎侧条件过滤，不进 `/api/tools` 启停语义）；
- **enforced**：finish_task 进入模型可见 definitions，系统提示词同源声明「完成必须显式宣告」；宣告经**交付断言**裁决（可插拔 `deliverableAssertion`，默认非空正文/卡片守卫）——通过 → 轮次以 `finishReason: "explicit"` 收尾；未通过 → 结构化驳回文案回喂模型继续产出。自然停机同样过断言：空跑不放行，注入纠偏指令继续执行。

防的是「模型说做完就做完」的空跑闭环；三种收尾形态（explicit / natural / truncated）落库为 `turn.finishReason`，运维事件与轨迹同步可见。

### 配置中心：schema 驱动 + env 强制锁

- 全部配置项由一份 schema 声明（字段类型 / 默认值 / 边界 / 风险等级 / env 锁），服务端持 schema，前端设置页表驱动渲染——**新增配置项零组件改动**；
- 读路径容错（损坏值回落默认），写路径严格（未知字段 / 类型不符 → 400），数值越界钳制；
- **env 是部署级强制锁**：环境变量一旦显式设置，对应字段生效值由 env 决定、API 一律拒绝改写；env 值不可解析时 fail-closed 回落字段默认——管理员的拼写错误不会静默放行存储层配置；
- 配置无缓存、逐次读库：PATCH 后下一轮执行、下一次工具调用即生效。

### 可观测双轨 + Prometheus / OTLP 出口

面向两类读者，刻意分离：

- **运维轨**：类型化事件出口（NDJSON），带可 grep 的错误分类码（模型面 / 工具面 / 轮次生命周期 / 准入恢复），供日志采集器结构化摄取；同一事件流并行驱动 **Prometheus 指标注册表**（`GET /metrics` 文本格式拉取，配置 `VUAGENT_TOKEN` 后同样要求 Bearer）与**可选 OTLP 推送**（设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 即启用，OTLP Logs JSON 推 collector，fail-open）；不落库，随进程注入；
- **产品轨**：轨迹台账（lane × role 时间线、TTFT、步数、token、成本）落库，前端执行轨迹回放直接消费。

进程重启时的恢复策略是**诚实标记**：扫描遗留的 running 轮次，标记为 `error/process_restart`——不做「假装可续跑」，崩溃前已完成的 checkpoint 与内容原样保留可查。

### 沙箱演示分支

无模型凭据时的演示轮次（固定脚本渲染计划/差异/终端卡片）与 ReAct 主流程完全隔离，演示内容不进入主循环，主流程保持纯净。

## 安全模型

**定位：默认形态是「本地单用户开发工具」，不是多租户服务。** 服务端具备执行任意本地命令的能力（bash 工具 + 工作区 rootPath），因此默认把信任边界收紧到本机。

### 威胁模型

恶意网页驱动 localhost 服务（跨站请求 / DNS rebinding）：携带任意工作区路径 → 自动执行档 → 任意命令，形成 RCE 链。同机其他端口上被攻陷的开发服务同属此威胁面。

### 默认边界（零配置即安全）

| 防线 | 行为 |
| --- | --- |
| Origin 白名单 | 仅放行本地前端 Origin；其余 Origin 的请求服务端直接 403（不只是不下发 CORS 头）；无 Origin 头的请求（同源 / 非浏览器客户端）放行 |
| Bearer 鉴权 | 默认关闭（本地白名单已够用）；设置 `VUAGENT_TOKEN` 后 `/api/*` 全部要求令牌（健康检查免检）；启用后 CORS 放开，访问由令牌把守 |
| apiKey 脱敏 | 模型配置的一切响应不含明文密钥，只回显掩码（末 4 位）；明文仅存服务端；PATCH 掩码值视为「保持原密钥」 |
| providerConfig 边界 | 默认拒绝前端自带供应商配置（任意 baseUrl 转发 = SSRF + 凭据外带面），仅允许切换服务端已登记的模型档案；显式开启 BYO 模式后风险自担 |
| 私网访问 | web_fetch 默认拒绝私网 / 本机地址（SSRF 防护），env 显式放行且锁定配置项 |

风险声明：开启远端访问等于把本机执行权暴露给令牌持有者；生产部署需要 TLS + 完整多租户隔离（另行规划）。

## 启动与部署

### 运行环境变量（运维面）

| 变量 | 作用 | 缺省 |
| --- | --- | --- |
| `PORT` | HTTP 监听端口 | `3001` |
| `DB_PATH` | SQLite 数据库文件路径 | `.vuagent/harness.db` |
| `REDIS_URL` | Redis 分布式形态开关（见下节），如 `redis://:password@host:6379/0` | 不设 = 单副本 |
| `VUAGENT_INSTANCE_ID` | 本副本实例标识（租约归属与清扫目标）；建议取 pod 名等部署侧稳定标识 | `os.hostname()` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP Logs 推送端点，设置即启用运维事件推送 | 不设 = 仅本地双轨 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `DEFAULT_MODEL` | 兜底模型凭据（未登记任何档案时使用） | — |

安全相关环境变量（`VUAGENT_TOKEN` / `VUAGENT_ALLOW_BYO_PROVIDER` / `VUAGENT_ALLOW_PRIVATE_FETCH` / `VUAGENT_CORS_ORIGINS`）见「安全模型」一节。

### 存储形态

| | 单副本默认 | Redis 分布式形态 |
|---|---|---|
| 存储驱动 | SQLite（`DB_PATH`）/ 内存（测试） | `RedisStorageDriver` |
| 共享范围 | 进程内 | 全部持久化实体（工作区 / 会话与轮次历史 / 模型档案 / 工具配置 / 服务端配置 / 成本台账） |
| 轮次互斥 | 进程内（running → 409 / preempt 顶替） | 进程内裁决 + 跨副本租约（`vuagent:lease:<sessionId>`，SET NX PX） |
| 事件 / HITL 审批 | 进程内 | **仍为进程内**（见「已知边界」） |
| 启用方式 | 不设 `REDIS_URL` | 设置 `REDIS_URL`（ioredis 为 optional peer，自动安装；未装时启动给出可读指引） |

**`REDIS_URL` 在哪里配置**：直跑入口（`start` / `dev`）从**启动时的 shell 环境**读取——

```bash
export REDIS_URL=redis://127.0.0.1:6379      # 或带密码：redis://:password@redis-host:6379/0
pnpm --filter @vuagent/server start
```

仓库不自动加载 `.env` 文件（无 dotenv 依赖）；全量变量模板见根目录 [`.env.example`](../../.env.example)。编程式集成（宿主 import `createHarnessServer`）不走该环境变量，改经 `ServerOptions.redisClient` 注入客户端实例——客户端创建是异步的，必须发生在服务装配之前。`pnpm console` 同样继承父 shell 环境。

租约语义：`acquire` = SET NX PX 原子互斥；`heartbeat`/`release` 为原子 Lua，按 instanceId+turnId 语义匹配（不为他副本续命/误删）；运行期按 `ttl/3` 心跳，连续失败达阈值**中止本副本轮次**（TTL 过期后他副本可重取，防双主）；抽干落库后释放；启动时 `sweepOrphans` 清理本实例崩溃遗留。全程 fail-closed：Redis 不可达时拒绝开轮，绝不无锁双跑。键空间与一致性边界详见「存储方案」。

**部署验证**：`pnpm --filter @vuagent/server verify:redis "$REDIS_URL"` 一键执行等价检查（驱动往返 / SCAN / EVAL / 跨副本互斥与释放 / 心跳保活 / 启动清扫 / fail-closed），已于 Redis 8.10.1 实测 11/11 通过。人工排查单点时按序核对：PING → SET/GET/TTL → `SCAN 0 MATCH vuagent:* COUNT 100` 未被禁用 → `EVAL "return 1" 0` 可用（托管 Redis 需开通）→ 双副本互斥与释放。

### 可观测部署

- **Prometheus 拉取**：`GET /metrics`（文本格式 v0.0.4）；配置 `VUAGENT_TOKEN` 后同样要求 Bearer（scrape 配置带 `bearer_token`）；
- **OTLP 推送**：设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 即启用运维事件推送（Logs JSON，fail-open 不影响主链路）；
- **本地日志**：console NDJSON 带可 grep 错误分类码。

### Redis 分布式形态的已知边界

1. **ActionHub（HITL 审批等待/唤醒）仍是进程内**：跨副本时审批中断可能落在 A 副本、回调打到 B 副本唤醒不到，需 Redis pub/sub 唤醒通道（后续任务）；
2. **事件缓冲重放仍是进程内**：跨副本 SSE 重连无法从其他副本重放（后续任务：事件流外置）；
3. **session 文档读-改-写非原子**：轮次租约保证主执行路径互斥后冲突面大幅缩小，但管理类接口（重命名 / 置顶 / 并发改配置）跨副本并发仍需注意；
4. **list/clear 是全域 SCAN**：集合大时为 O(keyspace) 扫描，数据量大后可引入分页或二级索引；
5. **无跨键事务**：仅租约两段 Lua 是原子的，依赖多键一致性的场景需仓储层自行设计；
6. **apiKey 明文入 Redis**：与 SQLite 形态同等存储明文密钥，Redis 的访问控制与加密（TLS/ACL/静态加密）是部署方责任。

## 存储方案

### 分层：领域仓库 → 可替换驱动

服务端的数据访问统一收敛在**领域仓库层**（六个 Repository：工作区 / 会话 / 模型档案 / 工具配置 / 服务端配置 / 成本记录），仓储层之上是引擎与路由，之下是 `IStorageDriver` 可替换驱动——引擎与路由**只经仓储说话**，不感知物理介质：

```
 引擎 / 路由（AgentLoop · Hub · ActionHub · Hono）
    │  只依赖仓储接口（fail-open，落库失败不阻断主链路）
    ▼
 领域仓库层（6 个 Repository，读写唯一入口；get→mutate→set 域语义）
    │  get / set / list / delete（collection + id 抽象）
    ▼
 IStorageDriver 可替换驱动
    ├── SQLiteStorageDriver   默认单副本（单文件，落 DB_PATH）
    ├── RedisStorageDriver    分布式形态（REDIS_URL 启用，跨副本共享）
    └── MemoryStorageDriver   测试 / 临时形态
```

### 存了什么：持久化实体与派生数据

六个 collection（Redis 形态下即 `vuagent:<collection>:<id>` 键空间）：

| collection | 实体 | 说明 |
|---|---|---|
| `workspaces` | 工作区 | rootPath / 权限档 / 忽略规则 / 工作区级指令 |
| `sessions` | 会话 + 轮次 + 检查点 | 一条会话文档内嵌全部 turns（含逐轮 checkpoints 快照与轨迹明细） |
| `model_profiles` | 模型档案 | 含服务端保管的 apiKey（一切对外响应只回显掩码） |
| `tool_configs` | 工具策略 | 启停 / 超时覆盖 / 审批覆盖（deny-wins） |
| `harness_config` | 服务端配置 | 配置中心各命名空间的存储覆盖集（env 锁定项不受存储影响） |
| `cost_records` | 成本台账 | 每轮 token 与 USD 记账，滚动窗口配额的数据源 |

两类**派生数据**值得单独说明：① 逐步 checkpoint（`messagesSnapshot`）——每步工具执行后保存完整消息快照，是历史重建（按快照回放而非重跑模型）、上下文压缩折叠与崩溃恢复的基石；② 轨迹台账——lane×role 事件明细随轮次落库，前端执行轨迹回放直接消费。

**进程内状态**（刻意不持久化）：Hub 的活跃执行与事件重放缓冲、ActionHub 的挂起审批、准入计数器。Redis 形态下它们仍留在各副本内——这是「已知边界」中跨副本审批唤醒与事件重放两项的根源。

### 一次轮次的数据写入时序

```
开轮 → running 行即时落库（中途崩溃留痕）
  ↓ 每步
增量进度落盘（正文/思考/卡片/步数/checkpoint/上下文水位，best-effort）
  ↓ 终态
幂等 upsert（done/error 替换 running 行，含 finishReason/abortedReason 徽标）
  ↓ 收尾
成本记账（按定价表折算 USD，fail-open）+ 历史会话的轨迹明细恢复可用
```

落库全路径 fail-open：持久化故障不阻断执行链路，二次失败以 `TURN_PERSIST_FAILED` 运维事件显式告警。进程重启时的恢复策略是**诚实标记**：遗留 running 轮次标为 `error/process_restart`，崩溃前已完成 checkpoint 原样可查，不做「假装可续跑」。

### 驱动形态与键空间（Redis）

Redis 驱动统一键名 `vuagent:<collection>:<id>`（id 经 URL 编码，`*` 补编码防 SCAN glob 污染）；租约使用独立键空间 `vuagent:lease:<sessionId>`（值 = `{instanceId, turnId, acquiredAt}` JSON）。TTL 语义：仅租约带 TTL（心跳续期），持久化实体不过期（与 SQLite 形态对齐）；`list/clear` 基于 SCAN 游标（不用 KEYS）。一致性边界：单键操作原子，仓储层读-改-写非原子（轮次租约互斥后主执行路径无竞态，管理类接口跨副本需注意），无跨键事务；`model_profiles` 明文入 Redis 的访问控制与加密是部署方责任。

驱动替换不改任何上层代码：宿主经 `ServerOptions.storageDriver` 注入，或生产直跑时设 `REDIS_URL` 自动启用（形态对比与部署验证见「启动与部署」）。

## 测试

```bash
pnpm --filter @vuagent/server test   # vitest：安全基线 / 权限矩阵 / 并发语义 / 崩溃恢复 / 契约回归 / 成本记账 等 37 个套件
```
