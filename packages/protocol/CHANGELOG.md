# @vuagent/protocol

## 0.3.0

### Minor Changes

- ee5e855: 协议契约成熟化（TASK-053~056）：HarnessStreamEvent TypeBox 运行时化（schema 唯一事实来源 + validateHarnessStreamEvent）；新增 turn_start/aborted 控制事件与全事件 seq 寻址；7 个系统工具入参 schema 收口（AllToolSchemas 全量聚合 + VuagentAllToolName）；UiComponentRenderResult.component 收口为 VuagentToolName 联合类型；子路径导出 ./stream ./tools ./system-tools ./lifecycle；README（消费矩阵/变更纪律/校验语义约定）。

### Patch Changes

- 135f11e: system-tools 新增 `finish_task` 显式终态声明 Schema（summary + 可选 deliverables 交付物清单）：`VuagentSystemToolSchemas` 注册表扩至 8 项，`VuagentSystemToolName` 联合同步扩展。配套 server 侧 `execution.finishTaskMode` 开关（off 时工具对模型不可见，契约对旧消费方前向兼容）。
- 135f11e: aborted 事件 reason 联合新增 `token_budget` 字面量：单轮累计 token 预算熔断（execution.maxRunTokens）触发的中止成因，非严格校验下对旧消费方前向兼容。
