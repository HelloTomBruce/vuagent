# 主题化

Vuagent 全库用 CSS 变量驱动，**不做 JS 主题引擎**——覆盖变量即可换肤。

## 亮暗切换

亮色为 `:root` 默认；暗色通过任一祖先的属性触发，组件零感知：

```ts
// 宿主应用：跟随系统 + 手动覆盖
const mq = window.matchMedia("(prefers-color-scheme: dark)");
document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
// 或使用 .dark 类（兼容 shadcn 生态习惯）
```

## 全局换肤

覆盖 `--va-*` 设计令牌（完整清单见 `packages/ui/src/styles/tokens.css`）：

```css
:root {
  --va-accent: #0f766e;     /* 换个强调色，全库跟随 */
  --va-radius-m: 12px;      /* 控件更圆润 */
}
```

## 组件级覆盖

每个组件暴露局部变量：

```html
<VaButton style="--va-btn-ink: #4338ca">紫色主按钮</VaButton>
```

## 无障碍

全部动效尊重系统"减弱动态效果"（`prefers-reduced-motion`）；交互组件提供完整键盘操作与 aria 语义。
