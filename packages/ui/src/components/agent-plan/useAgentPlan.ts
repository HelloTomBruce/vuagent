import { computed, ref } from "vue";
import type { AgentPlanProps, PlanStep } from "./types";
import { useNow } from "../../composables/useNow";

/**
 * VaAgentPlan 的状态逻辑：
 * - 运行视图：hasRunning 驱动共享时钟 → 每个步骤的实时计时
 * - 编辑视图：就地重命名 / 上下移 / 增删，全部以 update:steps 交还父层
 */
export function useAgentPlan(
  props: AgentPlanProps,
  emit: { "update:steps": (steps: PlanStep[]) => void },
) {
  /* ---------- 运行态：实时计时 ---------- */
  const hasRunning = computed(() => props.steps.some((s) => s.status === "running"));
  const now = useNow(500, hasRunning);

  function elapsedOf(s: PlanStep): number | undefined {
    if (s.status === "running") return s.startedAt != null ? now.value - s.startedAt : undefined;
    if (s.status === "done") return s.duration;
    return undefined;
  }
  const doneCount = computed(() => props.steps.filter((s) => s.status === "done").length);
  const anyError = computed(() => props.steps.some((s) => s.status === "error"));

  /* ---------- 编辑态 ---------- */
  let uid = 0;
  const editingId = ref<string | null>(null);
  const draft = ref("");
  const addDraft = ref("");

  function write(next: PlanStep[]) {
    emit["update:steps"](next);
  }
  function startRename(step: PlanStep) {
    editingId.value = step.id;
    draft.value = step.title;
  }
  function rename(step: PlanStep) {
    const t = draft.value.trim();
    editingId.value = null;
    if (!t || t === step.title) return;
    write(props.steps.map((s) => (s.id === step.id ? { ...s, title: t } : s)));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= props.steps.length) return;
    const next = [...props.steps];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item!);
    write(next);
  }
  function remove(step: PlanStep) {
    write(props.steps.filter((s) => s.id !== step.id));
  }
  function add() {
    const t = addDraft.value.trim();
    if (!t) return;
    write([...props.steps, { id: `step-${Date.now()}-${uid++}`, title: t }]);
    addDraft.value = "";
  }

  return {
    now,
    elapsedOf,
    doneCount,
    anyError,
    editingId,
    draft,
    addDraft,
    startRename,
    rename,
    move,
    remove,
    add,
  };
}
