---
"@vuagent/protocol": minor
"@vuagent/server": patch
---

OpenCode Go 订阅网关支持 + 连通性探测对会话路由网关放行（真实订阅实测发现）。

- **新增 `opencode-go` 预设**（`https://opencode.ai/inference/go/openai/v1`）：Go 订阅
  （`oc_sk_` key，$10/月起）有专属网关，走原 Zen 预设的按量计费通道会报
  `402 Insufficient balance` 或「模型不在订阅内」。预设表加条目即全链路生效
  （`PROVIDER_KINDS` / server 枚举闸门 / 前端下拉都从单一事实源派生）。
  不写 `domain` 字段——「每域名至多一条预设」约束；`x-opencode-session` 域名规则
  按规则表独立命中，Go 网关同域自动生效。
- **探测请求带占位会话**（`sessionId: "connectivity-probe"`）：OpenCode Go 网关对
  缺 `x-opencode-session` 的请求直接 400 `MissingSessionID`，而「测试连通性」是
  孤立请求没有会话上下文 → 对该网关必红。占位值让路由检查放行（仅 opencode.ai
  域名的规则会消费此头，其他网关无感）；真实会话仍带真实 sessionId 不受影响。
