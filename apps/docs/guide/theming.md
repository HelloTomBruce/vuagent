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
| `--va-dur-1` / `-2` / `-3` | 120 / 200 / 300ms | hover/按压等微交互与浮层进出 |
| `--va-dur-4` | 600ms | 慢速状态条（进度收缩/倒计时感，如 ContextWindow 收缩） |
| `--va-dur-in` + `--va-ease-out-quart` | 180ms | 浮层入场 |
| `--va-dur-out` + `--va-ease-in-quad` | 140ms | 浮层离场（更快更短） |
| `--va-ease-spring` | 弹性曲线 | 成功/强调反馈过冲 |
| `--va-dur-loop` | 1.8s | 循环动画底速（shimmer/spinner/pulse，组件内 calc 倍率微调；时长字面量由 `tokens:check` 门禁拦截） |
| `--va-dist-s` / `-m` | 4 / 8px | 进出位移距离 |

`prefers-reduced-motion: reduce` 下：装饰动画（shimmer/breathe 等循环）全关；功能动画（浮层进出/按压反馈）降级为纯 opacity 过渡，保留状态可感知。

### 动效/光影 token（TASK-102 新增）

blur 档位、发光、渐变端点、舞台表面与错峰步长的规范档位（亮暗独立取值见 `tokens.css` 内注释）：

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--va-blur-1` ~ `-4` | 2 / 8 / 16 / 48px（亮暗同值） | `filter`/`backdrop-filter` 模糊档位，勿裸写新值（1=浮层压暗，2=顶栏/blur-in，3=毛玻璃预留，4=舞台级氛围光晕） |
| `--va-stagger` | 40ms（亮暗同值） | 列表子项错峰步长（`useStagger` 默认口径） |
| `--va-glow-accent` | accent 派生双圈发光（描边 .35 + 软晕 .22） | 强调面发光：hover 点亮、聚光卡描边 |
| `--va-glow-soft` | 中性微光晕 | 卡片/hero 的弱光环境 |
| `--va-grad-accent-from/-to` | accent → info | 品牌渐变（`VaGradientText`/`VaGradientFloor` 现用组合的 token 化） |
| `--va-grad-info-from/-to` | info → success | 冷调渐变（次级强调/数据场景） |
| `--va-shadow-4` | `0 30px 80px …`（亮暗独立） | 舞台级深投影：hero/聚光卡等大表面 |
| `--va-stage` / `--va-stage-raised` | 亮 `#efede7`/`#ffffff` · 暗 `#141311`/`#1c1a17` | 舞台表面对：大表面底 + 其上抬升面 |

配套共享动效工具类随 `@vuagent/ui/styles.css` 分发（`packages/ui/src/styles/motion.css`）：`.va-enter-up/-left/-scale`、`.va-exit-*`（离场更短更快，映射 `--va-dur-in/out` 骨架）、`.va-crossfade`（骨架→内容交叉淡入）、`.va-fade-in`（空态/轻量状态渐入，仅 opacity 弱化档）、`.va-shake`（校验失败横向微振，±3px × `--va-dur-2`）；reduced-motion 下进出场整体降级为纯 opacity，`.va-shake` 不播（错误可感知性由错误样式本身承担）。

```html
<!-- 进出场：Vue Transition（fill-mode both，无需再配 enter-from/leave-to 类） -->
<Transition enter-active-class="va-enter-up" leave-active-class="va-exit-up">
  <div v-if="open">…</div>
</Transition>

<!-- 骨架 → 内容交叉淡入 -->
<div v-if="ready" class="va-crossfade">…</div>

<!-- 列表错峰入场 -->
<div v-for="(item, i) in items" :key="item.id" class="va-enter-up" :style="delayStyle(i)">…</div>

<!-- 空态渐入（仅 opacity 弱化档） -->
<p v-if="!items.length" class="va-xxx__empty va-fade-in">暂无内容</p>
```

```ts
// 步长默认 40ms（--va-stagger），reduced-motion 下自动归零；SSR 安全
const { delayStyle } = useStagger();

// 错误微振：校验失败时调用组件暴露的 shake()（VaStepperForm / VaOtpInput 已暴露）
stepperRef.value?.shake();
```

### 按压反馈 / 错误微振 / 光斑 / 复制反馈（TASK-105/106 标准扩展）

