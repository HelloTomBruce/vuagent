/**
 * @vuagent/ui — Agent Ops UI components for Vue 3
 * 每个组件目录：VaXxx.vue（薄模板）+ VaXxx.css（样式）+ types.ts（类型）+ useXxx.ts（逻辑）+ index.ts（出口）
 */
// 按钮基类随聚合样式分发（registry 拷贝时生成器会自动内联到组件文件）
import "./styles/button.css";

// 基础（M1 打样）
export { VaButton } from "./components/button";
export type { ButtonProps, ButtonSize, ButtonSlots, ButtonVariant } from "./components/button";

export { VaNumberTicker } from "./components/number-ticker";
export type { NumberTickerProps, TickerPart } from "./components/number-ticker";

export { VaShimmerText, VaSkeleton } from "./components/shimmer";
export type { ShimmerTextProps, SkeletonProps } from "./components/shimmer";

// P1 Agent-Ops 旗舰（M2）
export { VaToolCallCard, VaToolCallGroup } from "./components/tool-call";
export type {
  ToolCallCardProps,
  ToolCallGroupProps,
  ToolCallMeta,
  ToolCallStatus,
} from "./components/tool-call";

export { VaDecisionInbox } from "./components/decision-inbox";
export type {
  Decision,
  DecisionAnswer,
  DecisionInboxEvents,
  DecisionInboxProps,
} from "./components/decision-inbox";

export { VaApprovalCard } from "./components/approval-card";
export type {
  ApprovalCardEvents,
  ApprovalCardProps,
  ApprovalResult,
  ApprovalRisk,
  DenyReason,
} from "./components/approval-card";

export { VaMetricChart } from "./components/metric-chart";
export type { MetricChartProps, MetricSeriesItem } from "./components/metric-chart";

export { VaAgentPlan } from "./components/agent-plan";
export type { AgentPlanEvents, AgentPlanProps, PlanStep, PlanStepStatus } from "./components/agent-plan";

export { VaAgentInbox, AGENT_STATUS_LABEL } from "./components/agent-inbox";
export type {
  AgentInboxEvents,
  AgentInboxProps,
  AgentTask,
  AgentTaskStatus,
  InboxFilter,
} from "./components/agent-inbox";

export { VaContextWindow, CONTEXT_KIND_LABEL } from "./components/context-window";
export type {
  ContextKind,
  ContextPart,
  ContextWindowEvents,
  ContextWindowProps,
} from "./components/context-window";

export { VaInlineDiff } from "./components/inline-diff";
export type { InlineDiffEvents, InlineDiffProps } from "./components/inline-diff";

export { VaMemoryPanel } from "./components/memory-panel";
export type { MemoryItem, MemoryPanelEvents, MemoryPanelProps } from "./components/memory-panel";

// P2 Chat 配套（M3）
export { VaThinkingLoader } from "./components/thinking-loader";
export type { ThinkingLoaderProps } from "./components/thinking-loader";

export { VaQueueDock } from "./components/queue-dock";
export type { QueueDockEvents, QueueDockProps, QueueItem } from "./components/queue-dock";
export { VaComposer } from "./components/composer";
export type { ComposerAttachment, ComposerEvents, ComposerModelOption, ComposerPermissionOption, ComposerProps } from "./components/composer";

export { VaModelPicker, DEFAULT_MODELS } from "./components/model-picker";
export type { ModelItem, ModelPickerEvents, ModelPickerProps } from "./components/model-picker";
export { VaDock } from "./components/dock";
export type { DockEvents, DockPaneState, DockProps, DockTab } from "./components/dock";
export { VaTrajectory } from "./components/trajectory";
export type { TrajEvent, TrajLane, TrajRole, TrajStats, TrajectoryEvents, TrajectoryProps } from "./components/trajectory";
export { VaConversationHeader } from "./components/conversation-header";
export type { ConversationHeaderEvents, ConversationHeaderProps, HeaderView } from "./components/conversation-header";
export { VaEmptyHero } from "./components/empty-hero";
export type { EmptyHeroEvents, EmptyHeroProps, HeroWorkspace } from "./components/empty-hero";
export { VaCapabilityCard } from "./components/capability-card";
export type { CapabilityCardEvents, CapabilityCardProps } from "./components/capability-card";
export { VaSessionManager } from "./components/session-manager";
export type { SessionItem, SessionManagerEvents, SessionManagerProps } from "./components/session-manager";
export { VaSessionTree } from "./components/session-tree";
export type { SessionTreeEvents, SessionTreeProps, TreeSession, TreeWorkspace } from "./components/session-tree";

