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

export { VaComposer } from "./components/composer";
export type { ComposerEvents, ComposerProps } from "./components/composer";

export { VaModelPicker, DEFAULT_MODELS } from "./components/model-picker";
export type { ModelItem, ModelPickerEvents, ModelPickerProps } from "./components/model-picker";

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

export { VaEmailDraft } from "./components/email-draft";
export type { EmailDraftEvents, EmailDraftProps, ToneOption } from "./components/email-draft";

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

// 工具与算法（InlineDiff 的 diff 能力也可独立使用）
export { formatMs, formatTokens, toDisplayText } from "./utils/format";
export { buildDiffUnits, diffResult, tokenize, wordDiff } from "./utils/wordDiff";
export type { DiffPiece, DiffToken, DiffTokenType } from "./utils/wordDiff";

// 共享 composables（构建自定义 agent UI 时可复用）
export { useNow } from "./composables/useNow";
export { useCountdown } from "./composables/useCountdown";
export { useCopyable } from "./composables/useCopyable";
