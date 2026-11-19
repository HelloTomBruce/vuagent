---
"@vuagent/ui": minor
---

新增 Overlay 组件族（6 个组件）：

- **VaPopover**（+ `useFloating`）：浮层定位原语——手写零依赖定位引擎（top/bottom 自动翻转 + 8px 视口边距 shift + matchAnchorWidth），Teleport 到 body，外部点击 / Esc（仅栈顶）关闭，trigger 插槽或外部 anchor（含 VirtualAnchor）双模式
- **VaDialog**：模态弹窗原语——焦点陷阱 + 焦点还原 + 堆叠栈 + body 滚动锁，`role=dialog/alertdialog`，完整 ARIA 关联
- **VaSelect**：纯选择型下拉（单选/多选/可搜索/可清除/分组），完整键盘导航，基于 VaPopover
- **VaConfirm**：命令式确认框 `await vaConfirm()` 返回 Promise，宿主 `<VaConfirmHost />`，tone/requireText/checkbox，队列串行
- **VaDropdown**：动作菜单（三点菜单）——shortcut/danger/checked/divider/group + 一层子菜单，click/contextmenu/manual 三触发
- **VaTooltip**：轻量文字提示——hover/focus 延迟显示 + Esc 关闭 + 触发器 aria-describedby 自动回填，role=tooltip 且 pointer-events:none
