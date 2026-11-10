import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { NumberTickerProps, TickerPart } from "./types";

/**
 * VaNumberTicker 的状态逻辑：
 * 进视口时 rolled=false→true（数字从 0 滚到目标），value 变化时各位独立滚动；
 * reduced-motion / 无 IntersectionObserver 时直接静态显示。
 * root 由 SFC 通过 useTemplateRef 创建后传入。
 */
export function useNumberTicker(props: NumberTickerProps, root: Ref<HTMLElement | null>) {
  const rolled = ref(false);
  let io: IntersectionObserver | null = null;
  let timer: number | undefined;

  const nf = computed(() => new Intl.NumberFormat(props.locale ?? undefined, props.format));
  const formatted = computed(() => nf.value.format(props.value));

  /** "48,240" → 从右往左拆列：数字列带 key（保持数位身份），其余为静态字符列 */
  const parts = computed<TickerPart[]>(() => {
    const out: TickerPart[] = [];
    let d = 0;
    let s = 0;
    for (let i = formatted.value.length - 1; i >= 0; i--) {
      const c = formatted.value[i]!;
      if (c >= "0" && c <= "9") out.unshift({ key: `d${d++}`, digit: c.charCodeAt(0) - 48 });
      else out.unshift({ key: `s${s++}`, char: c });
    }
    return out;
  });

  function roll() {
    if (rolled.value) return;
    timer = window.setTimeout(() => (rolled.value = true), props.delay);
  }

  onMounted(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      rolled.value = true;
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      roll();
      return;
    }
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          roll();
          io?.disconnect();
          io = null;
        }
      },
      { threshold: 0.3 },
    );
    io.observe(root.value!);
  });

  onBeforeUnmount(() => {
    io?.disconnect();
    if (timer !== undefined) window.clearTimeout(timer);
  });

  return { rolled, parts, formatted };
}
