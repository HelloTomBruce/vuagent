<script setup lang="ts">
import { onMounted, ref, useId } from "vue";
import type { ApprovalRisk, ApprovalResult, DenyReason } from "./types";
import { useApprovalCard } from "./useApprovalCard";

interface ApprovalCardProps {
  title: string;
  detail?: string;
  risk?: ApprovalRisk;
  preview?: string;
  confirmLabel?: string;
  denyLabel?: string;
  countdown?: number;
  shortcuts?: boolean;
  /** 显式开启后 Enter=批准；缺省 Enter 与 Esc 均为拒绝（安全默认） */
  approveShortcut?: boolean;
  /** 外部传入状态持久化支持："approved" | "denied" | "pending" */
  status?: ApprovalResult | "pending";
  /** 外部传入决策原因，例如超时或用户驳回说明 */
  reason?: string;
  /** 是否支持折叠展开，默认 true */
  collapsible?: boolean;
  /** 默认是否折叠，不传时若已决策默认折叠，未决策默认展开 */
  defaultCollapsed?: boolean;
}

const props = withDefaults(defineProps<ApprovalCardProps>(), {
  detail: undefined,
  preview: undefined,
  risk: "medium",
  confirmLabel: "批准",
  denyLabel: "拒绝",
  countdown: undefined,
  shortcuts: true,
  approveShortcut: false,
  status: undefined,
  reason: undefined,
  collapsible: true,
  defaultCollapsed: undefined,
});

const emit = defineEmits<{ approve: []; deny: [reason?: DenyReason] }>();

const {
  result,
  denyReason,
  paused,
  percent,
  remaining,
  riskLabel,
  isCollapsed,
  toggleCollapse,
  onApprove,
  onDeny,
  onKeydown,
} = useApprovalCard(props, {
  approve: () => emit("approve"),
  deny: (reason) => emit("deny", reason),
});

/* ---------- a11y：alertdialog 初始聚焦 + 焦点内移时暂停倒计时 ---------- */
const rootEl = ref<HTMLElement | null>(null);
const detailId = useId();

onMounted(() => {
  // 审批卡是 agent 危险操作的最后闸门（role=alertdialog）：挂载即聚焦容器，
  // 让键盘/读屏用户无需先点击即可按 Enter/Esc 拒绝。
  if (!result.value) rootEl.value?.focus();
});

// 容器自身获焦（含上面的初始聚焦）不暂停倒计时——否则"超时自动拒绝"会被静默冻结；
// 焦点进入内部按钮等可交互元素时才暂停，离开卡片即恢复。
function onFocusIn(e: FocusEvent) {
  if (e.target !== rootEl.value) paused.value = true;
}
function onFocusOut(e: FocusEvent) {
  if (e.relatedTarget && rootEl.value?.contains(e.relatedTarget as Node)) return;
  paused.value = false;
}
</script>

<template>
  <div
    ref="rootEl"
    class="va-acd"
    :class="[
      `va-acd--${props.risk}`,
      result ? `va-acd--${result}` : '',
      isCollapsed ? 'va-acd--collapsed' : '',
    ]"
    tabindex="-1"
    role="alertdialog"
    aria-modal="true"
    :aria-label="props.title"
    :aria-describedby="props.detail ? detailId : undefined"
    @keydown="onKeydown"
    @pointerenter="paused = true"
    @pointerleave="paused = false"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <!-- 倒计时进度条 (仅未决策且未折叠时展示) -->
    <div v-if="props.countdown && !result && !isCollapsed" class="va-acd__count" aria-hidden="true">
      <span class="va-acd__count-fill" :style="{ width: `${percent}%` }" />
    </div>

    <!-- 顶部状态与摘要栏 (支持点击折叠/展开) -->
    <header
      class="va-acd__head"
      :class="{ 'va-acd__head--clickable': props.collapsible !== false }"
      @click="props.collapsible !== false ? toggleCollapse() : null"
    >
      <span class="va-acd__risk" :data-risk="props.risk">{{ riskLabel }}</span>
      <h4 class="va-acd__title">{{ props.title }}</h4>

      <!-- 未决策时的倒计时提示 -->
      <span
        v-if="props.countdown && !result"
        class="va-acd__timer"
        role="timer"
        aria-live="off"
      >
        {{ Math.ceil(remaining) }}s 后自动拒绝
      </span>

      <!-- 决策后的徽标状态 -->
      <span v-else-if="result" class="va-acd__status-badge" :class="`va-acd__status-badge--${result}`">
        <svg v-if="result === 'approved'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
          <path d="M5.5 12.5l4 4L18.5 8" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="m7.5 7.5 9 9m0-9-9 9" />
        </svg>
        <span>{{ result === "approved" ? "已批准" : denyReason === "timeout" ? "超时已拒" : "已拒绝" }}</span>
      </span>

      <!-- 折叠/展开切换按钮 -->
      <button
        v-if="props.collapsible !== false"
        class="va-acd__collapse-btn"
        type="button"
        :title="isCollapsed ? '展开详情' : '收起卡片'"
        @click.stop="toggleCollapse"
      >
        <svg v-if="isCollapsed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </header>

    <!-- 可折叠正文主体 -->
    <div v-show="!isCollapsed" class="va-acd__main">
      <p v-if="props.detail" :id="detailId" class="va-acd__detail">{{ props.detail }}</p>
      <pre v-if="props.preview" class="va-acd__preview">{{ props.preview }}</pre>

      <!-- 待审批交互按钮组 -->
      <div v-if="!result" class="va-acd__actions">
        <button class="va-act va-acd__btn" type="button" @click.stop="onDeny">{{ props.denyLabel }}</button>
        <button class="va-act va-act--ink va-acd__btn" type="button" @click.stop="onApprove">{{ props.confirmLabel }}</button>
        <span v-if="props.shortcuts && !result" class="va-acd__kbd-hint">
          <template v-if="props.approveShortcut"><kbd>Enter</kbd> 批准 · <kbd>Esc</kbd> 拒绝</template>
          <template v-else><kbd>Enter / Esc</kbd> 拒绝</template>
        </span>
      </div>

      <!-- 决策后的结果状态行 (展开时补充显示细节) -->
      <div v-else class="va-acd__done" role="status">
        <span>{{ result === "approved" ? "已批准执行该操作" : denyReason === "timeout" ? "超时未响应，已自动拒绝" : "已拒绝执行该操作" }}</span>
        <span v-if="props.detail" class="va-acd__done-detail">{{ props.detail }}</span>
      </div>
    </div>
  </div>
</template>

<style src="./VaApprovalCard.css"></style>
