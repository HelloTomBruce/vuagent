import { computed, ref } from "vue";
import type { DiffPiece } from "../../utils/wordDiff";
import { buildDiffUnits, diffResult } from "../../utils/wordDiff";
import type { InlineDiffProps } from "./types";

/**
 * VaInlineDiff 的状态逻辑：
 * buildDiffUnits 产出变更单元 → 逐个接受/拒绝（含撤销栈）→ 全部决断后合成结果。
 * decisions: undefined=未决 · true=接受新稿 · false=保留原文
 */
export function useInlineDiff(
  props: InlineDiffProps,
  emit: { apply: (result: string) => void },
) {
  const units = computed<DiffPiece[]>(() => buildDiffUnits(props.original, props.revised));
  const decisions = ref<Record<number, boolean>>({});
  const undoStack = ref<number[]>([]);

  const changeIdx = computed(() =>
    units.value.map((u, i) => (u.same === undefined ? i : -1)).filter((i) => i >= 0),
  );
  const pendingCount = computed(() => changeIdx.value.filter((i) => decisions.value[i] === undefined).length);

  function toggle(i: number) {
    const cur = decisions.value[i];
    if (cur === undefined) {
      decisions.value[i] = true;
      undoStack.value.push(i);
    } else {
      decisions.value[i] = !cur;
      if (!undoStack.value.includes(i)) undoStack.value.push(i);
    }
  }

  function acceptAll() {
    for (const i of changeIdx.value) decisions.value[i] = true;
  }
  function rejectAll() {
    for (const i of changeIdx.value) decisions.value[i] = false;
  }
  function undo() {
    const i = undoStack.value.pop();
    if (i !== undefined) delete decisions.value[i];
  }
  function reset() {
    decisions.value = {};
    undoStack.value = [];
  }

  const result = computed(() => diffResult(units.value, decisions.value));
  function apply() {
    emit.apply(result.value);
  }

  return {
    units,
    decisions,
    undoStack,
    changeIdx,
    pendingCount,
    toggle,
    acceptAll,
    rejectAll,
    undo,
    reset,
    result,
    apply,
  };
}
