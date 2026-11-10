import { computed, ref } from "vue";
import type { ApprovalCardProps, ApprovalResult, DenyReason } from "./types";
import { useCountdown } from "../../composables/useCountdown";

/**
 * VaApprovalCard 的状态逻辑：
 * 倒计时（悬停/聚焦暂停）→ 超时自动拒绝；Enter/Esc 快捷键；一次定终身。
 */
export function useApprovalCard(
  props: ApprovalCardProps,
  emit: { approve: () => void; deny: (reason?: DenyReason) => void },
) {
  const result = ref<ApprovalResult | null>(null);
  const denyReason = ref<DenyReason | undefined>(undefined);
  const paused = ref(false);

  /* ---------- 倒计时（JS 驱动，reduced-motion 下行为一致） ---------- */
  const countdownSeconds = computed(() => props.countdown ?? 0);
  const { remaining, start, stop } = useCountdown(countdownSeconds, paused, () => resolve("denied", "timeout"));

  const riskLabel = computed(() => ({ low: "低风险", medium: "中风险", high: "高风险" })[props.risk ?? "medium"]);
  const percent = computed(() =>
    countdownSeconds.value > 0 ? (remaining.value / countdownSeconds.value) * 100 : 0,
  );

  function resolve(r: ApprovalResult, reason?: DenyReason) {
    if (result.value) return;
    result.value = r;
    denyReason.value = reason;
    stop();
    if (r === "approved") emit.approve();
    else emit.deny(reason);
  }

  function onApprove() {
    resolve("approved");
  }
  function onDeny() {
    resolve("denied", "manual");
  }

  /* ---------- 键盘快捷键 ---------- */
  function onKeydown(e: KeyboardEvent) {
    if (result.value) return;
    const inButton = (e.target as HTMLElement | null)?.closest("button") != null;
    if (e.key === "Enter" && !inButton) {
      e.preventDefault();
      onApprove();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDeny();
    }
  }

  // 挂载即开始倒计时
  start();

  return {
    result,
    denyReason,
    paused,
    remaining,
    percent,
    riskLabel,
    onApprove,
    onDeny,
    onKeydown,
  };
}
