# Overlay 浮层组件

6 个浮层组件按「原语先行」组织：**VaPopover 是共用基座**（定位引擎 + Teleport + 外部点击/Esc 关闭），Select / Dropdown / Tooltip 都基于它；VaDialog 是独立的模态原语，VaConfirm 基于它做命令式封装。

## 何时用哪个

| 需求 | 用 | 不用 | 原因 |
|---|---|---|---|
| 从一组选项里选值（表单字段） | **VaSelect** | VaCombobox | combobox 面向「可输入、可创建新项」；select 是纯选择，触发器是 button |
| 可输入搜索 + 允许创建不存在的项 | **VaCombobox** | VaSelect | combobox 的输入即值；select 的搜索只是过滤，不产生新值 |
| 过滤条件面板（多组 checkbox/radio） | **VaFilterMenu** | VaSelect | filter-menu 多组成组、值是 `Record<groupId, ...>`，不是单字段选择 |
| 对某行/某对象的动作菜单（⋯） | **VaDropdown** | VaCommandMenu | dropdown 是就地菜单（click/contextmenu）；command-menu 是 ⌘K 全局命令面板 |
| 全局命令搜索/跳转（⌘K） | **VaCommandMenu** | VaDropdown | command-menu 面向键盘全局检索，不锚定在某个行元素上 |
| 打断式确认/表单（必须处理） | **VaDialog** / **VaConfirm** | VaPopover | dialog 有焦点陷阱、aria-modal、滚动锁；popover 不拦焦点 |
| 删除等危险操作的二次确认 | **VaConfirm**（`await vaConfirm()`） | 自建 dialog | 命令式 Promise 化，队列串行，危险 tone 初始聚焦「取消」 |
| 图标/按钮的只读文字提示 | **VaTooltip** | VaPopover / `title` | tooltip 无交互、hover/focus 延迟显示、自动回填 aria-describedby |
| 自建浮层（通知卡、取色器…） | **VaPopover** | 手写定位 | useFloating 提供 flip/shift 防溢出、外部点击与 Esc（栈顶）关闭 |

::: tip 与原生 `title` 属性的关系
元素同时带 `title` 与 VaTooltip 时，两者都会展示（浏览器原生延迟悬停卡 + VaTooltip 气泡），体验重复。建议迁移到 VaTooltip 后移除 `title`——`title` 不可样式化、延迟时长与读屏播报行为各浏览器不一致，且触摸设备完全不可达。
:::

## VaPopover — 浮层原语

定位引擎 `useFloating`：主方向（top/bottom）空间不足自动翻转、shift 保留 8px 视口边距、`matchAnchorWidth` 对齐锚点宽度；trigger 插槽点击切换，或传外部 `anchor`（含 `VirtualAnchor`，如右键坐标点）。

```vue
<VaPopover placement="bottom-start">
  <template #trigger="{ open }">
    <VaButton variant="secondary" size="sm">{{ open ? "关闭" : "打开" }}</VaButton>
  </template>
  <div>任意浮层内容（容器语义中立，role 由你声明）</div>
</VaPopover>
```

## VaDialog — 模态弹窗

焦点陷阱（Tab 循环）+ 关闭后焦点还原 + 堆叠栈（Esc/遮罩仅栈顶响应）+ body 滚动锁。`role="dialog"` 或 `role="alertdialog"`；`title` 自动关联 `aria-labelledby`。

```vue
<VaDialog v-model:open="open" title="编辑预设" description="修改将应用到全部新会话。" size="sm">
  <p>主体内容</p>
  <template #footer="{ close }">
    <VaButton variant="primary" size="sm" @click="close">保存</VaButton>
  </template>
</VaDialog>
```

## VaSelect — 下拉选择

触发器 `role=combobox`，弹层 `role=listbox`；单选/多选（勾选框）/可搜索/可清除/分组；完整键盘导航（↑↓ 跳过禁用项、Home/End、字母首字符跳转、Esc 还原焦点）。

```vue
<VaSelect v-model="value" :options="options" searchable clearable label="选择框架" />
```

## VaConfirm — 命令式确认框

`vaConfirm(options)` 返回 `Promise<boolean>`；页内挂一次 `<VaConfirmHost />`。`tone: "danger" | "warning"` 时确认按钮危险配色且初始聚焦「取消」（安全默认）；`requireText` 需逐字输入才可确认；并发调用队列串行。

```ts
const ok = await vaConfirm({
  title: "删除这个会话？",
  description: "此操作不可撤销。",
  confirmText: "删除",
  tone: "danger",
});
```

```vue
<!-- App 根或页内挂一次 -->
<VaConfirmHost />
```

## VaDropdown — 动作菜单

三点菜单：`role=menu` / `menuitem`，支持 icon / shortcut / danger / checked / divider / group 与一层子菜单；`trigger: "click" | "contextmenu" | "manual"`（右键模式以点击坐标为虚拟锚点）。

```vue
<VaDropdown :items="items" @select="onSelect" />
```

::: warning 自定义 trigger 插槽不要再绑 `@click`
`#trigger` 插槽外层的包装元素已自动绑定点击切换。若在插槽内的按钮上再写 `@click="toggle"`，同一次点击会触发两次 toggle（先开后关），表现为「点击没反应」。插槽里只放展示内容，用 `open` 渲染状态即可：

```vue
<VaDropdown :items="items">
  <template #trigger="{ open }">
    <VaButton variant="secondary" size="sm" :aria-expanded="open">行操作 ⋯</VaButton>
  </template>
</VaDropdown>
```
:::

## VaTooltip — 文字提示

无交互只读提示：hover/focus 经 `delay`（默认 300ms）显示，移出经 `hideDelay`（默认 80ms）关闭，Esc 立即关；`role=tooltip` 且 `pointer-events: none`；触发元素自动回填 `aria-describedby`（触发器自带 `aria-label` 时跳过，避免覆盖）。

```vue
<VaTooltip content="保存更改（⌘S）" placement="top">
  <VaButton variant="secondary" size="sm">保存</VaButton>
</VaTooltip>
```

::: warning 触发器需可聚焦
键盘用户经 `focusin` 触发提示：触发器应是 `button` 等可聚焦元素。纯文本触发器只有鼠标可达。
:::

## 可访问性基线

| 组件 | 语义 | 键盘 |
|---|---|---|
| VaPopover | 容器语义中立（消费方声明 role） | Esc（仅栈顶）、外部点击关闭 |
| VaDialog | `role=dialog/alertdialog` + `aria-modal` + labelledby/describedby 自动关联 | 焦点陷阱 + 初始聚焦 + 关闭还原焦点 |
| VaSelect | `role=combobox` → `role=listbox`/`option` + `aria-selected` | ↑↓/Home/End/Enter/Space/Esc/字母跳转 |
| VaConfirm | `role=alertdialog`（经 VaDialog） | 危险操作初始聚焦「取消」 |
| VaDropdown | `role=menu`/`menuitem` + `aria-haspopup`（子菜单） | ↑↓/Home/End/Enter/Space/→/←/Esc/Tab |
| VaTooltip | `role=tooltip` + 触发器 `aria-describedby` 回填 | focusin 开 / focusout、Esc 关 |

全部浮层动效尊重 `prefers-reduced-motion`；暗色主题经 `[data-theme="dark"]` 的 token 自动生效，无需额外样式。
