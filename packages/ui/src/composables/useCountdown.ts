import { onBeforeUnmount, ref, type Ref } from "vue";

/**
 * 共享倒计时：墙钟（Date.now 截止时间）驱动，100ms 步进刷新显示；paused 时冻结；归零触发 onEnd。
 *
 * 不用「每 tick 固定递减 0.1s」的写法：主线程繁忙（如流式输出重渲染）时 interval 回调会延迟，
 * 固定步进会把延迟时间直接丢掉，倒计时明显慢于真实时间。
 * 改为记录截止时刻、每次回调用剩余墙钟时间重算，回调晚到只会晚刷新、不会走慢。
 * 暂停期间按 tick 顺延截止时刻，暂停时长不计入倒计时。
 * 供审批卡的"超时自动拒绝"等场景复用；reduced-motion 下行为一致（JS 驱动，不依赖 CSS 动画）。
 */
export function useCountdown(totalSeconds: Ref<number>, paused: Ref<boolean>, onEnd: () => void) {
  const remaining = ref(totalSeconds.value);
  let timer: number | undefined;
  /** 截止时刻（ms）。暂停期间每 tick 顺延，保证冻结精度不依赖暂停/恢复事件 */
  let deadlineAt = 0;
  let lastTickAt = 0;

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
    deadlineAt = Date.now() + remaining.value * 1000;
    lastTickAt = Date.now();
    timer = window.setInterval(() => {
      const now = Date.now();
      if (paused.value) {
        // 冻结：把暂停耗掉的墙钟时间顺延进截止时刻
        deadlineAt += now - lastTickAt;
        lastTickAt = now;
        return;
      }
      lastTickAt = now;
      remaining.value = Math.max(0, (deadlineAt - now) / 1000);
      if (remaining.value <= 0) {
        stop();
        onEnd();
      }
    }, 100);
  }

  onBeforeUnmount(stop);

  return { remaining, start, stop };
}
