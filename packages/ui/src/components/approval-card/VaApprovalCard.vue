<script setup lang="ts">
import type { ApprovalCardProps, DenyReason } from "./types";
import { useApprovalCard } from "./useApprovalCard";

const props = withDefaults(defineProps<ApprovalCardProps>(), {
  detail: undefined,
  preview: undefined,
  risk: "medium",
  confirmLabel: "批准",
  denyLabel: "拒绝",
  countdown: undefined,
  shortcuts: true,
});

const emit = defineEmits<{ approve: []; deny: [reason?: DenyReason] }>();

const { result, denyReason, paused, percent, riskLabel, onApprove, onDeny, onKeydown } = useApprovalCard(props, {
  approve: () => emit("approve"),
  deny: (reason) => emit("deny", reason),
});
</script>

<template>
  <div
    class="va-acd"
    :class="[`va-acd--${props.risk}`, result ? `va-acd--${result}` : '']"
    tabindex="-1"
    role="alertdialog"
    :aria-label="props.title"
    @keydown="onKeydown"
    @pointerenter="paused = true"
    @pointerleave="paused = false"
    @focusin="paused = true"
    @focusout="paused = false"
  >
    <!-- 倒计时条 -->
    <div v-if="props.countdown && !result" class="va-acd__count" aria-hidden="true">
      <span class="va-acd__count-fill" :style="{ width: `${percent}%` }" />
    </div>

    <div class="va-acd__main">
      <header class="va-acd__head">
        <span class="va-acd__risk" :data-risk="props.risk">{{ riskLabel }}</span>
        <h4 class="va-acd__title">{{ props.title }}</h4>
      </header>
      <p v-if="props.detail" class="va-acd__detail">{{ props.detail }}</p>
      <pre v-if="props.preview" class="va-acd__preview">{{ props.preview }}</pre>

      <div class="va-acd__actions">
        <button class="va-btn va-acd__btn" type="button" @click="onDeny">{{ props.denyLabel }}</button>
        <button class="va-btn va-btn--ink va-acd__btn" type="button" @click="onApprove">{{ props.confirmLabel }}</button>
        <span v-if="props.shortcuts && !result" class="va-acd__kbd-hint">
          <kbd>Enter</kbd> 批准 · <kbd>Esc</kbd> 拒绝
        </span>
      </div>
    </div>

    <!-- 决策后的结果行 -->
    <div v-if="result" class="va-acd__done" role="status">
      <svg v-if="result === 'approved'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <path d="M5.5 12.5l4 4L18.5 8" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="m7.5 7.5 9 9m0-9-9 9" />
      </svg>
      <span>{{ result === "approved" ? "已批准" : denyReason === "timeout" ? "超时未响应，已自动拒绝" : "已拒绝" }}</span>
      <span v-if="props.detail" class="va-acd__done-detail">{{ props.detail }}</span>
    </div>
  </div>
</template>

<style src="./VaApprovalCard.css"></style>
