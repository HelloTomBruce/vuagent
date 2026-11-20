---
"@vuagent/ui": minor
---

新增 L2 语义令牌与动效编排令牌（纯增量，向后兼容；换肤只改 tokens.css）：

- **排版**：字号 scale `--va-fs-2xs`~`-2xl`（10–20px 七档）+ 行高 `--va-lh-tight/normal`、字重 `--va-fw-medium/semibold/bold`、字距 `--va-tracking-wide/wider`
- **尺寸**：控件高度三档 `--va-h-sm/md/lg`（30/36/44px）、图标三档 `--va-icon-sm/md/lg`、z-index 阶梯 `--va-z-base`~`-toast`（浮层互斥顺序）
- **间距半步**：`--va-s3h`（6px）/ `--va-s4h`（10px）
- **语义对照色**：`--va-accent/success/warning/danger/info-contrast` 五组——实底色上的文字/图标色（`background: var(--va-accent); color: var(--va-accent-contrast)`），暗色主题实底换浅橙后用深墨字保对比度（实测 ≈7.3:1）
- **遮罩**：`--va-scrim`（dialog/popover 页面压暗，亮 .45 / 暗 .6）；补齐骨架屏亮色定义 `--va-skel-bg/-hl`
- **动效编排**：入场 `--va-dur-in` + `--va-ease-out-quart`、离场 `--va-dur-out` + `--va-ease-in-quad`、弹性 `--va-ease-spring`、位移 `--va-dist-s/m`、循环底速 `--va-dur-loop`；组件库全量 spinner 归一、浮层进出对称过渡、reduced-motion 分频策略（装饰动画全关、功能动画降级纯 opacity）
- 全库组件 CSS 排版/尺寸/字重/字距收敛到语义令牌（内联 fallback 保留，单文件拷贝分发自包含性不破坏）
