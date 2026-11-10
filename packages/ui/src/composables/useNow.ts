import { onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * 共享实时时钟：enabled 为 true 期间按 interval 更新 now（ms 时间戳）。
 * 供工具卡计时、计划计时、收件箱时钟等场景复用；SSR 安全。
 */
export function useNow(intervalMs: number, enabled: Ref<boolean>): Readonly<Ref<number>> {
  const now = ref(Date.now());
  let timer: number | undefined;

  function start() {
    if (timer !== undefined || typeof window === "undefined") return;
    now.value = Date.now();
    timer = window.setInterval(() => (now.value = Date.now()), intervalMs);
  }
  function stop() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  watch(enabled, (v) => (v ? start() : stop()), { immediate: true });
  onBeforeUnmount(stop);

  return now as Readonly<Ref<number>>;
}
