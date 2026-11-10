import { computed, ref, watch } from "vue";
import { expandKey, groupHunks, lineDiff, pairInline } from "../../utils/lineDiff";
import type { RenderRow } from "../../utils/lineDiff";
import type { CodeDiffProps, CodeDiffStats } from "./types";

/** VaCodeDiff 的渲染管线：LCS 行 diff → 行内词级配对 → hunk 折叠 */
export function useCodeDiff(props: CodeDiffProps) {
  const context = computed(() =>
    props.defaultExpandAll ? Number.POSITIVE_INFINITY : (props.context ?? 3),
  );

  const rows = computed(() => lineDiff(props.oldText, props.newText));
  const inline = computed(() => pairInline(rows.value, props.wordLevel !== false));

  const stats = computed<CodeDiffStats>(() => {
    let additions = 0;
    let deletions = 0;
    for (const r of rows.value) {
      if (r.type === "add") additions++;
      else if (r.type === "del") deletions++;
    }
    return { additions, deletions };
  });

  /** 已展开的折叠段 key；源文本变化时重置 */
  const expanded = ref<Set<string>>(new Set());
  watch([() => props.oldText, () => props.newText], () => {
    expanded.value = new Set();
  });

  const render = computed<RenderRow[]>(() =>
    groupHunks(rows.value, context.value, inline.value, expanded.value),
  );

  const hasCollapsed = computed(() => render.value.some((r) => r.kind === "expand"));
  /** 头部"全部展开"开关：切换整体 context（折叠态 ↔ ∞） */
  const expandAll = ref(props.defaultExpandAll ?? false);
  watch(expandAll, (v) => {
    if (!v) expanded.value = new Set();
  });

  function toggleExpand(e: { from: number; to: number }) {
    const next = new Set(expanded.value);
    next.add(expandKey(e));
    expanded.value = next;
  }

  const empty = computed(
    () => rows.value.length === 0 || stats.value.additions + stats.value.deletions === 0,
  );

  return { render, stats, hasCollapsed, expandAll, toggleExpand, empty };
}
