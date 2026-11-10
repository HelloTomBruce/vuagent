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
];
