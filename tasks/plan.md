# Implementation Plan: 运营体验闭环（多模态回显 · FinOps 可视化 · 能力验证 · 文档站指南）

## Overview

上一轮「能力驱动运行时」把档位/图片/输出上限送进了真实请求，本轮补齐**用户看得见的最后一公里**，四个方向按依赖排为四个 Phase：

- **Phase 1 多模态体验闭环**：图片发出去就从界面消失的断点、档位会话级隔离、真实端点验收；
- **Phase 2 FinOps 成本可视化**：分档计价数据已落库但前端零可见——补成本 API 与面板；
- **Phase 3 能力声明验证**：手勾能力 vs 真实行为可能漂移——「验证能力」探测；
- **Phase 4 文档站 server 指南**：docs 站只有组件文档，宿主接入者无 /api/chat 契约与部署指引。

Phase 1 与 Phase 2 无相互依赖，可并行推进；Phase 3 弱依赖 Phase 1（复用探测模式）；Phase 4 收尾。

## Architecture Decisions

- **图片回显双层策略**：当日会话内（前端 `sessionTurnsCache`）用 dataUrl 显示真图；跨刷新历史回显**只落库轻量元数据**（`{name, kind, size}`），显示名字占位——不把 base64 落进 TurnEntity。理由：`sessions` 是单文档内嵌 turns 的存储形态，4 张 5MB 图片 × 多轮会把会话文档撑到不可用；诚实显示「[图] name」优于存储膨胀。后续若需持久缩略图，再评估服务端落盘引用（本迭代不做）。
- **档位会话级隔离**：`reasoningEffort` 从全局 ref 迁移为 `Map<sessionId, string>`（composable 内部），读取侧 computed 取当前会话值；模型切换重置语义保留（watch 依赖不变，写入目标改为 map）。会话维度与 `activeModel` 的会话级选择对齐。
- **成本 API 只读、复用既有仓储聚合**：`costRepo.sumWindow/sumWindowByModel` 已存在，Phase 2 服务端只加路由与配额余量拼装（finops admission 的限额配置同源读取），仓储层零改动。
- **能力验证 = 服务端代发最小探测**（复用 discover/models-test 的信任边界模式：凭据不出服务端、端点取自已存配置）：图片能力发 1×1 PNG 最小 chat；推理档位发最低档 effort 请求；按响应类别（成功 / 4xx 参数拒绝 / 网络失败）返回逐能力 verdict。**用户显式点击才触发**——探测产生真实 API 费用，不做自动后台验证。
- **文档站定位切分**：packages README 面向贡献者（架构决策、内部机制），docs 站 `guide/harness.md` 面向**宿主接入者**（怎么装、怎么调 /api/chat、事件流怎么消费、安全模型怎么配）——同一事实两个视角，互不搬运。MCP server 本期不立项（getting-started 的「规划中」标注改为 roadmap 链接）。
- **验收文化延续**：每个 Checkpoint 含浏览器端到端（隔离栈模式已成型：PORT=3111 + vite VITE_API_TARGET + 临时 DB）；Phase 1 的真实端点验收单独成任务（不可自动化的部分明确标注手动步骤）。

## Task List

### Phase 1: 多模态体验闭环（可与 Phase 2 并行）
- [ ] TASK-050 对话流图片回显（当日真图 + 历史占位）
- [ ] TASK-051 粘贴/拖拽上传门禁验证（已复用 filesSelected，补回归）
- [ ] TASK-052 推理档位会话级隔离
- [ ] TASK-053 真实端点验收（Anthropic thinking+tools / 真实视觉模型 / cached_tokens）

### Checkpoint 1: 多模态体验
- [ ] 发图后对话流立即可见缩略图；刷新后显示「[图] 名字」占位
- [ ] 粘贴截图与拖入文件走同一门禁（未声明模型被拒且带指引）
- [ ] 双会话切换档位互不串扰
- [ ] 全仓 test/typecheck 绿 + 浏览器回归记录

### Phase 2: FinOps 成本可视化（可与 Phase 1 并行）
- [ ] TASK-054 成本查询 API（窗口聚合 + 按模型分桶 + 配额余量）
- [ ] TASK-055 前端成本面板（token/USD 双口径、模型分桶、配额进度条）
- [ ] TASK-056 会话级成本徽标（会话列表行 + 轮次详情）

### Checkpoint 2: FinOps
- [ ] 配置计价表后面板金额与 cost_records 记账一致（抽查对账）
- [ ] 配额接近上限时预警样式生效（模拟配置验证）

### Phase 3: 能力声明验证
- [ ] TASK-057 服务端 verify-capabilities 探测端点
- [ ] TASK-058 设置面板「验证能力」交互与结果角标

### Checkpoint 3: 能力验证
- [ ] 勾选「图片」但端点拒绝的模型：验证返回明确 ✗ 与建议文案
- [ ] 探测凭据不出服务端（安全基线测试）

### Phase 4: 文档站 server 指南 + 收尾
- [ ] TASK-059 guide/harness.md 宿主接入指南
- [ ] TASK-060 docs 导航配置 + MCP 规划标注处理
- [ ] TASK-061 全量回归 + llms/registry 卡口 + 发布检查

### Checkpoint 4: Complete
- [ ] docs:build 通过、docs 站导航正确
- [ ] 全仓 test/typecheck + tokens/registry/protocol-sync 绿
- [ ] 四个 Phase 验收标准全部满足

## Risks and Mitigations

| 风险 | 影响 | 缓解 |
|------|------|------|
| 图片 dataUrl 全量驻留前端内存（长会话多图） | 中 | 回显用 `<img>` 直接引 dataUrl，移除会话时随 turn 缓存释放；超过 8 张图的会话只保留最近 4 张真图、更早降占位（阈值常量） |
| 成本面板与记账口径不一致引发信任问题 | 高 | 对账测试：面板聚合值 = sumWindow 结果 = cost_records 明细求和（三口径一致性断言） |
| verify-capabilities 探测产生真实费用 | 中 | 仅用户显式点击触发；请求前 toast 提示「将发起 N 次最小探测请求」；探测用 max_tokens=1/最低档压成本 |
| 真实端点验收依赖外部账号可用性 | 中 | TASK-053 标注为手动清单（提供脚本 + 记录模板），阻塞不阻塞合并——自动化部分（stub）已覆盖 |
| docs 站新增页面导致 llms/registry 卡口误报 | 低 | llms/registry 只扫描组件与 ui 包，guide 页不在扫描面；docs:build 过即可 |

## Open Questions

- 会话列表成本徽标是否默认展示（>0 才显示 vs 恒显）？默认 **>0 才显示**，无记账（未配计价表）时徽标隐藏。
- verify-capabilities 的探测超时与并发：串行探测、单项 15s 超时（复用 discover 口径）——可接受？
- harness.md 是否包含 Redis 分布式形态？默认**只写单机 SQLite 形态**，Redis 一句话带过链接到 server README（避免双维护）。
