# @vuagent/console

## 0.7.1

### Patch Changes

- 938186f: 修复 0.7.0 生产 console 样式崩坏：结构抽取后 `apps/console` 薄壳只调 `mountConsole()`，漏了 `@vuagent/ui/tokens.css` 与 `shell.css` 的引入——发布产物里没有 `--va-*` 设计令牌（全部样式留白）、`body` 带 8px 默认外边距、`html/body/#app` 满高链断裂（控制台被压成半屏）。
  
  修法：把令牌与页面基础样式的引入下沉到 `@vuagent/console-app` 入口，任何宿主（生产壳 / 开发壳 / 第三方）import 即自动带上，杜绝「某个壳忘了引」的漂移。同时给 `scripts/check-pack.mjs` 增加**产物样式自足性**门禁：console 包必须自带 `--va-bg` / `--va-ink` 令牌、`.va-console` 组件样式与满高布局，否则发布前直接失败（这类缺陷此前能一路发到 npm）。

## 0.7.0

### Minor Changes

- e9353b9: Console 结构抽取（T16）：`@vuagent/console` 的生产产物改由新的 `apps/console` 薄壳产出（一句 `mountConsole` 挂载），源码库 `@vuagent/console-app`（私有）由生产壳与开发壳 `apps/playground` 共用——「开发看到什么 = 生产看到什么」。产物仍为纯静态包（`dist/index.html` + assets、零运行时依赖），`@vuagent/cli` 的包内解析路径不变。
- d484f41: CLI 与 Console 首发：`npm i -g @vuagent/cli` 后 `vuagent` 一条命令起 harness 服务 + console（同端口同源）。数据目录规范：默认 `~/.vuagent`（`--data-dir` / `VUAGENT_HOME` 可覆盖，`--db` 只覆盖库文件），`vuagent paths` 打印每条路径及来源；同一数据目录第二实例默认拒绝（退出码 3）；`--port 0` 随机端口、`--workspace` 免选目录、`--no-open` / CI 下自动不开浏览器；优雅停机先关库后删锁。
