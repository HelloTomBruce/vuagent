# @vuagent/ui

## 0.2.0

### Minor Changes

- M5-M7 交付：全库 60 项（43 组件 + Screens/Blocks/插画精选 + Motion 补齐）
  
  - M5 Agent 客户端刚需 9 件：差异化 CodeDiff / FileTree / TerminalLog / CheckpointList + CommentThread / EmailDraft / UsageMeter / CommandMenu / Dropzone；新增 lineDiff / ANSI 解析 / sparkline utils
  - M6 输入·表单·导航·反馈 16 件：Combobox / FilterMenu / OtpInput / ProfileMenu / StepperForm / ProgressTracker / SetupGuide / SmartRecommendation / PromptLibrary / DateRangePicker / IntegrationPicker+Settings / NotificationStack / TipsPanel / ReactionBar / ChangeSummary
  - M7 收官 20 件：手写 SVG 图表 5（KpiChart / Breakdown / Compact / Experiment / AiAnswer）、Motion 4、Screens 5、Blocks 3、插画 3
  - 按钮样式收敛为全局 .va-act 基类（registry 拷贝自动内联）；修复 VaButton loading 对齐、ToolCall 圆环、布尔 cast 回归
  - 测试 95 个（含 46 个 SSR smoke）；shadcn registry 60 条 + llms.txt 全量
