<script setup lang="ts">
/**
 * Agent 动态操作卡片统一分发器
 * - 结构化卡片按 ActionCard.type 分发
 * - "ui" 持久化卡按 data.component（ui_* 契约名）动态分发到对应 Va* 组件
 */
import { computed } from "vue";
import {
  VaApprovalCard,
  VaCodeDiff,
  VaFileTree,
  VaMetricChart,
  VaTerminalLog,
  VaToolCallCard,
  VaTrajectory,
  VaTaskBoard,
  VaChangeSummary,
  VaCommentThread,
  VaAiAnswer,
  getCardComponent,
} from "@vuagent/ui";
import type { ActionCard } from "../types";
import { toolCardDefaultOpen } from "../utils/auto-collapse";
import { useInteractionSettings } from "../composables/useInteractionSettings";

const props = defineProps<{
  card: ActionCard;
  /** 所属 turn 是否仍在流式输出：工具卡「结束后一并折叠」的判定信号（TASK-016 修订） */
  turnStreaming?: boolean;
}>();

defineEmits<{
  (e: "approve"): void;
  (e: "deny", reason?: string): void;
}>();

// toolcall 卡片状态映射：streaming/executing 统一为 VaToolCallCard 的 running
const callStatus = computed(() => {
  const s = props.card.data?.status as string | undefined;
  return s === "error" ? "error" : s === "done" ? "success" : "running";
});

const callSummary = computed(() => {
  const s = props.card.data?.status as string | undefined;
  if (s === "streaming") return "生成调用参数中…";
  if (s === "executing") return "沙箱执行中…";
  if (s === "error") return "执行失败";
  return "执行完成";
});

const { settings } = useInteractionSettings();

/**
 * 工具卡初始展开（TASK-016）：开关开时 streaming/executing 展开、done 收起；
 * 开关关保持原行为。VaToolCallCard 的 defaultOpen 响应式跟随（用户手动操作后不再跟随），
 * error 恒展开由 open-on-error 兜底（失败诊断不折叠）。
 */
const toolCallOpen = computed(() =>
  toolCardDefaultOpen(settings.value, {
    turnStreaming: props.turnStreaming,
    status: props.card.data?.status as string | undefined,
  })
);

/**
 * 审批卡倒计时秒数：优先按 expiresAt 墙钟换算真实剩余（组件重挂载不从头重数），
 * 无 expiresAt 的旧数据回退 expiresInSec 快照；已决策的卡片不再计时。
 */
const approvalCountdown = computed<number | undefined>(() => {
  const status = props.card.data?.status as string | undefined;
  if (status === "approved" || status === "denied") return undefined;
  const expiresAt = props.card.data?.expiresAt as number | undefined;
  if (typeof expiresAt === "number" && expiresAt > 0) {
    return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  }
  return props.card.data?.expiresInSec as number | undefined;
});

// "ui" 持久化卡：可渲染的契约组件集合
// （ui_approval_card 由 HITL 流负责、ui_agent_plan 由 planSteps/DockedPlanBar 负责，此处不渲染）
const UI_RENDERABLE = new Set([
  "ui_code_diff",
  "ui_metric_chart",
  "ui_file_tree",
  "ui_trajectory",
  "ui_task_board",
  "ui_change_summary",
  "ui_comment_thread",
  "ui_ai_answer",
]);

const uiProps = computed<Record<string, any>>(() => props.card.data?.props || {});
const uiComponent = computed(() => String(props.card.data?.component || ""));
const uiRenderable = computed(() => UI_RENDERABLE.has(uiComponent.value));
// 开发者注册的场景自定义卡片组件
const customComponent = computed(() => getCardComponent(uiComponent.value));
</script>

