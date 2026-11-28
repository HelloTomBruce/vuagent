---
"@vuagent/protocol": minor
"@vuagent/server": minor
"@vuagent/ui": minor
"@vuagent/cli": minor
---

0.9.0 主体：工具生态（MCP + web_search）+ L2 组件家族 + 到期技术债（docs/design/v0.9-plan.md）。

- **MCP 客户端（W1）**：`~/.vuagent/config/mcp.json` 配置 stdio MCP server，工具以
  `mcp__<server>__<tool>` 命名空间注册进 ToolRegistry——参数校验/超时/HITL 审批/启停/
  台账与内置工具同一执行链路（Adapter 而非平行体系，结构上无逃生舱）。per-server
  `trust: "confirm"(缺省，每次审批) | "trusted"`（免审批）；懒连接 + 指数退避 +
  listChanged 增量刷新；停机回收 stdio 子进程；`doctor` 新增 MCP 配置检查段。
  v0.9 只做 tools（resources/prompts 不做）与 stdio transport（HTTP 留 0.10）。
- **web_search（W2）**：Tavily / Brave 双 provider（REST 直连），key 走
  `TAVILY_API_KEY` / `BRAVE_API_KEY` env；**无 key = 不注册**（模型 definitions 与
  工具启停页均不出现）。结果只回 snippet+URL 不自动抓取——fetch 一律走 web_fetch
  的既有 SSRF 防线，职责分离。
- **L2 组件家族（W3）**：`ui_option_picker`（方案拍板，selected 恒为 id 数组）/ 
  `ui_wizard`（多步表单——「一个 L2」单次挂起单次回传，回传校验复用 form 派生器）/ 
  `ui_data_table`（结构化行采集，values=行对象数组）。resultSchema 一律由服务端从
  模型入参派生（不允许模型自定义）；派生器 vendored 副本经 check-protocol-sync
  函数级比对锁死。ui_wizard 渲染 v0.9 为分步分组的单表单（分步交互 UI 留 0.10）。
- **inline 回退开关移除（W4，兑现 v0.7-plan §13「保留一个版本」承诺）**：
  `VUAGENT_CHECKPOINT_STORE` env 不再被读取，写路径恒为拆行；0.6 老库 inline
  形态数据的读取兼容与惰性迁移不受影响。
- **UX 修复（W4，0.8.0 真实供应商走查发现）**：
  1. 无工作区时点「发送」此前静默失败——现在取消选目录后明确提示「任务未发送、
     输入已保留」，composer 上方新增工作区引导条；
  2. 连通性探测结果此前只有易逝 toast——现在内联落在模型行（✓ 首响应 Xms /
     ⚠ 错误摘要，悬浮看全量），toast 保留。
- **工具注册中心**：ToolRegistry 新增 `remove(name)`（MCP listChanged 增量下架）。