- **按压反馈**：动作按钮统一挂 `.va-act` 基类（`styles/button.css`），`:active` 统一 `translateY(0.5px) scale(0.985)`（`--va-dur-1`）；reduced-motion 下去位移只留透明度反馈。组件不再逐个发明缩放值。
- **行级按压（分轨口径）**：全宽交互行（文件树/通知/会话行）与浮层选项行（command-menu/dropdown/select）不做位移/缩放，`:active` 统一「表面朝 `--va-ink` 混 15% 加深」——ink 随主题翻转，亮色变深/暗色变浅方向自适应；选中/高亮行保持自身色相（accent 面混 accent）。
- **错误微振**：校验失败目标元素挂 `.va-shake` 播一次 ±3px 横向微振（`--va-dur-2` × 2）；库内经 `useShake()` 程序化触发（VaStepperForm / VaOtpInput `defineExpose({ shake })`，宿主 `ref.value.shake()`），自绘表单可直接挂类。微振只做注意力引导，错误语义须同时以文案/aria 披露。
- **静态光斑**：宿主元素挂 `.va-spotlight` + `useSpotlight()`（composable，rAF 节流写 `--va-spot-x/y`）；`:hover` 点亮 radial 光斑。`hover: none` 与 reduced-motion 不启用（JS/CSS 双兜底）；SSR 安全。尺寸/颜色走 L3 钩子 `--va-spot-size` / `--va-spot-color`。
- **复制反馈**：copy→check 内容放 `.va-copy` 结构（`__idle`/`__done` 同格堆叠，切换零跳动），copied 置真挂 `.va-copy--done`——120ms 交叉过渡 + check 侧 ease-spring 微弹。库内消费方：terminal-log / code-diff / message-actions。

```css
/* 发光 + 舞台级投影 + 抬升面组合（聚光卡形态） */
.spot-card {
  background: var(--va-stage-raised);
  box-shadow: var(--va-glow-accent), var(--va-shadow-4);
}
```

```vue
<!-- 静态光斑：rAF 节流跟随指针，hover 点亮（触屏/reduced-motion 自动关闭） -->
<template>
  <div
    class="spot-card va-spotlight"
    @pointerenter="spot.onPointerEnter"
    @pointermove="spot.onPointerMove"
    @pointerleave="spot.onPointerLeave"
  >…</div>
</template>
<script setup lang="ts">
const spot = useSpotlight();
</script>
```

### 光影组件与 Glass / Noise 表面（TASK-109/110）

「追光」手法沉淀的三个光影原语（`动效` 分类，见 [动效与插画组件](/components/effects)）直接消费本文件上方表中的光影 token，宿主无需自行组合阴影：

| 组件 | 消费 token | 语义 |
| --- | --- | --- |
| `VaSpotlightCard` | `--va-glow-accent` + `--va-shadow-1..4` + `--va-card` / `--va-stage-raised` | 聚光卡：发光描边 + 档位投影 + hover 指针光斑（`elevation` 1-4 换档） |
| `VaScrimEdge` | `--va-scrim` | 边缘渐隐遮罩原语：媒体封面/卡片文字保护，四向可配 |
| `VaGradientBorder` | `--va-grad-accent-from/-to`（或 info 族）+ `--va-dur-loop` | 渐变边框：`static` 双色描边；`running` conic 光环 = Agent「运行中」 |

```html
<!-- 聚光卡 × 暗色舞台联动：卡面换舞台抬升面（组件不强制，宿主决定） -->
<VaSpotlightCard style="--va-spot-card-bg: var(--va-stage-raised);">
  …
</VaSpotlightCard>

<!-- 媒体封面文字保护：父级需 position:relative -->
<div style="position:relative;">
  <img src="cover.jpg" alt="" />
  <VaScrimEdge direction="bottom" :height="96" />
</div>

<!-- Agent Ops「运行中」：光环周期跟随 --va-dur-loop，reduced-motion 静止 -->
<VaGradientBorder variant="running"><task-card /></VaGradientBorder>
```

**Glass / Noise 克制规范**（仅 stage / hero 级大表面使用——全页磨砂会让层次糊成一团，普通卡片/列表的层次感优先靠 `--va-shadow-*` 与描边档位表达）：

| 令牌 / 工具类 | 值 | 说明 |
| --- | --- | --- |
| `--va-surface-glass` | 亮 `rgba(255,255,255,.68)` · 暗 `rgba(28,26,23,.68)` | 半透明玻璃面（backdrop blur 的载体） |
| `--va-surface-raised` | 亮 `#ffffff` · 暗 `#1c1a17` | 纯色降级面（无 backdrop-filter 环境的 scrim 兜底） |
| `.va-glass` | 工具类（随 `styles.css` 分发） | 半透明面 + blur 档 3 + 描边 + 顶缘内高光；`@supports not (backdrop-filter)` 自动落 `--va-surface-raised` 纯色 scrim |
| `.va-noise` | 工具类（同上） | 内联 SVG feTurbulence 噪点（data-URI 342 bytes < 2KB）；叠加层透明度钩子 `--va-noise-o`（默认 0.05，建议 ≤0.08），dark 减淡 ×0.6；经 `--va-noise-url` 可换纹理 |

```html
<!-- stage/hero 级大表面：glass 面上叠噪点（父级 position:relative） -->
<section class="va-glass" style="position:relative;border-radius:16px;padding:48px;">
  <div class="va-noise" style="position:absolute;inset:0;" aria-hidden="true"></div>
  <div style="position:relative;">Hero 内容（噪点之下、保持可选中）</div>
</section>
```

静态纹理与动效分频约定无冲突（`.va-noise` 不含任何 animation/transition，`reduced-motion` 无需豁免）。

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
