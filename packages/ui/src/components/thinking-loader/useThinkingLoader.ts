import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { ThinkingLoaderProps } from "./types";

const DEFAULT_PHASES = ["思考中", "检索资料", "整理要点", "撰写回答"];

/** VaThinkingLoader 的状态逻辑：阶段轮播 + 完成态 */
export function useThinkingLoader(props: ThinkingLoaderProps) {
  const phases = computed(() => (props.phases?.length ? props.phases : DEFAULT_PHASES));
  const step = ref(0);
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
    timer = window.setInterval(() => {
      const last = phases.value.length - 1;
      if (step.value >= last) {
        if (props.loop) step.value = 0;
        else stop();
      } else {
        step.value++;
      }
    }, Math.max(200, props.interval ?? 1600));
  }

  watch(
    () => [props.done, phases.value] as const,
    () => {
      stop();
      if (!props.done) {
        step.value = 0;
        start();
      }
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);

  // reduced-motion / 无 JS 环境（SSR）直接停在第一阶段文案
  const current = computed(() => phases.value[Math.min(step.value, phases.value.length - 1)] ?? "");

  return { current, stop };
}
