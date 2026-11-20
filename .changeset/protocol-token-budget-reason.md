---
"@vuagent/protocol": patch
---

aborted 事件 reason 联合新增 `token_budget` 字面量：单轮累计 token 预算熔断（execution.maxRunTokens）触发的中止成因，非严格校验下对旧消费方前向兼容。
