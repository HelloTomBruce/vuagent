import { computed, ref, type Ref } from "vue";
import type { FeedbackKind, MessageActionsProps } from "./types";
import { DEFAULT_FEEDBACK_REASONS } from "./types";
import { useCopyable } from "../../composables/useCopyable";

/**
 * VaMessageActions 的状态逻辑：复制 / 再生成 / 反馈（含原因面板）/ 版本切换。
 * version 由 SFC 的 defineModel 创建后传入（未绑定父层时组件内部自持）。
 * 复制统一走共享 useCopyable（TASK-106：copied 1.5s 置真口径与库内其他组件一致），
 * 图标交叉过渡由模板挂 styles/motion.css 的 .va-copy 结构承接。
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
  /* ---------- 复制（useCopyable：剪贴板写入 + copied 1.5s 置真） ---------- */
  const { copied, copy } = useCopyable(
    () => props.text ?? "",
    (t) => emit.copy(t),
  );

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
