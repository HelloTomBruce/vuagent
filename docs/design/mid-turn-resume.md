# Mid-turn Resume 设计（TASK-101 实验原型）

> 状态：**设计 + 门控原型**，不进默认路径。原型入口：`VUAGENT_EXPERIMENT_RESUME=1` + 程序化请求携带 `resumeFromCheckpointId`（HTTP 路由不暴露该字段）。
> 主张对齐：「诚实崩溃恢复」是产品证据链的一部分（落地页已校准该语义）——本设计的一切取舍以**不稀释诚实语义**为前提。

## 1. 目标与非目标

**目标**：进程崩溃/重启后，宿主可以显式选择「从最近 checkpoint 的步边界快照重建上下文续跑」，让长任务的已完成进度不白白丢弃。

**非目标（本轮明确不做）**：
- 自动续跑（崩溃后静默重开轮次）——与诚实语义直接冲突；
- 跨进程的执行协程迁移（HITL 挂起协程不可复活，见 §4）；
- 副作用工具的自动重放声明机制（见 §3，宿主声明式豁免仅作为设计预留）。

## 2. 语义设计

### 2.1 恢复单元 = checkpoint 步边界快照

- checkpoint 每步落库（TASK-049/091），含 `messagesSnapshot`（sanitize 后的完整上下文投影）；
- 恢复起点 = **指定 checkpoint 的快照**（非「最新」自动选择——由宿主显式指定，避免隐式语义）；
- 重建方式：`messages = clone(snapshot) + { role:"user", content: resumePrompt }`——不走 history-builder 的压缩折叠口径（快照即当时的真实上下文）。

### 2.2 归因（诚实语义的核心）

| 事件 | 归因 |
|---|---|
| ops `TURN_RESUMED`（info） | 续跑轮次必发，detail 含 checkpoint id——轨迹可查「这是一次续跑」 |
| SSE `turn_start` | **不新增协议字段**（实验期不动 protocol；若转正再议 `resumed` 字段 + protocol-sync 门禁） |
| 落库 TurnEntity | 正常 done/error 收尾，续跑事实由 ops 台账承载 |

### 2.3 与既有恢复语义的关系

- 默认路径（无门控/无显式请求）**行为逐字节不变**：崩溃 → `recoverInterruptedTurns` 诚实标记 `error/process_restart`；
- 续跑是**叠加选项**：宿主拿到 process_restart 事实后，才决定是否显式发起续跑——先诚实，后补救；
- 续跑轮次是**全新轮次**（新 turnId、新 running 行），被中断的旧轮次保持 error 标记不动——历史不撒谎。

## 3. 副作用边界（设计预留，本轮不实现）

快照之后的工具副作用（fs 写、bash 执行）在崩溃时可能已发生。续跑会把快照后的 assistant tool_calls 视为「未执行」重新发起。**声明式豁免清单**（宿主传入 `resume.sideEffectFreeTools: string[]`，快照内这些工具的结果保留原值不重发）作为转正时的必要机制；原型阶段不做——因此原型明确标注「仅适用于只读/幂等工作区负载」。

## 4. HITL 挂起不参与续跑

HITL 挂起协程是进程内 Promise（TASK-100 的 Redis 外置只持久化**决策**，不持久化协程）。崩溃时挂起中的轮次：决策可落账 + 审批卡回写，但执行链已死——续跑对它同样适用（从挂起前的 checkpoint 续跑），不存在「复活挂起协程」的路径。

## 5. 威胁与边界

| 边界 | 处置 |
|---|---|
| 快照缺失/损坏 | 回落常规 history-builder 口径（行为不变），不报错 |
| 门控关闭 | `resumeFromCheckpointId` 字段被完全忽略（零行为差异） |
| 重复续跑同一 checkpoint | 允许（宿主责任）；每次续跑都是新轮次，台账可审计 |
| 上下文窗口 | 快照是历史时点投影，恢复时未再压缩——超窗由既有 context_overflow 自愈兜底 |
| 协议面 | 实验期零协议改动；转正需过 protocol-sync 门禁 + 版本协商（TASK-101 已铺协商头） |

## 6. 原型实现清单（已落地）

- `AgentTurnRequest.resumeFromCheckpointId`（types.ts，程序化字段，HTTP 不暴露）；
- `agent-loop.ts` 历史重建分支：门控 + 快照命中 → 快照重建 + `ops.turnResumed`；未命中 → 原口径；
- `OpsReporter.turnResumed` / `partialRepair` + ops `info` 事件类型 + `TURN_RESUMED` / `MODEL_PARTIAL_REPAIR` 分类码；
- partial JSON 静默修复发 `MODEL_PARTIAL_REPAIR`（warn）——不再无声吞掉格式错误；
- 协议版本协商：`x-vuagent-protocol-version` 显式头不一致 → 426 + supported 清单（chat / stream 两路由）。

## 7. 转正检查单（若实验验证通过）

1. SSE 协议加 `resumed` 归因字段（protocol + stream-schema + sync 门禁 + ui reducer 徽标）；
2. 声明式副作用豁免清单落地；
3. /api/chat 路由暴露 resume 参数（带审批确认交互——费用面提示）；
4. 真实端点验收挂 docs/verification.md（并入 TASK-053 遗留清单）。
