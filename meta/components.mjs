/**
 * Vuagent 组件元数据 —— registry 生成器与 llms.txt 生成器的单一数据源。
 * dir = src/components/<dir>；slug = registry 名；props 用于 llms-full.txt 的表格。
 */

/** @type {Array<{dir:string, slug:string, title:string, category:string, desc:string, components:string[], props:Array<{name:string,type:string,default:string,desc:string}>}>} */
export const components = [
  /* ---------- Agent-Ops 旗舰 ---------- */
  {
    dir: "tool-call", slug: "tool-call", title: "Tool Call / Group", category: "Agent-Ops", components: ["VaToolCallCard", "VaToolCallGroup"],
    desc: "agent 的一次工具调用：实时秒表、失败自动展开并给出重试；Group 自动汇总多张卡。",
    props: [
      { name: "name", type: "string", default: "-", desc: "工具名，等宽展示" },
      { name: "status", type: `"running" | "success" | "error"`, default: "-", desc: "调用状态" },
      { name: "args / result", type: "unknown", default: "-", desc: "对象自动美化，JSON 字符串自动解析" },
      { name: "startedAt / duration", type: "number", default: "-", desc: "开始时间戳 / 最终耗时 ms" },
      { name: "error", type: "string", default: "-", desc: "错误信息 + 重试按钮" },
      { name: "v-model:open", type: "boolean", default: "false", desc: "展开状态；失败会自动展开" },
    ],
  },
  {
    dir: "agent-plan", slug: "agent-plan", title: "Agent Plan", category: "Agent-Ops", components: ["VaAgentPlan"],
    desc: "执行计划：编辑态可重命名/排序/增删，运行态逐项计时打勾、失败可重试。",
    props: [
      { name: "steps", type: "PlanStep[]", default: "-", desc: "步骤（id/title/detail/status/startedAt/duration）" },
      { name: "editable", type: "boolean", default: "false", desc: "审阅编辑模式" },
      { name: "@update:steps", type: "-", default: "-", desc: "编辑后的完整步骤数组" },
      { name: "@retry", type: "-", default: "-", desc: "点击失败步骤的重试" },
    ],
  },
  {
    dir: "approval-card", slug: "approval-card", title: "Approval Card", category: "Agent-Ops", components: ["VaApprovalCard"],
    desc: "审批门：风险徽章 + 命令预览 + 倒计时自动拒绝（悬停暂停）+ Enter/Esc 快捷键，决策后 morph 成结果行。",
    props: [
      { name: "title", type: "string", default: "-", desc: "请求文案" },
      { name: "risk", type: `"low" | "medium" | "high"`, default: `"medium"`, desc: "风险等级徽章" },
      { name: "preview", type: "string", default: "-", desc: "命令/代码预览" },
      { name: "countdown", type: "number", default: "-", desc: "秒数，到 0 自动拒绝" },
      { name: "@approve / @deny", type: "-", default: "-", desc: "决策回调（deny 带原因）" },
    ],
  },
  {
    dir: "decision-inbox", slug: "decision-inbox", title: "Decision Inbox", category: "Agent-Ops", components: ["VaDecisionInbox"],
    desc: "业务决策收件箱：每条两个答案，选完确认并折叠离开列表。",
    props: [
      { name: "decisions", type: "Decision[]", default: "-", desc: "id/title/detail/primary/secondary/collapsed" },
      { name: "@decide", type: "-", default: "-", desc: "回调（决策与所选答案）" },
    ],
  },
  {
    dir: "agent-inbox", slug: "agent-inbox", title: "Agent Inbox", category: "Agent-Ops", components: ["VaAgentInbox"],
    desc: "后台任务收件箱：过滤 tab 带计数、live 时钟、行展开看步骤与操作，排序变化平滑滑动。",
    props: [
      { name: "tasks", type: "AgentTask[]", default: "-", desc: "queued/running/waiting/done/error" },
      { name: "@open / @retry / @cancel", type: "-", default: "-", desc: "行内操作" },
    ],
  },
  {
    dir: "context-window", slug: "context-window", title: "Context Window", category: "Agent-Ops", components: ["VaContextWindow"],
    desc: "上下文可视化：按 token 占比的格子场，悬停点亮、文件可移除、压缩对话时历史微光收缩。",
    props: [
      { name: "parts", type: "ContextPart[]", default: "-", desc: "id/label/tokens/kind(system|file|history|tools)" },
      { name: "capacity", type: "number", default: "-", desc: "容量 tokens，如 128_000" },
      { name: "compacting", type: "boolean", default: "false", desc: "压缩动画进行中" },
      { name: "@remove / @compact", type: "-", default: "-", desc: "移除文件 / 请求压缩" },
    ],
  },
  {
    dir: "inline-diff", slug: "inline-diff", title: "Inline Diff", category: "Agent-Ops", components: ["VaInlineDiff"],
    desc: "AI 文案修改逐词接受/拒绝：CJK 逐字分词的零依赖 diff、撤销栈、全部决断后应用。",
    props: [
      { name: "original / revised", type: "string", default: "-", desc: "原文与修改稿" },
      { name: "@apply", type: "-", default: "-", desc: "全部决断后回调，携带合成文本" },
    ],
  },
  {
    dir: "memory-panel", slug: "memory-panel", title: "Memory Panel", category: "Agent-Ops", components: ["VaMemoryPanel"],
    desc: "助手记忆面板：分类过滤、就地编辑、暂停/遗忘（带撤销托盘）、总开关。",
    props: [
      { name: "memories", type: "MemoryItem[]", default: "-", desc: "id/text/category/paused" },
      { name: "v-model:enabled", type: "boolean", default: "true", desc: "记忆总开关" },
      { name: "@edit / @pause / @forget / @restore", type: "-", default: "-", desc: "数据操作回调" },
    ],
  },

  /* ---------- Chat 配套 ---------- */
  {
    dir: "thinking-loader", slug: "thinking-loader", title: "Thinking Loader", category: "Chat", components: ["VaThinkingLoader"],
    desc: "思考态加载器：阶段轮播 + 微光标签；完成后转为对勾与用时。",
    props: [
      { name: "phases", type: "string[]", default: `["思考中", …]`, desc: "轮播的阶段文案" },
      { name: "interval", type: "number", default: "1600", desc: "每阶段毫秒数" },
      { name: "done / doneLabel", type: "boolean / string", default: "-", desc: "完成态" },
    ],
  },
  {
    dir: "composer", slug: "composer", title: "Composer", category: "Chat", components: ["VaComposer"],
    desc: "任务输入框：自动增高、Enter 发送（Shift+Enter 换行、中文输入法安全）、可插入模型选择等前缀。",
    props: [
      { name: "v-model:text", type: "string", default: `""`, desc: "输入内容" },
      { name: "placeholder", type: "string", default: `"给 agent 一个任务…"`, desc: "占位文案" },
      { name: "busy", type: "boolean", default: "false", desc: "运行中禁发" },
      { name: "@send", type: "-", default: "-", desc: "携带文本" },
    ],
  },
  {
    dir: "model-picker", slug: "model-picker", title: "Model Picker", category: "Chat", components: ["VaModelPicker"],
    desc: "模型选择菜单：触发按钮 + 键盘可导航的下拉列表。",
    props: [
      { name: "models", type: "ModelItem[]", default: "内置主流模型", desc: "id/name/tag" },
      { name: "v-model:selected", type: "string", default: "-", desc: "选中模型 id" },
    ],
  },
  {
    dir: "stream-answer", slug: "stream-answer", title: "Stream Answer", category: "Chat", components: ["VaStreamAnswer"],
    desc: "流式回答：按节奏逐字吐出 source，带流式光标，完成后 emit complete，支持重放。",
    props: [
      { name: "source", type: "string", default: "-", desc: "完整回答文本" },
      { name: "autoPlay", type: "boolean", default: "true", desc: "挂载即播放" },
      { name: "interval", type: "number", default: "24", desc: "逐字间隔 ms" },
      { name: "@complete", type: "-", default: "-", desc: "播放完成" },
    ],
  },
  {
    dir: "message-actions", slug: "message-actions", title: "Message Actions / Text", category: "Chat", components: ["VaMessageActions", "VaMessageText"],
    desc: "AI 消息的操作条：复制、再生成、点赞点踩（拒绝附原因输入）、版本切换；MessageText 提供版本交叉淡入。",
    props: [
      { name: "text", type: "string", default: "-", desc: "复制的内容" },
      { name: "versions", type: "number", default: "-", desc: "版本数，≥2 显示切换器" },
      { name: "v-model:version", type: "number", default: "-", desc: "当前版本下标" },
      { name: "@copy / @regenerate / @feedback", type: "-", default: "-", desc: "操作回调" },
    ],
  },

  /* ---------- 基础 ---------- */
  {
    dir: "button", slug: "button", title: "Button", category: "基础", components: ["VaButton"],
    desc: "语义按钮：四变体 × 三尺寸，加载态标签微光。",
    props: [
      { name: "variant", type: `"primary" | "secondary" | "ghost" | "destructive"`, default: `"primary"`, desc: "语义变体" },
      { name: "size", type: `"sm" | "md" | "lg"`, default: `"md"`, desc: "尺寸" },
      { name: "loading", type: "boolean", default: "false", desc: "加载态并阻止点击" },
    ],
  },
  {
    dir: "segmented-control", slug: "segmented-control", title: "Segmented Control", category: "基础", components: ["VaSegmentedControl"],
    desc: "分段控件：滑块指示器平滑滑动，完整键盘导航。",
    props: [
      { name: "options", type: "SegmentOption[]", default: "-", desc: "value/label/disabled" },
      { name: "v-model", type: "string", default: "-", desc: "选中值" },
      { name: "fullWidth", type: "boolean", default: "false", desc: "等分撑满" },
    ],
  },
  {
    dir: "toaster", slug: "toaster", title: "Toaster", category: "基础", components: ["VaToaster"],
    desc: "全局通知：vaToaster.add() 任意位置发通知，宿主组件渲染堆叠，自动消失可手动关。",
    props: [
      { name: "position", type: `"bottom-right" | "top-center"`, default: `"bottom-right"`, desc: "堆叠位置" },
      { name: "vaToaster.add()", type: "-", default: "-", desc: "{ title, description?, kind?, duration? }" },
    ],
  },
  {
    dir: "shimmer", slug: "skeleton", title: "Skeleton / Shimmer Text", category: "基础", components: ["VaSkeleton", "VaShimmerText"],
    desc: "骨架屏与微光文字：共享一道柔和扫光。",
    props: [
      { name: "width / height / radius", type: "number | string", default: "-", desc: "尺寸与圆角" },
      { name: "circle", type: "boolean", default: "false", desc: "圆形（头像）" },
    ],
  },
  {
    dir: "number-ticker", slug: "number-ticker", title: "Number Ticker", category: "基础", components: ["VaNumberTicker"],
    desc: "里程表数字滚动：进视口从零数起，数值变化每一位独立滚动。",
    props: [
      { name: "value", type: "number", default: "-", desc: "目标数字" },
      { name: "format", type: "Intl.NumberFormatOptions", default: "-", desc: "如货币/千分位" },
      { name: "duration / delay", type: "number", default: "900 / 0", desc: "滚动时长与延迟" },
    ],
  },

  /* ---------- 动效 ---------- */
  {
    dir: "text-reveal", slug: "text-reveal", title: "Text Reveal", category: "动效", components: ["VaTextReveal"],
    desc: "文本入场：逐词/逐字从轻微模糊与位移中浮现，滚动进视口触发。",
    props: [
      { name: "text", type: "string", default: "-", desc: "文本内容" },
      { name: "by", type: `"word" | "char"`, default: `"word"`, desc: "切分粒度" },
      { name: "stagger / duration", type: "number", default: "40 / 600", desc: "间隔与单段时长 ms" },
      { name: "as", type: `"span" | "p" | "h1"…"h3"`, default: `"span"`, desc: "渲染标签" },
    ],
  },
  {
    dir: "grid-background", slug: "grid-background", title: "Grid Background", category: "动效", components: ["VaGridBackground"],
    desc: "缓慢漂移的细网格背景，边缘渐隐，可作 Hero 底纹；内容放默认插槽。",
    props: [
      { name: "size", type: "number", default: "44", desc: "格子边长 px" },
      { name: "speed", type: "number", default: "2.4", desc: "每格漂移秒数，0 静止" },
      { name: "direction", type: `"diagonal" | "up" | "down" | "left" | "right"`, default: `"diagonal"`, desc: "漂移方向" },
      { name: "fade", type: "number", default: "70", desc: "边缘渐隐强度 %" },
    ],
  },

  /* ---------- M5 · Agent 客户端刚需 ---------- */
  {
    dir: "code-diff", slug: "code-diff", title: "Code Diff", category: "Agent-Ops", components: ["VaCodeDiff"],
    desc: "文件级代码 diff：±行渲染、行内词级高亮、上下文折叠与展开、+N −M 统计、复制新文件——agent 改代码的验收主界面。",
    props: [
      { name: "oldText / newText", type: "string", default: "-", desc: "旧/新版本全文（LCS 行级 diff）" },
      { name: "fileName", type: "string", default: "-", desc: "头部文件名（等宽）" },
      { name: "context", type: "number", default: "3", desc: "变更行保留的上下文行数，其余折叠" },
      { name: "wordLevel", type: "boolean", default: "true", desc: "配对的 del/add 行内词级高亮" },
      { name: "defaultExpandAll", type: "boolean", default: "false", desc: "初始不折叠" },
      { name: "@copy", type: "-", default: "-", desc: "复制新文件内容" },
    ],
  },
  {
    dir: "file-tree", slug: "file-tree", title: "File Tree", category: "Agent-Ops", components: ["VaFileTree"],
    desc: "带变更标记的文件树：M/A/D/U 徽章、目录折叠、目录变更计数、完整方向键导航；buildFileTree() 可从扁平 git 变更列表直接建树。",
    props: [
      { name: "tree", type: "FileNode[]", default: "-", desc: "层级树（path/type/status/children）" },
      { name: "defaultExpandDepth", type: "number", default: "1", desc: "初始展开深度" },
      { name: "v-model:selected", type: "string", default: "-", desc: "选中文件完整路径" },
      { name: "@select / @toggle", type: "-", default: "-", desc: "点击文件 / 目录折叠展开" },
    ],
  },
  {
    dir: "terminal-log", slug: "terminal-log", title: "Terminal Log", category: "Agent-Ops", components: ["VaTerminalLog"],
    desc: "命令输出流：深底终端窗、等宽、ANSI 常用色（含 256/真彩、\\r 进度条重写）、语义行着色、自动滚动（上翻暂停）、行复制。",
    props: [
      { name: "lines", type: `(string | TerminalLine)[]`, default: "-", desc: "输出行；含 ANSI 序列自动解析" },
      { name: "title", type: "string", default: `"terminal"`, desc: "窗口标题栏" },
      { name: "autoScroll", type: "boolean", default: "true", desc: "贴底自动滚动，用户上翻暂停" },
      { name: "maxLines", type: "number", default: "1000", desc: "环形上限，超出丢最旧" },
      { name: "@copy", type: "-", default: "-", desc: "行复制（携带纯文本）" },
    ],
  },
  {
    dir: "checkpoint-list", slug: "checkpoint-list", title: "Checkpoint List", category: "Agent-Ops", components: ["VaCheckpointList"],
    desc: "检查点/回滚时间线：每步快照摘要与相对时间、当前位标记、diff 预览入口、二次确认的一键恢复（3 秒武器化窗口）。",
    props: [
      { name: "checkpoints", type: "Checkpoint[]", default: "-", desc: "id/label/createdAt/summary/current" },
      { name: "restoring", type: "string", default: "-", desc: "恢复进行中的检查点 id" },
      { name: "@restore / @preview", type: "-", default: "-", desc: "确认恢复 / 打开 diff 预览" },
    ],
  },
  {
    dir: "comment-thread", slug: "comment-thread", title: "Comment Thread", category: "Chat", components: ["VaCommentThread"],
    desc: "评论线程：agent 起草待审条目（采纳/重写/丢弃操作条）、人发评论、首字母头像、⌘/Ctrl+Enter 发布。",
    props: [
      { name: "comments", type: "CommentItem[]", default: "-", desc: "id/author/text/pending…" },
      { name: "busy", type: "boolean", default: "false", desc: "发布中禁发" },
      { name: "composer", type: "boolean", default: "true", desc: "底部输入框开关" },
      { name: "@submit / @adopt / @rewrite / @discard", type: "-", default: "-", desc: "发布与草稿处理" },
    ],
  },
  {
    dir: "email-draft", slug: "email-draft", title: "Email Draft", category: "Chat", components: ["VaEmailDraft"],
    desc: "agent 起草邮件、人工确认发送：收件人/主题/正文可就地编辑、语气 chips、起草骨架、发送校验与错误回显、重新起草。",
    props: [
      { name: "to / subject / body", type: "string", default: "-", desc: "三字段受控（v-model:to 等）" },
      { name: "tones / tone", type: "ToneOption[] / string", default: "-", desc: "语气选项与当前值" },
      { name: "drafting / sending", type: "boolean", default: "false", desc: "起草骨架 / 发送中" },
      { name: "@send / @regenerate", type: "-", default: "-", desc: "发送（携带完整草稿）/ 重新起草" },
    ],
  },
  {
    dir: "usage-meter", slug: "usage-meter", title: "Usage Meter", category: "基础", components: ["VaUsageMeter"],
    desc: "用量仪表：多段堆叠条（fast/slow tokens、credits）+ 图例 + 限额预警（默认 80%）/超限态与「管理额度」入口。",
    props: [
      { name: "segments", type: "UsageSegment[]", default: "-", desc: "label/used/color 多段用量" },
      { name: "limit", type: "number", default: "-", desc: "周期限额（分母）" },
      { name: "unit / period", type: "string", default: "-", desc: "单位与周期文案" },
      { name: "warnAt", type: "number", default: "0.8", desc: "预警阈值（占比）" },
      { name: "@manage", type: "-", default: "-", desc: "预警/超限时的管理入口" },
    ],
  },
  {
    dir: "command-menu", slug: "command-menu", title: "Command Menu", category: "基础", components: ["VaCommandMenu"],
    desc: "⌘K 命令面板：触发按钮 + 居中对话框，子串过滤、分组渲染、↑↓ 循环高亮、Enter 选中、Esc/遮罩关闭、焦点圈进与恢复。",
    props: [
      { name: "commands", type: "CommandItem[]", default: "-", desc: "id/label/group/hint/keywords/danger" },
      { name: "v-model:open", type: "boolean", default: "false", desc: "受控开关（含 defaultOpen 哨兵回落）" },
      { name: "hotkey / triggerLabel", type: "string", default: `"⌘K" / "命令"`, desc: "触发按钮提示" },
      { name: "@select", type: "-", default: "-", desc: "选中命令项" },
    ],
  },
  {
    dir: "dropzone", slug: "dropzone", title: "Dropzone", category: "基础", components: ["VaDropzone"],
    desc: "拖放上传区：拖入高亮（计数防抖）、点击/键盘选择、大小校验拒绝、文件列表带进度条与错误回显、受控列表由宿主驱动。",
    props: [
      { name: "files", type: "DropzoneFile[]", default: "-", desc: "受控列表（progress/status/error 由宿主更新）" },
      { name: "accept / multiple / maxSizeMb", type: "string / boolean / number", default: "- / false / -", desc: "选择约束" },
      { name: "@add / @remove / @reject", type: "-", default: "-", desc: "添加 / 移除 / 超大小拒绝" },
    ],
  },

  /* ---------- M6 · 输入·表单·导航·反馈 ---------- */
  {
    dir: "combobox", slug: "combobox", title: "Combobox", category: "基础", components: ["VaCombobox"],
    desc: "可搜索下拉选择：输入过滤、↑↓ 循环高亮、Enter 选中、Esc 关闭；creatable 可把输入创建为新值。",
    props: [
      { name: "options", type: "ComboboxOption[]", default: "-", desc: "value/label/hint/disabled" },
      { name: "v-model", type: "string", default: "-", desc: "选中值" },
      { name: "creatable", type: "boolean", default: "false", desc: "允许创建输入中的新值" },
      { name: "@create / @select", type: "-", default: "-", desc: "创建新值 / 选中列表项" },
    ],
  },
  {
    dir: "filter-menu", slug: "filter-menu", title: "Filter Menu", category: "基础", components: ["VaFilterMenu"],
    desc: "过滤条件下拉：checkbox 多选组 + radio 单选组，触发按钮带激活计数徽章，一键清除全部。",
    props: [
      { name: "groups", type: "FilterGroup[]", default: "-", desc: "id/label/type/options 过滤组" },
      { name: "v-model", type: "FilterValue", default: "{}", desc: "Record<groupId, string[] | string>" },
      { name: "@clear", type: "-", default: "-", desc: "清除全部" },
    ],
  },
  {
    dir: "otp-input", slug: "otp-input", title: "OTP Input", category: "基础", components: ["VaOtpInput"],
    desc: "验证码格子输入：自动跳格与选中、退格回退、整段粘贴分发、方向键移动、填满回调。",
    props: [
      { name: "v-model", type: "string", default: `""`, desc: "验证码字符串" },
      { name: "length", type: "number", default: "6", desc: "格子数" },
      { name: "@complete", type: "-", default: "-", desc: "全部填满时触发" },
    ],
  },
  {
    dir: "profile-menu", slug: "profile-menu", title: "Profile Menu", category: "基础", components: ["VaProfileMenu"],
    desc: "头像账户菜单：首字母色块头像、未读徽标、用户信息头 + 菜单列表（danger 项）、Esc/外部点击关闭。",
    props: [
      { name: "name / email / avatar", type: "string", default: "-", desc: "账户信息" },
      { name: "items", type: "ProfileMenuItem[]", default: "-", desc: "菜单项（danger 标红）" },
      { name: "@select", type: "-", default: "-", desc: "点击菜单项" },
    ],
  },
  {
    dir: "stepper-form", slug: "stepper-form", title: "Stepper Form", category: "表单", components: ["VaStepperForm"], deps: ["progress-tracker"],
    desc: "分步表单壳：步骤条 + 每步具名插槽（#step-{id}）+ 上一步/下一步导航，nextDisabled 承接宿主校验，最后一步转提交。",
    props: [
      { name: "steps", type: "StepperStep[]", default: "-", desc: "id/title/description" },
      { name: "v-model:step", type: "number", default: "0", desc: "当前步下标（哨兵受控）" },
      { name: "nextDisabled / submitting", type: "boolean", default: "false", desc: "校验未过 / 提交中" },
      { name: "@next / @back / @submit", type: "-", default: "-", desc: "流程回调" },
    ],
  },
  {
    dir: "progress-tracker", slug: "progress-tracker", title: "Progress Tracker", category: "基础", components: ["VaProgressTracker"],
    desc: "步骤进度条（横/竖）：done/current/pending/error 四态节点 + 完成段连线填充，点击节点回调。",
    props: [
      { name: "steps", type: "TrackerStep[]", default: "-", desc: "label/status（缺省按 current 推断）" },
      { name: "current", type: "number", default: "0", desc: "当前步下标" },
      { name: "orientation", type: `"horizontal" | "vertical"`, default: `"horizontal"`, desc: "方向" },
    ],
  },
  {
    dir: "setup-guide", slug: "setup-guide", title: "Setup Guide", category: "表单", components: ["VaSetupGuide"],
    desc: "上手引导清单：逐项完成/跳过（optional 步骤）、进度计数、全部就绪收尾提示，完成时触发 allDone。",
    props: [
      { name: "steps", type: "SetupStep[]", default: "-", desc: "id/title/description/status/optional" },
      { name: "@complete / @skip / @allDone", type: "-", default: "-", desc: "步骤处理回调" },
    ],
  },
  {
    dir: "smart-recommendation", slug: "smart-recommendation", title: "Smart Recommendation", category: "反馈", components: ["VaSmartRecommendation"],
    desc: "agent 建议卡：标题 + 理由 + 收益标签 + 主/次操作按钮，可关闭忽略。",
    props: [
      { name: "title / description / impact", type: "string", default: "-", desc: "建议内容与收益标签" },
      { name: "actions", type: "RecommendationAction[]", default: "-", desc: "id/label/primary" },
      { name: "@action / @dismiss", type: "-", default: "-", desc: "操作 / 忽略" },
    ],
  },
  {
    dir: "prompt-library", slug: "prompt-library", title: "Prompt Library", category: "表单", components: ["VaPromptLibrary"],
    desc: "提示词库：搜索（标题/正文/标签）+ 分类 tab + 卡片网格 + 使用按钮。",
    props: [
      { name: "prompts", type: "PromptItem[]", default: "-", desc: "id/title/body/category/tags" },
      { name: "query", type: "string", default: "内部维护", desc: "受控搜索词" },
      { name: "@use", type: "-", default: "-", desc: "点击使用（携带完整条目）" },
    ],
  },
  {
    dir: "date-range-picker", slug: "date-range-picker", title: "Date Range Picker", category: "表单", components: ["VaDateRangePicker"],
    desc: "日期范围选择：双月日历（周一起始、零依赖手写）、两次点击选范围（反向自动交换）、悬停预览区间、今天/7天/30天预设。",
    props: [
      { name: "v-model:start / v-model:end", type: "number", default: "-", desc: "当日 00:00 本地时区 ms" },
      { name: "presets", type: "DateRangePreset[]", default: "今天/7天/30天", desc: "自定义预设（from/to 天偏移）" },
      { name: "months", type: "1 | 2", default: "2", desc: "单月紧凑/双月" },
      { name: "@change", type: "-", default: "-", desc: "完整范围确定" },
    ],
  },
  {
    dir: "integration", slug: "integration", title: "Integration Picker / Settings", category: "表单", components: ["VaIntegrationPicker", "VaIntegrationSettings"],
    desc: "集成对接两件套：Picker 是服务卡片网格（已连接态、点击切换）；Settings 是配置面板（开关 + API key 等字段 + 保存/断开）。",
    props: [
      { name: "items", type: "IntegrationItem[]", default: "-", desc: "Picker：服务列表" },
      { name: "v-model:enabled / v-model:values", type: "boolean / Record", default: "-", desc: "Settings：开关与表单值" },
      { name: "fields", type: "IntegrationField[]", default: "-", desc: "Settings：label/secret/required/error" },
      { name: "@toggle / @save / @disconnect", type: "-", default: "-", desc: "连接切换 / 保存 / 断开" },
    ],
  },
  {
    dir: "notification-stack", slug: "notification-stack", title: "Notification Stack", category: "反馈", components: ["VaNotificationStack"],
    desc: "通知中心列表：未读徽标与未读点、语义 icon（info/success/warning/danger/agent）、相对时间、单条/全部已读。",
    props: [
      { name: "notifications", type: "NotificationItem[]", default: "-", desc: "id/title/body/kind/unread/createdAt" },
      { name: "@open / @read / @allRead", type: "-", default: "-", desc: "打开 / 标记已读" },
    ],
  },
  {
    dir: "tips-panel", slug: "tips-panel", title: "Tips Panel", category: "反馈", components: ["VaTipsPanel"],
    desc: "使用技巧面板：高亮小卡承载 1-N 条 tip，单条可关闭。",
    props: [
      { name: "tips", type: "TipItem[]", default: "-", desc: "id/title/body" },
      { name: "dismissible", type: "boolean", default: "false", desc: "显示单条关闭按钮" },
      { name: "@dismiss", type: "-", default: "-", desc: "关闭某条" },
    ],
  },
  {
    dir: "reaction-bar", slug: "reaction-bar", title: "Reaction Bar", category: "反馈", components: ["VaReactionBar"],
    desc: "emoji 快速反馈条：aria-pressed 切换态、计数徽章、按下微缩动效（reduced-motion 降级）。",
    props: [
      { name: "reactions", type: "ReactionItem[]", default: "-", desc: "id/emoji/label/count/active" },
      { name: "@toggle", type: "-", default: "-", desc: "携带目标态" },
    ],
  },
  {
    dir: "change-summary", slug: "change-summary", title: "Change Summary", category: "Agent-Ops", components: ["VaChangeSummary"],
    desc: "agent 一轮工作摘要卡：N 文件 +adds −dels、耗时与工具调用次数、逐文件行（M/A/D 徽章 + 增删计数），可折叠长列表。",
    props: [
      { name: "files", type: "SummaryFile[]", default: "-", desc: "path/status/additions/deletions" },
      { name: "duration / toolCalls", type: "number", default: "-", desc: "耗时 ms / 工具调用次数" },
      { name: "maxFiles", type: "number", default: "-", desc: "超出折叠（展开按钮）" },
      { name: "@openFile", type: "-", default: "-", desc: "点击文件行（联动 CodeDiff）" },
    ],
  },

  /* ---------- M7 · 数据图表 ---------- */
  {
    dir: "kpi-chart", slug: "kpi-chart", title: "KPI Chart", category: "图表", components: ["VaKpiChart"],
    desc: "指标卡 + sparkline：手写 SVG 折线（中点平滑/面积渐变/描线入场），环比涨跌徽章（invertDelta 适配错误率类「跌=好」），aria 摘要。",
    props: [
      { name: "label / value / series", type: "string / number / number[]", default: "-", desc: "指标名、当前值、趋势序列" },
      { name: "delta / deltaLabel", type: "number / string", default: "-", desc: "环比小数（0.12=+12%）与参照文案" },
      { name: "invertDelta", type: "boolean", default: "false", desc: "下跌视为好（错误率场景）" },
      { name: "width / height / color", type: "number / number / string", default: "120 / 36 / accent", desc: "sparkline 尺寸与线色" },
    ],
  },
  {
    dir: "breakdown-chart", slug: "breakdown-chart", title: "Breakdown Chart", category: "图表", components: ["VaBreakdownChart"],
    desc: "横向分布条：按值降序、色板/自定义色、barScale 按最大项或总量、maxRows 折叠「其他」、行可点选。",
    props: [
      { name: "items", type: "BreakdownItem[]", default: "-", desc: "label/value/color" },
      { name: "total / unit", type: "number / string", default: "求和 / -", desc: "分母与单位" },
      { name: "barScale", type: `"max" | "total"`, default: `"max"`, desc: "条长基准" },
      { name: "maxRows", type: "number", default: "-", desc: "超出折叠为「其他」" },
      { name: "@select", type: "-", default: "-", desc: "点击行" },
    ],
  },
  {
    dir: "compact-breakdown", slug: "compact-breakdown", title: "Compact Breakdown", category: "图表", components: ["VaCompactBreakdown"],
    desc: "单行堆叠占比条 + 内联图例：一行放下的迷你分布（嵌入卡片头、表格行内）。",
    props: [
      { name: "segments", type: "CompactSegment[]", default: "-", desc: "label/value/color" },
      { name: "total / height", type: "number / number", default: "求和 / 8", desc: "分母与条高 px" },
      { name: "legend", type: "boolean", default: "true", desc: "内联图例开关" },
    ],
  },
  {
    dir: "experiment-card", slug: "experiment-card", title: "Experiment Card", category: "图表", components: ["VaExperimentCard"],
    desc: "A/B 实验对比卡：变体并列（胜者描边 + ✓）、置信度条与结论（未达显著给「继续观察」）、running 态实时时长 + 结束/重开。",
    props: [
      { name: "variants", type: "ExperimentVariant[]", default: "-", desc: "id/name/value/format/delta/winner" },
      { name: "metric / status", type: `string / "running"|"success"|"error"`, default: `- / "running"`, desc: "对比指标与状态" },
      { name: "confidence / confidenceThreshold", type: "number / number", default: "- / 0.95", desc: "置信度与显著阈值" },
      { name: "@stop / @reopen", type: "-", default: "-", desc: "结束 / 重新开始" },
    ],
  },
  {
    dir: "ai-answer", slug: "ai-answer", title: "AI Answer", category: "图表", components: ["VaAiAnswer"],
    desc: "带来源引用的回答卡：正文 [n] 标记渲染为可点击上标角标（无对应来源原样保留）、来源列表（序号 + 标题 + 出处）、流式光标。",
    props: [
      { name: "answer", type: "string", default: "-", desc: "回答正文，支持 [1] 引用标记" },
      { name: "sources", type: "AnswerSource[]", default: "-", desc: "id/title/url/origin" },
      { name: "question / streaming", type: "string / boolean", default: "- / false", desc: "问题小字 / 流式光标" },
      { name: "@source", type: "-", default: "-", desc: "点击角标或来源行" },
    ],
  },

  /* ---------- M7 · 动效补齐 ---------- */
  {
    dir: "tilt-card", slug: "tilt-card", title: "Tilt Card", category: "动效", components: ["VaTiltCard"],
    desc: "3D 倾斜卡：指针驱动 rotateX/Y（可调最大角与透视）、可选跟随光斑与悬停微放大；reduced-motion 与触屏自动静态。",
    props: [
      { name: "maxTilt / perspective", type: "number / number", default: "8 / 600", desc: "最大倾角度数与透视距离" },
      { name: "glare / glareOpacity", type: "boolean / number", default: "false / 0.18", desc: "跟随光斑" },
      { name: "zoom", type: "boolean", default: "false", desc: "悬停 scale(1.02)" },
    ],
  },
  {
    dir: "blur-crossfade", slug: "blur-crossfade", title: "Blur Crossfade", category: "动效", components: ["VaBlurCrossfade"],
    desc: "内容切换的模糊交叉过渡：target 变化时新内容 blur-in + 上浮；可调时长/模糊半径/位移；reduced-motion 只留淡入。",
    props: [
      { name: "target", type: "string | number", default: "-", desc: "切换键，变化即重播" },
      { name: "duration / blur / rise", type: "number", default: "300 / 8 / 8", desc: "毫秒 / 模糊 px / 上浮 px" },
    ],
  },
  {
    dir: "gradient", slug: "gradient", title: "Gradient Floor / Text", category: "动效", components: ["VaGradientFloor", "VaGradientText"],
    desc: "装饰两件：Floor 是页面底部双色光晕（呼吸动画，绝对定位铺底）；Text 是 background-clip 渐变文字（可缓慢流动）。",
    props: [
      { name: "color / color2 / opacity / height", type: "string / string / number / number", default: "accent / info / 0.5 / 320", desc: "Floor：双色/不透明度/高度" },
      { name: "breathing", type: "boolean", default: "true", desc: "Floor：呼吸动画" },
      { name: "text / from / to / angle / animated", type: "string / … / boolean", default: "- / accent / info / 120 / false", desc: "Text：内容与渐变" },
    ],
  },
];
