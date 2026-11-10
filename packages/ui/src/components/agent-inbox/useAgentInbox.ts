import { computed, ref } from "vue";
import type { AgentInboxProps, InboxFilter, AgentTask } from "./types";
import { useNow } from "../../composables/useNow";

/** VaAgentInbox 的状态逻辑：过滤 tab、计数、live 时钟、行展开 */
export function useAgentInbox(props: AgentInboxProps) {
  /* ---------- 过滤 ---------- */
  const filter = ref<InboxFilter>("all");

  const counts = computed(() => ({
    all: props.tasks.length,
    active: props.tasks.filter((t) => t.status === "queued" || t.status === "running").length,
    waiting: props.tasks.filter((t) => t.status === "waiting").length,
    done: props.tasks.filter((t) => t.status === "done" || t.status === "error").length,
  }));

  const tabs: Array<{ key: InboxFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "active", label: "进行中" },
    { key: "waiting", label: "待审" },
    { key: "done", label: "已结束" },
  ];

  const visible = computed(() => {
    switch (filter.value) {
      case "active":
        return props.tasks.filter((t) => t.status === "queued" || t.status === "running");
      case "waiting":
        return props.tasks.filter((t) => t.status === "waiting");
      case "done":
        return props.tasks.filter((t) => t.status === "done" || t.status === "error");
      default:
        return props.tasks;
    }
  });

  /* ---------- live 计时 ---------- */
  const needsClock = computed(() =>
    props.tasks.some((t) => t.status === "running" || t.status === "waiting"),
  );
  const now = useNow(1000, needsClock);

  function elapsedOf(t: AgentTask): number | undefined {
    if (t.status === "running" || t.status === "waiting") {
      return t.startedAt != null ? now.value - t.startedAt : undefined;
    }
    if (t.status === "done" || t.status === "error") return t.duration;
    return undefined;
  }

  /* ---------- 展开 ---------- */
  const expandedId = ref<string | null>(null);
  function toggle(t: AgentTask) {
    expandedId.value = expandedId.value === t.id ? null : t.id;
  }

  return { filter, tabs, counts, visible, elapsedOf, expandedId, toggle };
}