<template>
  <div class="va-console__card-item">
    <!-- ui_* 契约持久化卡 / 场景自定义卡片：优先匹配用户注册组件，其次按内置组件分发，未知组件优雅降级 -->
    <template v-if="card.type === 'ui'">
      <!-- ① 开发者自定义场景组件 -->
      <component
        v-if="customComponent"
        :is="customComponent"
        v-bind="uiProps"
      />
      <!-- ② 内置组件契约分发 -->
      <VaCodeDiff
        v-else-if="uiRenderable && uiComponent === 'ui_code_diff'"
        :file-name="uiProps.fileName"
        :old-text="uiProps.oldText"
        :new-text="uiProps.newText"
        :layout="uiProps.layout || 'unified'"
        :max-height="uiProps.maxHeight"
      />
      <VaMetricChart
        v-else-if="uiRenderable && uiComponent === 'ui_metric_chart'"
        :title="uiProps.title"
        :series="uiProps.series"
      />
      <VaFileTree
        v-else-if="uiRenderable && uiComponent === 'ui_file_tree'"
        :title="uiProps.title"
        :tree="uiProps.tree"
        :default-expand-depth="uiProps.defaultExpandDepth"
      />
      <VaTrajectory
        v-else-if="uiRenderable && uiComponent === 'ui_trajectory'"
        :events="uiProps.events"
        :ledger-max-height="uiProps.ledgerMaxHeight"
      />
      <VaTaskBoard
        v-else-if="uiRenderable && uiComponent === 'ui_task_board'"
        :columns="uiProps.columns"
        :tasks="uiProps.tasks"
      />
      <VaChangeSummary
        v-else-if="uiRenderable && uiComponent === 'ui_change_summary'"
        :title="uiProps.title"
        :files="uiProps.files"
        :duration="uiProps.duration"
        :tool-calls="uiProps.toolCalls"
        :finished-at="uiProps.finishedAt"
      />
      <VaCommentThread
        v-else-if="uiRenderable && uiComponent === 'ui_comment_thread'"
        :comments="uiProps.comments"
        :max-height="uiProps.maxHeight"
        :composer="false"
      />
      <VaAiAnswer
        v-else-if="uiRenderable && uiComponent === 'ui_ai_answer'"
        :question="uiProps.question"
        :answer="uiProps.answer"
        :sources="uiProps.sources"
      />
      <!-- ③ 未知组件优雅降级卡片（防止未注册组件白屏） -->
      <div v-else class="va-custom-card-fallback" style="padding: 10px 14px; border: 1px dashed var(--va-color-border, #cbd5e1); border-radius: 8px; font-size: 13px; margin: 4px 0;">
        <div style="font-weight: 600; margin-bottom: 4px; color: var(--va-color-text-subtle, #64748b);">[场景组件: {{ uiComponent }}]</div>
        <pre style="margin: 0; font-size: 11px; overflow-x: auto; max-height: 160px; background: var(--va-color-bg-subtle, #f8fafc); padding: 8px; border-radius: 4px;">{{ JSON.stringify(uiProps, null, 2) }}</pre>
      </div>
    </template>

    <!-- 工具调用链卡片 (VaToolCallCard)：start → args_delta → executing → result 全生命周期 -->
    <VaToolCallCard
      v-else-if="card.type === 'toolcall'"
      :name="card.data.toolName"
      :summary="callSummary"
      :status="callStatus"
      :args="card.data.args"
      :result="card.data.result"
      :error="card.data.error"
      :started-at="card.data.startedAt"
      :duration="card.data.duration"
      :default-open="toolCallOpen"
      :open-on-error="true"
    />

    <!-- HITL 审批卡片 (VaApprovalCard) -->
    <VaApprovalCard
      v-if="card.type === 'approval'"
      :title="card.data.title || `申请执行: ${card.data.toolName || '工具'}`"
      :risk="card.data.risk"
      :preview="card.data.command"
      :detail="card.data.detail"
      :status="card.data.status || 'pending'"
      :reason="card.data.reason"
      :countdown="approvalCountdown"
      :collapsible="true"
      :default-collapsed="card.data.status === 'approved' || card.data.status === 'denied'"
      @approve="$emit('approve')"
      @deny="(reason) => $emit('deny', reason)"
    />

    <!-- 代码变更 Diff 卡片 (VaCodeDiff) -->
    <VaCodeDiff
      v-else-if="card.type === 'diff'"
      :file-name="card.data.file"
      :old-text="card.data.oldCode"
      :new-text="card.data.newCode"
      :layout="card.data.view || 'unified'"
    />

    <!-- 终端命令日志 (VaTerminalLog) -->
    <VaTerminalLog
      v-else-if="card.type === 'terminal'"
      :title="card.data.title"
      :lines="card.data.lines"
    />

    <!-- 性能监控指标 (VaMetricChart) -->
    <VaMetricChart
      v-else-if="card.type === 'metric'"
      :title="card.data.title"
      :series="card.data.series"
    />

    <!-- 工作区文件树 (VaFileTree) -->
    <VaFileTree
      v-else-if="card.type === 'tree'"
      :title="card.data.title"
      :tree="card.data.tree"
      :default-expand-depth="card.data.defaultExpandDepth"
    />

    <!-- 执行轨迹时间线 (VaTrajectory) -->
    <VaTrajectory
      v-else-if="card.type === 'trajectory'"
      :events="card.data.events"
      :ledger-max-height="card.data.ledgerMaxHeight"
    />
  </div>
</template>
