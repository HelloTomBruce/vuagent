# @vuagent/protocol

## 0.4.0

### Minor Changes

- 596f461: ## ⚠️ 升级注意（审查修复轮补记）
  
  - **会话拆表迁移不支持降级**：TASK-092 迁移后的库（主文档 `turns: []` + 独立轮次行）不能被旧版本代码打开（旧版读成空会话并可能交错覆盖）。升级前备份 `DB_PATH`；回滚版本必须连数据文件一起回退（详见 packages/server/README「存储布局」）。
  - 限流装配顺序变更：限流中间件现注册在鉴权**之前**（鉴权失败路径计入限流，防令牌爆破）；无效令牌共享 IP 桶，仅有效令牌进指纹分桶。反代部署需设 `VUAGENT_TRUST_PROXY=1` 才采信 X-Forwarded-For（取末段）。
  - `/api/health?deep=1` 的 `checks.*.detail` 不再回显驱动层错误原文（免鉴权端点信息收口），原因明细改落服务端日志（`HEALTH_PROBE_FAILED`）。
  - `PATCH /api/sessions/:id` 响应不再内嵌 `turns` 数组（迁移修复后写路径返回 raw 形状，列表接口本就 meta-only）；依赖该字段的宿主请改走会话详情端点。
  
  三轮体系化强化（TASK-085~111）：
  
  **Server 安全（迭代 1）**
  - 默认安全绑定：仅监听 127.0.0.1，对外绑定需显式 VUAGENT_HOST + VUAGENT_TOKEN（否则拒绝启动，VUAGENT_ALLOW_UNSAFE_NETWORK 豁免）
  - 路由输入校验全覆盖（workspaces rootPath 策略 + VUAGENT_WORKSPACE_ROOTS 白名单 / sessions 元数据白名单 / models provider 枚举闸门）
  - web_fetch SSRF 重定向逐跳复检；/api/* 全局 1MB 请求体上限（chat 保留 32MB）
  - HTTP 限流（默认 240/min，探测端点独立 12/min）；bash 子进程环境净化（bashEnvPolicy=safe 白名单，密钥类变量剥离）
  - 全局错误收口（err.message 不外泄）+ x-request-id + secureHeaders + 日志脱敏
  
  **Server 性能与部署（迭代 2）**
  - SSE 心跳注释帧 + 按 seq 增量重连（Last-Event-ID/fromSeq，缺口诚实回退全量）
  - turn 落盘防抖批处理 + session 拆表迁移（turns 独立行存储，写放大消除，旧库读时合并兼容）
  - compactor 增量计数 / 成本聚合 SQL 下推 / 会话列表瘦身 / 工具并行执行（parallelTools 可关）
  - Dockerfile + compose + SIGTERM 优雅停机 + release workflow + health deep 探测 + LOG_LEVEL
  
  **Server 监控与 Harness（迭代 3）**
  - HTTP/SSE/进程指标扩展（时延直方图、route 模板归一）；OTLP traces 可选推送（traceparent 透传）
  - prompt caching 控制（Anthropic cache_control 断点，execution.promptCaching）
  - HITL 挂起 + 事件缓冲 Redis 外置（审批跨重启落账，孤儿决策诚实 delivered:false）
  - mid-turn resume 门控原型 + partial JSON 修复可观测 + 协议版本协商（426）
  
  **UI 动效体系（迭代 1~3）**
  - 动效/光影 token 扩展族（blur 四档/glow/渐变/stagger/shadow-4/stage 表面）+ motion.css 共享进出场协议 + useStagger
  - 消息流动效（user-bubble/assistant-turn 入场 + skeleton 交叉过渡）+ 流式渲染 rAF 合帧
  - 统一按压反馈/光斑基类/复制反馈标准 + 空状态动效化；16 个零动效组件清零
  - 新组件：VaSpotlightCard / VaScrimEdge / VaGradientBorder（running 态 conic 光环）；glass/noise 克制体系
  - runtime 共享流式消费件导出：consumeSSEStream / parseSSEChunk / createDeltaBuffer（TASK-114 双轨归一——useAgentChat 内部迁移至同一实现，SSE 解析升级支持跨 chunk 半包/CRLF/多行 data 合并；consumeSSEStream 泛型事件类型 + onParseError 钩子，createDeltaBuffer 帧调度器可注入，传输/调度均为扩展点）

## 0.3.0

### Minor Changes

- ee5e855: 协议契约成熟化（TASK-053~056）：HarnessStreamEvent TypeBox 运行时化（schema 唯一事实来源 + validateHarnessStreamEvent）；新增 turn_start/aborted 控制事件与全事件 seq 寻址；7 个系统工具入参 schema 收口（AllToolSchemas 全量聚合 + VuagentAllToolName）；UiComponentRenderResult.component 收口为 VuagentToolName 联合类型；子路径导出 ./stream ./tools ./system-tools ./lifecycle；README（消费矩阵/变更纪律/校验语义约定）。

### Patch Changes

- 135f11e: system-tools 新增 `finish_task` 显式终态声明 Schema（summary + 可选 deliverables 交付物清单）：`VuagentSystemToolSchemas` 注册表扩至 8 项，`VuagentSystemToolName` 联合同步扩展。配套 server 侧 `execution.finishTaskMode` 开关（off 时工具对模型不可见，契约对旧消费方前向兼容）。
- 135f11e: aborted 事件 reason 联合新增 `token_budget` 字面量：单轮累计 token 预算熔断（execution.maxRunTokens）触发的中止成因，非严格校验下对旧消费方前向兼容。
