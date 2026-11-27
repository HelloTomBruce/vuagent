# @vuagent/cli

## 0.7.0

### Minor Changes

- d484f41: CLI 与 Console 首发：`npm i -g @vuagent/cli` 后 `vuagent` 一条命令起 harness 服务 + console（同端口同源）。数据目录规范：默认 `~/.vuagent`（`--data-dir` / `VUAGENT_HOME` 可覆盖，`--db` 只覆盖库文件），`vuagent paths` 打印每条路径及来源；同一数据目录第二实例默认拒绝（退出码 3）；`--port 0` 随机端口、`--workspace` 免选目录、`--no-open` / CI 下自动不开浏览器；优雅停机先关库后删锁。

### Patch Changes

- Updated dependencies [e9353b9]
- Updated dependencies [d484f41]
  - @vuagent/console@0.7.0
  - @vuagent/server@0.7.0

## 0.7.0-next.0

### Minor Changes

- d484f41: CLI 与 Console 首发：`npm i -g @vuagent/cli` 后 `vuagent` 一条命令起 harness 服务 + console（同端口同源）。数据目录规范：默认 `~/.vuagent`（`--data-dir` / `VUAGENT_HOME` 可覆盖，`--db` 只覆盖库文件），`vuagent paths` 打印每条路径及来源；同一数据目录第二实例默认拒绝（退出码 3）；`--port 0` 随机端口、`--workspace` 免选目录、`--no-open` / CI 下自动不开浏览器；优雅停机先关库后删锁。

### Patch Changes

- Updated dependencies [d484f41]
  - @vuagent/console@0.7.0-next.0
  - @vuagent/server@0.7.0-next.0
