<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import VaDialog from "../dialog/VaDialog.vue";
import type { ConfirmItem } from "./types";
import {
  registerConfirmHost,
  settleConfirm,
  unregisterConfirmHost,
  vaConfirm,
} from "./confirm";

/**
 * VaConfirmHost — 命令式确认框宿主（挂在应用根节点一次即可）。
 *
 * 队列串行：只把队首放进 display 渲染；当前项 settle 后先播放 VaDialog 退出动画，
 * 收到 closed 再展示下一个，因此并发调用不会互相覆盖。
 * 安全默认：danger / warning 初始聚焦取消按钮；requireText 时聚焦输入框。
 */
const display = ref<ConfirmItem | null>(null);
const open = ref(false);
const checked = ref(false);
const typed = ref("");

const requireMismatch = computed(() => {
  const need = display.value?.requireText;
  return Boolean(need) && typed.value !== need;
});
const canConfirm = computed(() => !requireMismatch.value);

/** 初始焦点：手输确认优先输入框；危险操作落在取消（安全默认）；其余落在确认 */
const initialFocus = computed(() => {
  const current = display.value;
  if (!current) return undefined;
  if (current.requireText) return ".va-confirm__input";
  if (current.tone === "danger" || current.tone === "warning") return ".va-confirm__btn--cancel";
  return ".va-confirm__btn--confirm";
});

function resetLocalState() {
  checked.value = false;
  typed.value = "";
}

function showHead() {
  const head = vaConfirm.state.queue[0];
  if (!head || display.value) return;
  resetLocalState();
  display.value = head;
  // 先以 closed 落一帧，再置 open 触发 VaDialog 进入过渡
  void nextTick(() => {
    open.value = true;
  });
}

/* 队首变化或当前项清空后，接上下一个（flush: post 保证 DOM 已更新） */
watch(
  () => [vaConfirm.state.queue[0]?.id ?? null, display.value?.id ?? null] as const,
  ([headId, shownId]) => {
    if (shownId === null && headId !== null) showHead();
  },
  { flush: "post" },
);

/* closeAll 等外部清空队列时，当前弹窗也要退出 */
watch(
  () =>
    display.value
      ? vaConfirm.state.queue.some((item) => item.id === display.value!.id)
      : true,
  (stillQueued) => {
    if (!stillQueued && display.value && open.value) open.value = false;
  },
  { flush: "post" },
);

/** 确认或取消：settle Promise（出队）+ 请求关闭，等待 closed 再清空 display */
function finish(ok: boolean) {
  const current = display.value;
  if (!current) return;
  settleConfirm(current.id, ok, checked.value);
  open.value = false;
}

function onClosed() {
  if (!display.value) return;
  display.value = null; // 队首 watcher 会在下一 tick 接上下一个
}

function onInputEnter() {
  if (canConfirm.value) finish(true);
}

onMounted(registerConfirmHost);
onBeforeUnmount(() => {
  unregisterConfirmHost();
  // 宿主卸载时关闭全部待确认项，避免调用方 Promise 永久挂起
  vaConfirm.closeAll();
});
</script>

<template>
  <VaDialog
    v-if="display"
    :open="open"
    :title="display.title"
    :description="display.description"
    :initial-focus="initialFocus"
    :closable="false"
    role="alertdialog"
    size="sm"
    @close="finish(false)"
    @closed="onClosed"
  >
    <template #title>
      <span class="va-confirm__heading" :data-tone="display.tone">
        <span v-if="display.icon" class="va-confirm__icon" aria-hidden="true">
          <svg
            v-if="display.tone === 'danger'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4.5M12 16h.01" />
          </svg>
          <svg
            v-else-if="display.tone === 'warning'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 9v4M12 16.5h.01M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
          <svg
            v-else
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.3a2.4 2.4 0 0 1 4.7.5c0 1.6-2.3 2-2.3 3.4" />
            <path d="M12 16.5h.01" />
          </svg>
        </span>
        <span class="va-confirm__title">{{ display.title }}</span>
      </span>
    </template>

    <div class="va-confirm__body">
      <label v-if="display.requireText" class="va-confirm__field">
        <span class="va-confirm__hint">
          请输入 <code class="va-confirm__need">{{ display.requireText }}</code> 以确认
        </span>
        <input
          v-model="typed"
          class="va-confirm__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="display.requireText"
          @keydown.enter="onInputEnter"
        />
      </label>

      <label v-if="display.checkboxLabel" class="va-confirm__check">
        <input v-model="checked" type="checkbox" />
        <span>{{ display.checkboxLabel }}</span>
      </label>
    </div>

    <template #footer>
      <button
        type="button"
        class="va-act va-confirm__btn va-confirm__btn--cancel"
        @click="finish(false)"
      >
        {{ display.cancelText }}
      </button>
      <button
        type="button"
        class="va-act va-confirm__btn va-confirm__btn--confirm"
        :class="{
          'va-act--primary': display.tone === 'default',
          'va-confirm__btn--danger': display.tone === 'danger',
          'va-confirm__btn--warning': display.tone === 'warning',
        }"
        :disabled="!canConfirm"
        @click="finish(true)"
      >
        {{ display.confirmText }}
      </button>
    </template>
  </VaDialog>
</template>

<style src="./VaConfirm.css"></style>
