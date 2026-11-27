---
"@vuagent/server": patch
"@vuagent/console": patch
---

修复「点新建工作区却让我手打路径」的两个根因：

1. **取消被当成失败**：原生框点取消时 osascript 以 `用户已取消 (-128)` 非零退出，旧实现一律回 500，前端于是「降级」成手动输入路径。现在接口区分三态——`200 {cancelled:true}`（静默）、`201 workspace`（选中）、`503 PICKER_UNAVAILABLE`（带可执行 hint：装 zenity / 从图形终端启动）、`409 PICKER_BUSY`（已有一个框在等，不叠框）；原生框改用 execFile 传参（免 shell 引号问题）并有 10 分钟上限。
2. **自托管 console 的写请求全部 403**（更严重）：Origin 白名单只有 dev 端口（5173/4173/6991/6995），而 CLI 把 console 托管在 `127.0.0.1:6880`，浏览器对 POST/PATCH/DELETE 会带 `Origin: http://127.0.0.1:6880` → 新建工作区/新建会话/发消息/审批全部被拒（GET 无 Origin 所以列表能看，容易误判「后端正常」）。现在放行「Origin 的 host == 请求 Host 且为回环地址」的同源请求；DNS rebinding 仍被挡（攻击者域名重绑时 Host/Origin 同为该域名，非回环）。
