---
"@vuagent/protocol": patch
---

system-tools 新增 `finish_task` 显式终态声明 Schema（summary + 可选 deliverables 交付物清单）：`VuagentSystemToolSchemas` 注册表扩至 8 项，`VuagentSystemToolName` 联合同步扩展。配套 server 侧 `execution.finishTaskMode` 开关（off 时工具对模型不可见，契约对旧消费方前向兼容）。
