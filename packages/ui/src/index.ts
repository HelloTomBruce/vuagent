/**
 * @vuagent/ui — Agent Ops UI components for Vue 3
 * 每个组件目录：VaXxx.vue（薄模板）+ VaXxx.css（样式）+ types.ts（类型）+ useXxx.ts（逻辑）+ index.ts（出口）
 */

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

// 工具与算法（InlineDiff 的 diff 能力也可独立使用）
export { formatMs, formatTokens, toDisplayText } from "./utils/format";
export { buildDiffUnits, diffResult, tokenize, wordDiff } from "./utils/wordDiff";
export type { DiffPiece, DiffToken, DiffTokenType } from "./utils/wordDiff";

// 共享 composables（构建自定义 agent UI 时可复用）
export { useNow } from "./composables/useNow";
export { useCountdown } from "./composables/useCountdown";
