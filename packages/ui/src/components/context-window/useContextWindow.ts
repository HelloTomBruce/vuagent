import { computed } from "vue";
import { CONTEXT_KIND_LABEL, type ContextKind, type ContextPart, type ContextWindowProps } from "./types";

/** VaContextWindow 的状态逻辑：占用汇总、格子宽度、压缩收缩 */
export function useContextWindow(props: ContextWindowProps) {
  const used = computed(() => props.parts.reduce((t, p) => t + p.tokens, 0));
  const scale = computed(() => Math.max(props.capacity, used.value, 1));
  const percent = computed(() => Math.min(100, (used.value / props.capacity) * 100));

  const hasHistory = computed(() => props.parts.some((p) => p.kind === "history"));

  /** 压缩中只收缩历史格子 */
  function shrinking(p: ContextPart) {
    return props.compacting && p.kind === "history";
  }
  function widthOf(p: ContextPart) {
    if (shrinking(p)) return "0%";
    return `${Math.max((p.tokens / scale.value) * 100, 2)}%`;
  }

  /** 图例与格子一一对应：仅展示当前 parts 中实际出现的分段类型（按 CONTEXT_KIND_LABEL 固定顺序去重） */
  const legendKinds = computed(() => {
    const labelOrder = Object.keys(CONTEXT_KIND_LABEL) as ContextKind[];
    const present = new Set(props.parts.map((p) => p.kind));
    return labelOrder.filter((k) => present.has(k));
  });

  return { used, scale, percent, hasHistory, shrinking, widthOf, legendKinds };
}
