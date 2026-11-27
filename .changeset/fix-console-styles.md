---
"@vuagent/console": patch
---

修复 0.7.0 生产 console 样式崩坏：结构抽取后 `apps/console` 薄壳只调 `mountConsole()`，漏了 `@vuagent/ui/tokens.css` 与 `shell.css` 的引入——发布产物里没有 `--va-*` 设计令牌（全部样式留白）、`body` 带 8px 默认外边距、`html/body/#app` 满高链断裂（控制台被压成半屏）。

修法：把令牌与页面基础样式的引入下沉到 `@vuagent/console-app` 入口，任何宿主（生产壳 / 开发壳 / 第三方）import 即自动带上，杜绝「某个壳忘了引」的漂移。同时给 `scripts/check-pack.mjs` 增加**产物样式自足性**门禁：console 包必须自带 `--va-bg` / `--va-ink` 令牌、`.va-console` 组件样式与满高布局，否则发布前直接失败（这类缺陷此前能一路发到 npm）。
