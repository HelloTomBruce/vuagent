---
"@vuagent/console": minor
---

Console 结构抽取（T16）：`@vuagent/console` 的生产产物改由新的 `apps/console` 薄壳产出（一句 `mountConsole` 挂载），源码库 `@vuagent/console-app`（私有）由生产壳与开发壳 `apps/playground` 共用——「开发看到什么 = 生产看到什么」。产物仍为纯静态包（`dist/index.html` + assets、零运行时依赖），`@vuagent/cli` 的包内解析路径不变。
