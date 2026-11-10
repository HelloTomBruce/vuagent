import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import type { MemoryItem, MemoryPanelProps } from "./types";

/**
 * VaMemoryPanel 的状态逻辑：分类过滤、就地编辑、遗忘 + 撤销托盘。
 * 数据由父层持有，组件只发事件。
 */
export function useMemoryPanel(
  props: MemoryPanelProps,
  emit: {
    edit: (id: string, text: string) => void;
    pause: (id: string, paused: boolean) => void;
    forget: (id: string) => void;
    restore: (items: MemoryItem[]) => void;
  },
) {
  /* ---------- 分类过滤 ---------- */
  const filter = ref("__all"); // "__all" | "__paused" | 分类名
  const categories = computed(() => {
    const map = new Map<string, number>();
    for (const m of props.memories) map.set(m.category, (map.get(m.category) ?? 0) + 1);
    return [...map.entries()];
  });
  const visible = computed(() =>
    props.memories.filter((m) => {
      if (filter.value === "__all") return true;
      if (filter.value === "__paused") return m.paused;
      return m.category === filter.value;
    }),
  );

  /* ---------- 就地编辑 ---------- */
  const editingId = ref<string | null>(null);
  const draft = ref("");
  function startEdit(m: MemoryItem) {
    editingId.value = m.id;
    draft.value = m.text;
  }
  function saveEdit(m: MemoryItem) {
    const t = draft.value.trim();
    editingId.value = null;
    if (!t || t === m.text) return;
    emit.edit(m.id, t);
  }

  /* ---------- 遗忘 + 撤销托盘 ---------- */
  const tray = ref<MemoryItem[]>([]);
  let trayTimer: number | undefined;
  function forget(m: MemoryItem) {
    emit.forget(m.id);
    tray.value.push(m);
    if (trayTimer !== undefined) window.clearTimeout(trayTimer);
    trayTimer = window.setTimeout(() => (tray.value = []), props.undoMs);
  }
  function undoForget() {
    if (!tray.value.length) return;
    emit.restore([...tray.value]);
    tray.value = [];
    if (trayTimer !== undefined) {
      window.clearTimeout(trayTimer);
      trayTimer = undefined;
    }
  }
  onBeforeUnmount(() => {
    if (trayTimer !== undefined) window.clearTimeout(trayTimer);
  });

  function togglePause(m: MemoryItem) {
    emit.pause(m.id, !m.paused);
  }

  return {
    filter,
    categories,
    visible,
    editingId,
    draft,
    startEdit,
    saveEdit,
    tray,
    forget,
    undoForget,
    togglePause,
  };
}

/** v-model:enabled 的辅助类型（SFC 中 defineModel 使用） */
export type EnabledModel = Ref<boolean>;
