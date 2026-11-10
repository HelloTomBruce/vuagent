import { computed, ref, watch } from "vue";
import type { Decision, DecisionAnswer, DecisionInboxProps } from "./types";

type RowState = { open: boolean; answered?: DecisionAnswer; gone?: boolean };

/** VaDecisionInbox 的状态逻辑：按 id 维护展开/已答/离场状态，数据变化时只增删不覆盖 */
export function useDecisionInbox(props: DecisionInboxProps) {
  const states = ref<Record<string, RowState>>({});

  // 数据驱动：新增的决策初始化状态，移除的清理状态；已存在的用户状态不动
  watch(
    () => props.decisions,
    (list) => {
      const seen = new Set<string>();
      for (const d of list) {
        seen.add(d.id);
        if (!states.value[d.id]) {
          states.value[d.id] = { open: !d.collapsed };
        }
      }
      for (const id of Object.keys(states.value)) {
        if (!seen.has(id)) delete states.value[id];
      }
    },
    { immediate: true, deep: false },
  );

  /**
   * 记录选择：未答过才生效，展示确认态片刻后折叠离场。
   * 返回是否真正生效（供 SFC 决定是否向父层 emit）。
   */
  function answer(d: Decision, which: DecisionAnswer): boolean {
    const s = states.value[d.id];
    if (!s || s.answered) return false;
    s.answered = which;
    window.setTimeout(() => {
      const cur = states.value[d.id];
      if (cur?.answered === which) cur.gone = true;
    }, 1000);
    return true;
  }

  const visible = computed(() => props.decisions.filter((d) => !states.value[d.id]?.gone));
  const pending = computed(() => visible.value.filter((d) => !states.value[d.id]?.answered));

  return { states, answer, visible, pending };
}
