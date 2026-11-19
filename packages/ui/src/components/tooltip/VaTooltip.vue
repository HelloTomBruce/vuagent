<script setup lang="ts">
import { onBeforeUnmount, ref, useId, useTemplateRef, watch } from "vue";
import { VaPopover } from "../popover";
import type { TooltipEvents, TooltipProps, TooltipSlots } from "./types";

/**
 * VaTooltip — 轻量文字提示（基于 VaPopover，无交互，仅 hover/focus 展示）。
 *
 * 与 VaPopover 的分工：popover 是通用浮层原语（点击切换、可承载交互内容）；
 * tooltip 只做「延迟显示的只读文字提示」——
 *   - 触发：mouseenter / focusin 开（带 delay），mouseleave / focusout 关（带 hideDelay），Esc 立即关；
 *   - 触发元素自动回填 aria-describedby 指向浮层 id（触发器自带 aria-label 时跳过，避免覆盖/冗余播报）；
 *   - 浮层 role=tooltip 且 pointer-events:none（不拦截指针、不可悬停停留，因此无交互内容）；
 *   - 不用 VaPopover 的 trigger 插槽（它会绑点击切换），自渲染触发包装元素并以 anchor 形式喂给 popover。
 *
 * 与原生 title 的关系：元素同时带 title 时建议移除 title 改用本组件
 * （title 不可样式化、延迟/播报行为浏览器各异）；二者共存时本组件不处理 title，由宿主自行取舍。
 */

const props = withDefaults(defineProps<TooltipProps>(), {
  placement: "top",
  delay: 300,
  hideDelay: 80,
  maxWidth: 280,
  variant: "inverse",
  disabled: false,
});
const emit = defineEmits<TooltipEvents>();
const slots = defineSlots<TooltipSlots>();

const tooltipId = `va-tip-${useId()}`;
const isOpen = ref(false);
const triggerEl = useTemplateRef<HTMLElement>("trigger");

/* ---------------- 延迟开关状态机 ---------------- */

let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearShowTimer() {
  if (showTimer != null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}
function clearHideTimer() {
  if (hideTimer != null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** content prop 与 #content 插槽皆空时不显示（不渲染空气泡） */
function hasContent() {
  return !!props.content || !!slots.content;
}

function show() {
  clearShowTimer();
  clearHideTimer();
  if (props.disabled || isOpen.value || !hasContent()) return;
  isOpen.value = true;
  emit("show");
}

function hide() {
  clearShowTimer();
  clearHideTimer();
  if (!isOpen.value) return;
  isOpen.value = false;
  emit("hide");
}

function onEnter() {
  if (props.disabled) return;
  clearHideTimer(); // hideDelay 内回移：取消关闭，保持打开
  if (isOpen.value || showTimer != null) return;
  showTimer = setTimeout(() => {
    showTimer = null;
    show();
  }, props.delay);
}

function onLeave() {
  clearShowTimer(); // 未开先走：取消待打开
  if (!isOpen.value || hideTimer != null) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    hide();
  }, props.hideDelay);
}

/** popover 内部请求关闭（Esc 栈顶 / 外部 mousedown）→ 立即关，不走 hideDelay */
function onPopoverUpdate(v: boolean) {
  if (!v) hide();
}

/* 禁用即收：打开中/待打开被置 disabled 时立即关闭 */
watch(
  () => props.disabled,
  (d) => {
    if (d) hide();
  },
);

/* ---------------- aria-describedby 回填 ---------------- */

const FOCUSABLE_SELECTOR = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** 回填目标：包装内首个可聚焦元素 → 首个子元素 → 包装元素自身 */
function resolveDescribeTarget(): HTMLElement | null {
  const wrap = triggerEl.value;
  if (!wrap) return null;
  return (
    wrap.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
    (wrap.firstElementChild as HTMLElement | null) ??
    wrap
  );
}

/** 记录实际回填的元素，关闭/卸载时精确回收（不依赖再次解析） */
let describedEl: HTMLElement | null = null;

function applyDescription() {
  const el = resolveDescribeTarget();
  if (!el) return;
  // 触发器自带 aria-label：可访问名已自足，不再补 describedby（避免覆盖与冗余播报）
  if (el.hasAttribute("aria-label")) return;
  const tokens = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  if (tokens.includes(tooltipId)) return;
  el.setAttribute("aria-describedby", [...tokens, tooltipId].join(" "));
  describedEl = el;
}

function removeDescription() {
  const el = describedEl;
  describedEl = null;
  if (!el) return;
  const tokens = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const next = tokens.filter((t) => t !== tooltipId);
  if (next.length) el.setAttribute("aria-describedby", next.join(" "));
  else el.removeAttribute("aria-describedby");
}

/* 打开才回填（浮层 v-if 渲染，关闭时回填会留下悬空引用） */
watch(isOpen, (v) => {
  if (v) applyDescription();
  else removeDescription();
});

onBeforeUnmount(() => {
  clearShowTimer();
  clearHideTimer();
  removeDescription();
});

defineExpose({ show, hide });
</script>

<template>
  <span
    ref="trigger"
    class="va-tip__trigger"
    :data-disabled="props.disabled || undefined"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focusin="onEnter"
    @focusout="onLeave"
  >
    <slot />
  </span>

  <VaPopover
    :open="isOpen"
    :anchor="triggerEl"
    :placement="props.placement"
    :disabled="props.disabled"
    :close-on-outside-click="true"
    :close-on-escape="true"
    @update:open="onPopoverUpdate"
  >
    <div
      :id="tooltipId"
      class="va-tip"
      role="tooltip"
      :data-variant="props.variant"
      :style="{ maxWidth: `${props.maxWidth}px` }"
    >
      <slot name="content">{{ props.content }}</slot>
    </div>
  </VaPopover>
</template>

<style src="./VaTooltip.css"></style>
