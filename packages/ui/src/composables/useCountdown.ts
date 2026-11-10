import { onBeforeUnmount, ref, type Ref } from "vue";

/**
 * 共享倒计时：100ms 步进递减，paused 时冻结；归零触发 onEnd。
 * 供审批卡的"超时自动拒绝"等场景复用；reduced-motion 下行为一致（JS 驱动，不依赖 CSS 动画）。
 */
export function useCountdown(totalSeconds: Ref<number>, paused: Ref<boolean>, onEnd: () => void) {
  const remaining = ref(totalSeconds.value);
  let timer: number | undefined;

  function stop() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function start() {
    stop();
    if (typeof window === "undefined") return;
    remaining.value = totalSeconds.value;
    if (remaining.value <= 0) return;
    timer = window.setInterval(() => {
      if (paused.value) return;
      remaining.value = Math.max(0, remaining.value - 0.1);
      if (remaining.value <= 0) {
        stop();
        onEnd();
      }
    }, 100);
  }

  onBeforeUnmount(stop);

  return { remaining, start, stop };
}