export { VaStreamAnswer } from "./components/stream-answer";
export type { StreamAnswerProps } from "./components/stream-answer";

export { VaMessageActions, VaMessageText, DEFAULT_FEEDBACK_REASONS } from "./components/message-actions";
export type {
  FeedbackKind,
  MessageActionKind,
  MessageActionsEvents,
  MessageActionsProps,
  MessageTextProps,
} from "./components/message-actions";

// P3 基础/动效补齐（M3）
export { VaSegmentedControl } from "./components/segmented-control";
export type { SegmentedControlEvents, SegmentedControlProps, SegmentOption } from "./components/segmented-control";

export { useToaster, vaToaster, VaToaster } from "./components/toaster";
export type { ToasterProps, ToastInput, ToastItem, ToastKind } from "./components/toaster";

export { VaTextReveal } from "./components/text-reveal";
export type { TextRevealProps } from "./components/text-reveal";

export { VaGridBackground } from "./components/grid-background";
export type { GridBackgroundProps, GridDirection } from "./components/grid-background";

// M5 · Agent 客户端刚需批
// 差异化 4 件（affectUI 没有的 agent 验收主界面）
export { VaCodeDiff } from "./components/code-diff";
export type { CodeDiffEvents, CodeDiffProps, CodeDiffStats } from "./components/code-diff";

export { VaFileTree, buildFileTree, FILE_STATUS_LABEL } from "./components/file-tree";
export type { FileNode, FileStatus, FileTreeEvents, FileTreeProps } from "./components/file-tree";

export { VaTerminalLog } from "./components/terminal-log";
export type {
  TerminalLine,
  TerminalLineKind,
  TerminalLogEvents,
  TerminalLogProps,
} from "./components/terminal-log";

export { VaCheckpointList, formatRelative } from "./components/checkpoint-list";
export type { Checkpoint, CheckpointListEvents, CheckpointListProps } from "./components/checkpoint-list";

// 对标 5 件（affectUI Free/Pro）
export { VaCommentThread } from "./components/comment-thread";
export type { CommentItem, CommentThreadEvents, CommentThreadProps } from "./components/comment-thread";

export { VaUsageMeter } from "./components/usage-meter";
export type { UsageMeterEvents, UsageMeterProps, UsageSegment } from "./components/usage-meter";

export { VaCommandMenu } from "./components/command-menu";
export type { CommandItem, CommandMenuEvents, CommandMenuProps } from "./components/command-menu";

export { VaDropzone, formatBytes } from "./components/dropzone";
export type {
  DropzoneEvents,
  DropzoneFile,
  DropzoneFileStatus,
  DropzoneProps,
} from "./components/dropzone";

// M6 · 输入·表单·导航·反馈批
export { VaCombobox } from "./components/combobox";
export type { ComboboxEvents, ComboboxOption, ComboboxProps } from "./components/combobox";

// 纯选择型下拉（基于 VaPopover，单选/多选/可搜索/可清除）
export { VaSelect, useSelect } from "./components/select";
export type {
  SelectEvents,
  SelectOption,
  SelectProps,
  SelectSlots,
  SelectValue,
} from "./components/select";

// 动作下拉菜单（三点菜单）：键盘导航 + 一层子菜单 + danger/checked 项（基于 VaPopover，bottom-end）
export { VaDropdown, useDropdown } from "./components/dropdown";
export type {
  DropdownEntry,
  DropdownEvents,
  DropdownItem,
  DropdownPlacement,
  DropdownProps,
  DropdownSlots,
  DropdownTrigger,
} from "./components/dropdown";

// Overlay 原语（Select / Dropdown / Tooltip 共用基座）
export { VaPopover, useFloating } from "./components/popover";
export type {
  ComputeFloatingOptions,
  FloatingResult,
  PopoverAnchor,
  PopoverEvents,
  PopoverPlacement,
  PopoverProps,
  PopoverSlots,
  VirtualAnchor,
} from "./components/popover";

// 轻量文字提示（基于 VaPopover；hover/focus 延迟显示 + Esc 关闭 + aria-describedby 回填）
export { VaTooltip } from "./components/tooltip";
export type {
  TooltipEvents,
  TooltipPlacement,
  TooltipProps,
  TooltipSlots,
  TooltipVariant,
} from "./components/tooltip";

