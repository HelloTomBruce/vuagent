import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { StreamAnswerProps } from "./types";

/** VaStreamAnswer 的状态逻辑：逐字播放 / 光标 / 完成回调 / 重放 */
export function useStreamAnswer(
  props: StreamAnswerProps,
  emit: { complete: () => void },
) {
  const shown = ref(0);
  const playing = ref(false);
  let timer: number | undefined;

  const text = computed(() => props.source.slice(0, shown.value));
  const done = computed(() => shown.value >= props.source.length);

  function stop() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    playing.value = false;
  }

  function play() {
    stop();
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      shown.value = props.source.length;
      return;
    }
    playing.value = true;
    timer = window.setInterval(() => {
      shown.value = Math.min(props.source.length, shown.value + Math.max(1, props.chunk ?? 2));
      if (shown.value >= props.source.length) {
        stop();
        emit.complete();
      }
    }, Math.max(8, props.interval ?? 24));
  }

  function replay() {
    shown.value = 0;
    play();
  }

  watch(
    () => props.source,
    () => {
      // source 替换（如重新生成）→ 从头播放
      shown.value = 0;
      if (props.autoPlay) play();
    },
  );

  if (props.autoPlay) play();
  else shown.value = props.source.length;

  onBeforeUnmount(stop);

  return { text, done, playing, replay, stop };
}
