import { ref } from "vue";

/** 相对时间：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / M-D HH:mm（无 Intl 依赖） */
export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `今天 ${hm}`;
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

/** 恢复按钮的二次确认（防误触）：armed = 已进入确认态的检查点 id */
export function useConfirmArmed() {
  const armed = ref<string | null>(null);
  let timer: number | undefined;

  function arm(id: string | null) {
    armed.value = id;
    if (timer !== undefined) window.clearTimeout(timer);
    if (id !== null) timer = window.setTimeout(() => (armed.value = null), 3000);
  }

  return { armed, arm };
}
