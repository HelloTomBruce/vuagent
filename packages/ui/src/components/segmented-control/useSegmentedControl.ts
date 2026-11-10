import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { SegmentedControlProps } from "./types";

/**
 * VaSegmentedControl 的状态逻辑：
 * 滑块指示器按激活项的几何位置滑动（resize 时重测）；
 * radiogroup 语义 + 方向键移动（沿方向跳过 disabled 项）。
 */
export function useSegmentedControl(
  props: SegmentedControlProps,
  model: Ref<string>,
  root: Ref<HTMLElement | null>,
) {
  const indicator = ref({ left: 0, width: 0 });
  const activeIdx = computed(() => Math.max(0, props.options.findIndex((o) => o.value === model.value)));

  function measure() {
    const el = root.value;
    if (!el || typeof window === "undefined") return;
    const btn = el.querySelector<HTMLElement>(`[data-idx="${activeIdx.value}"]`);
    if (!btn) return;
    indicator.value = { left: btn.offsetLeft, width: btn.offsetWidth };
  }

  function onResize() {
    measure();
  }

  watch(
    () => [props.options, model.value] as const,
    () => void nextTick(measure),
    { deep: false },
  );
  onMounted(() => {
    void nextTick(measure);
    if (typeof window !== "undefined") window.addEventListener("resize", onResize);
  });
  onBeforeUnmount(() => {
    if (typeof window !== "undefined") window.removeEventListener("resize", onResize);
  });

  function select(value: string) {
    model.value = value;
  }

  function onKeydown(e: KeyboardEvent) {
    const opts = props.options;
    const cur = activeIdx.value;
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (dir === 0 && e.key !== "Home" && e.key !== "End") return;

    let idx =
      e.key === "Home" ? 0 : e.key === "End" ? opts.length - 1 : (cur + dir + opts.length) % opts.length;
    // 沿方向跳过 disabled 项
    let guard = opts.length;
    while (opts[idx]?.disabled && guard-- > 0) {
      idx = (idx + dir + opts.length) % opts.length;
    }
    const target = opts[idx];
    if (!target || target.disabled) return;
    e.preventDefault();
    model.value = target.value;
    root.value?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.focus();
  }

  return { indicator, activeIdx, select, onKeydown };
}
