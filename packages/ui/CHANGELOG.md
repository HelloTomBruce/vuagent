# @vuagent/ui

## 1.0.0

### Major Changes

- fbe79f5: 移除 VaEmailDraft 组件（产品判定 agent 控制台场景无邮件起草需求）：删除组件目录、index 导出、registry 条目与文档收录。0.2.0 起使用的宿主需迁移；同批移除配套 ui_email_draft 契约工具（协议与服务端，未随版本发布）

### Minor Changes

- a115c00: 新增 Overlay 组件族（6 个组件）：
  
  - **VaPopover**（+ `useFloating`）：浮层定位原语——手写零依赖定位引擎（top/bottom 自动翻转 + 8px 视口边距 shift + matchAnchorWidth），Teleport 到 body，外部点击 / Esc（仅栈顶）关闭，trigger 插槽或外部 anchor（含 VirtualAnchor）双模式
  - **VaDialog**：模态弹窗原语——焦点陷阱 + 焦点还原 + 堆叠栈 + body 滚动锁，`role=dialog/alertdialog`，完整 ARIA 关联
  - **VaSelect**：纯选择型下拉（单选/多选/可搜索/可清除/分组），完整键盘导航，基于 VaPopover
  - **VaConfirm**：命令式确认框 `await vaConfirm()` 返回 Promise，宿主 `<VaConfirmHost />`，tone/requireText/checkbox，队列串行
  - **VaDropdown**：动作菜单（三点菜单）——shortcut/danger/checked/divider/group + 一层子菜单，click/contextmenu/manual 三触发
  - **VaTooltip**：轻量文字提示——hover/focus 延迟显示 + Esc 关闭 + 触发器 aria-describedby 自动回填，role=tooltip 且 pointer-events:none
- 99c3a3e: 新增 L2 语义令牌与动效编排令牌（纯增量，向后兼容；换肤只改 tokens.css）：
  
  - **排版**：字号 scale `--va-fs-2xs`~`-2xl`（10–20px 七档）+ 行高 `--va-lh-tight/normal`、字重 `--va-fw-medium/semibold/bold`、字距 `--va-tracking-wide/wider`
  - **尺寸**：控件高度三档 `--va-h-sm/md/lg`（30/36/44px）、图标三档 `--va-icon-sm/md/lg`、z-index 阶梯 `--va-z-base`~`-toast`（浮层互斥顺序）
  - **间距半步**：`--va-s3h`（6px）/ `--va-s4h`（10px）
  - **语义对照色**：`--va-accent/success/warning/danger/info-contrast` 五组——实底色上的文字/图标色（`background: var(--va-accent); color: var(--va-accent-contrast)`），暗色主题实底换浅橙后用深墨字保对比度（实测 ≈7.3:1）
  - **遮罩**：`--va-scrim`（dialog/popover 页面压暗，亮 .45 / 暗 .6）；补齐骨架屏亮色定义 `--va-skel-bg/-hl`
  - **动效编排**：入场 `--va-dur-in` + `--va-ease-out-quart`、离场 `--va-dur-out` + `--va-ease-in-quad`、弹性 `--va-ease-spring`、位移 `--va-dist-s/m`、循环底速 `--va-dur-loop`；组件库全量 spinner 归一、浮层进出对称过渡、reduced-motion 分频策略（装饰动画全关、功能动画降级纯 opacity）
  - 全库组件 CSS 排版/尺寸/字重/字距收敛到语义令牌（内联 fallback 保留，单文件拷贝分发自包含性不破坏）

## 0.2.0

### Patch Changes

- 发布自包含修复：`@vuagent/protocol` 类型内联进 runtime（此前 `workspace:*` 依赖发布后无法解析）、`lucide-vue-next` 随构建内联移入 devDependencies——npm 包零运行时依赖（peer 仅 vue）；新增 LICENSE 随包分发

### Minor Changes

- M5-M7 交付：全库 60 项（43 组件 + Screens/Blocks/插画精选 + Motion 补齐）
  
  - M5 Agent 客户端刚需 9 件：差异化 CodeDiff / FileTree / TerminalLog / CheckpointList + CommentThread / EmailDraft / UsageMeter / CommandMenu / Dropzone；新增 lineDiff / ANSI 解析 / sparkline utils
  - M6 输入·表单·导航·反馈 16 件：Combobox / FilterMenu / OtpInput / ProfileMenu / StepperForm / ProgressTracker / SetupGuide / SmartRecommendation / PromptLibrary / DateRangePicker / IntegrationPicker+Settings / NotificationStack / TipsPanel / ReactionBar / ChangeSummary
  - M7 收官 20 件：手写 SVG 图表 5（KpiChart / Breakdown / Compact / Experiment / AiAnswer）、Motion 4、Screens 5、Blocks 3、插画 3
  - 按钮样式收敛为全局 .va-act 基类（registry 拷贝自动内联）；修复 VaButton loading 对齐、ToolCall 圆环、布尔 cast 回归
  - 测试 95 个（含 46 个 SSR smoke）；shadcn registry 60 条 + llms.txt 全量
