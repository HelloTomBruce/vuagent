# @vuagent/protocol

单一事实契约层：Vuagent 三端（server / console / ui）共享的事件流协议、生命周期模型与工具 Schema。

## 模块定位

| 模块 | 文件 | 内容 | 事实来源地位 |
|---|---|---|---|
| **stream** | `stream.ts` + `stream-schema.ts` | HarnessStreamEvent（18 事件）+ TypeBox Schema + `validateHarnessStreamEvent` 运行时校验 | **schema 是唯一事实来源**，类型由 `Static<>` 推导 |
| **stream-schema** | `stream-schema.ts` | 事件注册表 / 联合 schema / 校验入口（见上，与 stream 同域） | 同上 |
| **tools** | `tools.ts` | 6 个 ui_* 工具 Schema（模型 parameters + 前端 Props 双用）+ `AllToolSchemas` 全量聚合 | ui 组件名联合 `VuagentToolName` 的来源 |
| **system-tools** | `system-tools.ts` | 7 个系统工具（fs/bash/search/web）入参 Schema | ToolRegistry 执行前 `Value.Check` 闸门的依据 |
| **lifecycle** | `lifecycle.ts` | Agent 组件四态生命周期 / MessageBlock 混排块 | @vuagent/ui runtime 的契约来源（经 vendored 副本分发） |
| **events** | `events.ts` | UIStreamEvent 旧词表 | **已冻结**（退役计划见文件头；ui runtime 迁移后删除） |

## 消费矩阵

| 消费方 | 直接 import | 经由 |
|---|---|---|
| `@vuagent/server` | stream / tools / system-tools | `core/types.ts` re-export + 工具 parameters + ToolRegistry 校验 |
| `apps/playground`（console） | stream（HarnessStreamEvent + parts） | reducer / useChatStream / useApprovals |
| `@vuagent/ui` | lifecycle / events（**vendored 副本**） | `src/runtime/protocol-types.ts`（npm 发布自包含，签名由 sync-check 卡口把关） |

## 契约副本同步（CI 卡口）

`@vuagent/ui` 的 vendored 副本 `packages/ui/src/runtime/protocol-types.ts` 与本包
`lifecycle.ts` / `events.ts` 的类型名集合、`AgentComponentStatus` 字面量由
`scripts/check-protocol-sync.mjs` 机械对比：

```bash
pnpm protocol:sync-check   # 本地；CI（ci.yml）在 test 后自动执行
```

**人工不再直接编辑 ui 侧副本**——改协议 → 改本包 → 跑脚本按提示同步副本。

## 变更纪律

1. **事件变更**：改 `stream-schema.ts`（注册表 + union 列表两处）→ 更新
   `tests/stream-schema.test.ts` 的 `EXPECTED_EVENT_TYPES` 全集卡口 → server 契约
   回归测试（`packages/server/tests/stream-contract.test.ts`）会自动校验真实 emit；
2. **工具变更**：改 `tools.ts` / `system-tools.ts` → ToolRegistry 闸门自动生效，
   注意更新喂旧形状参数的测试；
3. **protocol 的一切变更必须携带 changeset**（`.changeset/*.md`），契约包是语义化
   版本纪律的第一执行者；
4. 新增消费方优先走子路径导入：`@vuagent/protocol/stream`、`/tools`、`/lifecycle`、
   `/system-tools`（见 package.json exports）。

## 校验语义约定

- 事件与工具 schema 均为**非严格**（允许未知额外字段 = 前向兼容），拒绝漏字段/类型错发；
- `seq`（hub 广播序号）为传输层字段，由 server hub 注入，增量重连去重用；
- 协议版本经 SSE 响应头 `x-vuagent-protocol-version` 携带（当前 `1`）。
