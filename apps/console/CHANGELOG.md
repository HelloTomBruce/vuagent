# @vuagent/console

## 0.7.0

### Minor Changes

- e9353b9: Console 结构抽取（T16）：`@vuagent/console` 的生产产物改由新的 `apps/console` 薄壳产出（一句 `mountConsole` 挂载），源码库 `@vuagent/console-app`（私有）由生产壳与开发壳 `apps/playground` 共用——「开发看到什么 = 生产看到什么」。产物仍为纯静态包（`dist/index.html` + assets、零运行时依赖），`@vuagent/cli` 的包内解析路径不变。
- d484f41: CLI 与 Console 首发：`npm i -g @vuagent/cli` 后 `vuagent` 一条命令起 harness 服务 + console（同端口同源）。数据目录规范：默认 `~/.vuagent`（`--data-dir` / `VUAGENT_HOME` 可覆盖，`--db` 只覆盖库文件），`vuagent paths` 打印每条路径及来源；同一数据目录第二实例默认拒绝（退出码 3）；`--port 0` 随机端口、`--workspace` 免选目录、`--no-open` / CI 下自动不开浏览器；优雅停机先关库后删锁。
