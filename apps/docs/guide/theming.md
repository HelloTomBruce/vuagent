# 主题化

Vuagent 全库用 CSS 变量驱动，**不做 JS 主题引擎**——覆盖变量即可换肤。

三层主题模型：

- **L1 基础令牌**（`packages/ui/src/styles/tokens.css`）——色彩/圆角/间距/阴影，换肤只改这里；
- **L2 语义令牌**（同文件的排版/尺寸/层级/动效段）——从 L1 派生的规范档位，组件不得绕过它裸写字号/字重/控件高度；
- **L3 组件钩子**——`--va-<组件>-*`（各组件 CSS 内定义），只影响单个组件。

## 亮暗切换

亮色为 `:root` 默认；暗色通过任一祖先的 `data-theme="dark"` 属性或 `.dark` 类触发（双选择器，兼容 shadcn 生态习惯），组件零感知。

完整的三态宿主（亮 / 暗 / 跟随系统）示例：

```ts
// 宿主应用：三态切换 + localStorage 持久化 + 跟随系统
const KEY = "vuagent:theme";
type Pref = "light" | "dark" | "system";

const mq = window.matchMedia("(prefers-color-scheme: dark)");
// 读持久化偏好：白名单解析，坏值回退 "system"
let pref: Pref = ((): Pref => {
  const raw = localStorage.getItem(KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
})();

function apply() {
  const theme = pref === "dark" || (pref === "system" && mq.matches) ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  // color-scheme 让原生滚动条 / 表单控件 / 拼写检查高亮一并跟随主题
  document.documentElement.style.colorScheme = theme;
}

// "跟随系统"必须监听 change，系统主题切换时实时跟随
mq.addEventListener("change", () => {
  if (pref === "system") apply();
});

function setPreference(value: Pref) {
  pref = value;
  localStorage.setItem(KEY, value);
  apply();
}
```

> Playground 宿主即按此模式实现，见 `apps/playground/src/console/composables/useTheme.ts`；
> `apps/playground/index.html` 内联了等价的首屏脚本，持久化暗色偏好时首帧即暗色、无闪烁（FOUC 防护）。

## L2 语义令牌速查

### 排版（字号 / 行高 / 字重 / 字距）

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--va-fs-2xs` ~ `--va-fs-2xl` | 10 / 11 / 12 / 13 / 14 / 16 / 20px | 字号七档 scale |
| `--va-lh-tight` / `--va-lh-normal` | 1.3 / 1.5 | 行高 |
| `--va-fw-medium` / `-semibold` / `-bold` | 500 / 600 / 700 | 字重 |
| `--va-tracking-wide` / `-wider` | 0.04em / 0.06em | 标签/大写字距 |

### 尺寸（控件高度 / 图标 / z-index）

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--va-h-sm` / `-md` / `-lg` | 30 / 36 / 44px | 按钮/输入/下拉统一高度 |
| `--va-icon-sm` / `-md` / `-lg` | 14 / 16 / 18px | 图标三档 |
| `--va-z-raised` → `--va-z-toast` | 10 / 50 / 70 / 80 / 90 / 1000 | 浮层互斥阶梯，勿裸写新值 |

### 动效（编排协议）

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--va-dur-1` / `-2` / `-3` | 120 / 200 / 300ms | hover/按压等微交互 |
| `--va-dur-in` + `--va-ease-out-quart` | 180ms | 浮层入场 |
| `--va-dur-out` + `--va-ease-in-quad` | 140ms | 浮层离场（更快更短） |
| `--va-ease-spring` | 弹性曲线 | 成功/强调反馈过冲 |
| `--va-dur-loop` | 1.8s | 循环动画底速（shimmer/spinner，组件内 calc 倍率） |
| `--va-dist-s` / `-m` | 4 / 8px | 进出位移距离 |

`prefers-reduced-motion: reduce` 下：装饰动画（shimmer/breathe 等循环）全关；功能动画（浮层进出/按压反馈）降级为纯 opacity 过渡，保留状态可感知。

### 语义对照色与遮罩

| 令牌 | 亮色 | 暗色 | 用途 |
| --- | --- | --- | --- |
| `--va-accent-contrast` | `#ffffff` | `#1a1917` | accent 实底上的文字/图标（`background: var(--va-accent); color: var(--va-accent-contrast)`） |
| `--va-success/warning/danger/info-contrast` | 白 | 深色系 | 同上，语义色实底版 |
| `--va-scrim` | `rgba(26,25,23,.45)` | `rgba(0,0,0,.6)` | dialog/popover 页面压暗遮罩 |
| `--va-skel-bg` / `-hl` | 灰底白高光 | 白叠加 | 骨架屏 |

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
