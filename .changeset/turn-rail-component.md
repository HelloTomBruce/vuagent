---
"@vuagent/ui": minor
---

新增 `VaTurnRail` 多轮快速跳转轨（turn rail + scroll-spy）：右侧一列轮次标记，点击/键盘（↑↓/Home/End）平滑定位到 `[data-turn-id]` 锚点，滚动跟随高亮当前轮并填充进度轨，悬停/聚焦出「#N + 文案」预览卡；支持受控 `v-model:active-id`、`minItems` 自动隐藏、`streaming`/`error` 状态点、`prefers-reduced-motion` 降级，以及 `container` 缺席（SSR）时的静态降级。