// 模态弹窗原语（焦点陷阱 + 焦点恢复 + 堆叠栈 + 滚动锁）
export { VaDialog, useFocusTrap } from "./components/dialog";
export type { DialogEvents, DialogProps, DialogSize, DialogSlots } from "./components/dialog";

// 命令式确认框（Promise 化；基于 VaDialog，队列串行；tone / requireText / checkbox）
export { VaConfirmHost, useConfirm, vaConfirm } from "./components/confirm";
export type {
  ConfirmItem,
  ConfirmOptions,
  ConfirmResult,
  ConfirmState,
  ConfirmTone,
  VaConfirm,
} from "./components/confirm";

export { VaFilterMenu } from "./components/filter-menu";
export type {
  FilterGroup,
  FilterMenuEvents,
  FilterMenuProps,
  FilterOption,
  FilterValue,
} from "./components/filter-menu";

export { VaOtpInput } from "./components/otp-input";
export type { OtpInputEvents, OtpInputProps } from "./components/otp-input";

export { VaProfileMenu } from "./components/profile-menu";
export type { ProfileMenuEvents, ProfileMenuItem, ProfileMenuProps } from "./components/profile-menu";

export { VaStepperForm } from "./components/stepper-form";
export type { StepperFormEvents, StepperFormProps, StepperStep } from "./components/stepper-form";

export { VaProgressTracker } from "./components/progress-tracker";
export type {
  ProgressTrackerEvents,
  ProgressTrackerProps,
  TrackerStep,
  TrackerStepStatus,
} from "./components/progress-tracker";

export { VaSetupGuide } from "./components/setup-guide";
export type { SetupGuideEvents, SetupGuideProps, SetupStep } from "./components/setup-guide";

export { VaSmartRecommendation } from "./components/smart-recommendation";
export type {
  RecommendationAction,
  SmartRecommendationEvents,
  SmartRecommendationProps,
} from "./components/smart-recommendation";

export { VaPromptLibrary } from "./components/prompt-library";
export type { PromptItem, PromptLibraryEvents, PromptLibraryProps } from "./components/prompt-library";

export { VaDateRangePicker, addDays, dayStart, fmtDate, monthGrid } from "./components/date-range-picker";
export type { DateRangePickerEvents, DateRangePickerProps, DateRangePreset } from "./components/date-range-picker";

export { VaIntegrationPicker, VaIntegrationSettings } from "./components/integration";
export type {
  IntegrationField,
  IntegrationItem,
  IntegrationPickerEvents,
  IntegrationPickerProps,
  IntegrationSettingsEvents,
  IntegrationSettingsProps,
} from "./components/integration";

export { VaNotificationStack } from "./components/notification-stack";
export type {
  NotificationItem,
  NotificationKind,
  NotificationStackEvents,
  NotificationStackProps,
} from "./components/notification-stack";

export { VaTipsPanel } from "./components/tips-panel";
export type { TipItem, TipsPanelEvents, TipsPanelProps } from "./components/tips-panel";

export { VaReactionBar } from "./components/reaction-bar";
export type { ReactionBarEvents, ReactionItem, ReactionBarProps } from "./components/reaction-bar";

export { VaChangeSummary } from "./components/change-summary";
export type { ChangeSummaryEvents, ChangeSummaryProps, SummaryFile } from "./components/change-summary";

// M7 · 数据图表（手写 SVG/零依赖）
export { VaKpiChart } from "./components/kpi-chart";
export type { KpiChartEvents, KpiChartProps } from "./components/kpi-chart";

export { VaBreakdownChart } from "./components/breakdown-chart";
export type { BreakdownChartEvents, BreakdownChartProps, BreakdownItem } from "./components/breakdown-chart";

export { VaCompactBreakdown } from "./components/compact-breakdown";
export type { CompactBreakdownProps, CompactSegment } from "./components/compact-breakdown";

export { VaExperimentCard } from "./components/experiment-card";
export type {
  ExperimentCardEvents,
  ExperimentCardProps,
  ExperimentStatus,
  ExperimentVariant,
} from "./components/experiment-card";

export { VaAiAnswer } from "./components/ai-answer";
export type { AiAnswerEvents, AiAnswerProps, AnswerSource } from "./components/ai-answer";

