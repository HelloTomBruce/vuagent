---
"@vuagent/cli": minor
"@vuagent/console": minor
---

CLI 与 Console 首发：`npm i -g @vuagent/cli` 后 `vuagent` 一条命令起 harness 服务 + console（同端口同源）。数据目录规范：默认 `~/.vuagent`（`--data-dir` / `VUAGENT_HOME` 可覆盖，`--db` 只覆盖库文件），`vuagent paths` 打印每条路径及来源；同一数据目录第二实例默认拒绝（退出码 3）；`--port 0` 随机端口、`--workspace` 免选目录、`--no-open` / CI 下自动不开浏览器；优雅停机先关库后删锁。
