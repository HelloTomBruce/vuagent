import { computed, ref, watch } from "vue";
import type { ApprovalCardProps, ApprovalResult, DenyReason } from "./types";
import { useCountdown } from "../../composables/useCountdown";

/**
 * VaApprovalCard 的状态逻辑：
 * 倒计时（悬停/聚焦暂停）→ 超时自动拒绝；Enter/Esc 快捷键；审批完成自动折叠与状态持久化。
 */
export function useApprovalCard(
  props: ApprovalCardProps,
  emit: { approve: () => void; deny: (reason?: DenyReason) => void },
) {
  const initialResult = props.status === "approved" || props.status === "denied" ? props.status : null;
  const initialDenyReason: DenyReason | undefined =
    props.reason && props.reason.toLowerCase().includes("timeout") ? "timeout" : undefined;
  const result = ref<ApprovalResult | null>(initialResult);
  const denyReason = ref<DenyReason | undefined>(initialDenyReason);
  const paused = ref(false);
  const isCollapsed = ref<boolean>(props.defaultCollapsed ?? Boolean(initialResult));

  // 监听外部持久化传入的状态变化
  watch(
    () => props.status,
    (newVal) => {
      if (newVal === "approved" || newVal === "denied") {
        result.value = newVal;
        if (newVal === "denied" && props.reason?.toLowerCase().includes("timeout")) {
          denyReason.value = "timeout";
        }
        isCollapsed.value = true;
        stop();
      } else if (newVal === "pending") {
        result.value = null;
        isCollapsed.value = false;
        start();
      }
    }
  );

  /* ---------- 倒计时（JS 驱动，reduced-motion 下行为一致） ---------- */
  const countdownSeconds = computed(() => (result.value ? 0 : props.countdown ?? 0));
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
    // 审批完成自动折叠
    isCollapsed.value = true;
    if (r === "approved") emit.approve();
    else emit.deny(reason);
  }

  function onApprove() {
    resolve("approved");
  }
  function onDeny() {
    resolve("denied", "manual");
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
  }

  /* ---------- 键盘快捷键 ----------
   * 安全默认：Enter 与 Esc 均为拒绝（Esc 恒为拒绝）；
   * 仅当宿主显式传入 approveShortcut 时，Enter 才放行批准。 */
  function onKeydown(e: KeyboardEvent) {
    if (result.value) return;
    const inButton = (e.target as HTMLElement | null)?.closest?.("button") != null;
    if (e.key === "Enter" && !inButton) {
      e.preventDefault();
      if (props.approveShortcut) onApprove();
      else onDeny();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDeny();
    }
  }

  // 挂载时若未决策且有倒计时则启动
  if (!initialResult) {
    start();
  }

  return {
    result,
    denyReason,
    paused,
    remaining,
    percent,
    riskLabel,
    isCollapsed,
    toggleCollapse,
    onApprove,
    onDeny,
    onKeydown,
  };
}
