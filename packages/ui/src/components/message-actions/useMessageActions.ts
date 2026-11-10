import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import type { FeedbackKind, MessageActionsProps } from "./types";
import { DEFAULT_FEEDBACK_REASONS } from "./types";

/**
 * VaMessageActions 的状态逻辑：复制 / 再生成 / 反馈（含原因面板）/ 版本切换。
 * version 由 SFC 的 defineModel 创建后传入（未绑定父层时组件内部自持）。
 */
export function useMessageActions(
  props: MessageActionsProps,
  version: Ref<number | undefined>,
  emit: {
    copy: (text?: string) => void;
    regenerate: () => void;
    versionChange: (index: number) => void;
    feedback: (kind: FeedbackKind | null, reason?: string) => void;
  },
) {
  /* ---------- 复制 ---------- */
  const copied = ref(false);
  let copiedTimer: number | undefined;
  async function copy() {
    const t = props.text ?? "";
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(t);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
    } catch {
      /* 剪贴板不可用时静默（宿主可监听 copy 事件自行提示） */
    }
    copied.value = true;
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => (copied.value = false), 1500);
    emit.copy(t);
  }
  onBeforeUnmount(() => {
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer);
  });

  /* ---------- 反馈 ---------- */
  const chosen = ref<FeedbackKind | null>(null);
  const panelOpen = ref(false);
  const reasons = computed(() => props.reasons ?? DEFAULT_FEEDBACK_REASONS);
  const customReason = ref("");

  function thumb(kind: FeedbackKind) {
    if (kind === "up") {
      chosen.value = chosen.value === "up" ? null : "up";
      panelOpen.value = false;
      emit.feedback(chosen.value);
      return;
    }
    // down：首次打开原因面板，再点收起
    if (panelOpen.value) {
      panelOpen.value = false;
      return;
    }
    chosen.value = "down";
    panelOpen.value = true;
    customReason.value = "";
  }
  function sendDown(reason: string) {
    chosen.value = "down";
    panelOpen.value = false;
    emit.feedback("down", reason || undefined);
  }
  function takeBack() {
    chosen.value = null;
    panelOpen.value = false;
    emit.feedback(null);
  }

  /* ---------- 版本 ---------- */
  const count = computed(() => (typeof props.versions === "number" ? Math.max(1, props.versions) : 1));
  const showVersions = computed(() => count.value >= 2);
  /** 未绑定（undefined）时视为"跟随最新" */
  const effective = computed(() => {
    const v = version.value;
    if (v == null || v < 0 || v >= count.value) return count.value - 1;
    return v;
  });
  function go(dir: -1 | 1) {
    const next = Math.min(count.value - 1, Math.max(0, effective.value + dir));
    version.value = next;
    emit.versionChange(next);
  }

  return {
    copied,
    copy,
    chosen,
    panelOpen,
    reasons,
    customReason,
    thumb,
    sendDown,
    takeBack,
    count,
    effective,
    showVersions,
    go,
  };
}