// M7 · 动效补齐
export { VaTiltCard } from "./components/tilt-card";
export type { TiltCardProps } from "./components/tilt-card";

export { VaBlurCrossfade } from "./components/blur-crossfade";
export type { BlurCrossfadeProps } from "./components/blur-crossfade";

export { VaGradientFloor, VaGradientText } from "./components/gradient";
export type { GradientFloorProps, GradientTextProps } from "./components/gradient";

// M7 · Screens 精选（页面骨架，slot 编排既有组件）
export { VaAppShell } from "./components/app-shell";
export type { AppShellEvents, AppShellProps, NavItem } from "./components/app-shell";

export { VaAgentChat } from "./components/agent-chat";
export type { AgentChatEvents, AgentChatProps, ChatThreadMessage } from "./components/agent-chat";

export { VaAgentRun } from "./components/agent-run";
export type { AgentRunEvents, AgentRunProps } from "./components/agent-run";

export { VaOnboarding } from "./components/onboarding";
export type { OnboardingEvents, OnboardingProps } from "./components/onboarding";

export { VaSettingsBilling } from "./components/settings-billing";
export type { BillingPlan, SettingsBillingEvents, SettingsBillingProps } from "./components/settings-billing";

// M7 · Blocks 精选
export { VaTaskBoard } from "./components/task-board";
export type {
  BoardColumn,
  BoardTask,
  TaskBoardEvents,
  TaskBoardProps,
  TaskPriority,
} from "./components/task-board";

export { VaPricingPlans, VaAIWorkspace } from "./components/workspace-blocks";
export type {
  AIWorkspaceEvents,
  AIWorkspaceProps,
  PricingPlansEvents,
  PricingPlansProps,
  PricingTier,
  WorkspaceFile,
} from "./components/workspace-blocks";

// M7 · 插画精选（纯装饰）
export { VaVoiceOrb, VaAgentTeam, VaModelWheel } from "./components/illustrations";
export type { AgentTeamProps, ModelWheelProps, VoiceOrbProps, VoiceState } from "./components/illustrations";

// 工具与算法（InlineDiff 的 diff 能力也可独立使用）
export { formatMs, formatTokens, toDisplayText } from "./utils/format";
export { buildDiffUnits, diffResult, tokenize, wordDiff } from "./utils/wordDiff";
export type { DiffPiece, DiffToken, DiffTokenType } from "./utils/wordDiff";

// 共享 composables（构建自定义 agent UI 时可复用）
export { useNow } from "./composables/useNow";
export { useCountdown } from "./composables/useCountdown";
export { useCopyable } from "./composables/useCopyable";
export { useStickToBottom, BOTTOM_THRESHOLD_PX } from "./composables/useStickToBottom";
export type { ScrollToBottomOptions, UseStickToBottomOptions } from "./composables/useStickToBottom";

// Agentic Runtime 运行时核心
// 显式按需导出（不用 export *）：
// 1. 避免 agent-chat 的 ChatThreadMessage 与 runtime 的 ChatMessage 等同名符号被静默遮蔽
//    （export * 的命名冲突会静默丢弃星号侧，见 TASK-013）；
// 2. 保持模块图无副作用，保证消费方 tree-shaking（registry 不再有顶层副作用调用）。
export {
  AgentUIRegistry,
  CardSkeleton,
  ChartSkeleton,
  CodeSkeleton,
  getAgentComponent,
  registerAgentComponent,
  setupDefaultAgentRegistry,
  unregisterAgentComponent,
} from "./runtime/registry";
export { useAgentChat } from "./runtime/useAgentChat";
export type { ChatMessage, SendMessageOptions, UseAgentChatOptions } from "./runtime/useAgentChat";
export type {
  AgentComponentBaseProps,
  AgentComponentStatus,
  AgentRendererProps,
  CustomProviderConfig,
  MessageBlock,
  RegisteredComponentEntry,
  UIStreamEvent,
} from "./runtime/types";
export { default as VaAgentRenderer } from "./runtime/VaAgentRenderer.vue";

// 场景自定义卡片注册中心（CardRegistry，支持场景 Agent 自由扩展富组件展现）
export {
  useCardRegistry,
  registerCardComponent,
  unregisterCardComponent,
  getCardComponent,
  clearCardComponents,
} from "./composables/useCardRegistry";


