import { computed, ref, watch } from "vue";
import type { FileTreeProps } from "./types";
import { flattenTree } from "./tree";

/** VaFileTree 的状态：展开集合（非受控）+ 选中（受控/非受控哨兵）+ 可见行 + roving focus */
export function useFileTree(props: FileTreeProps) {
  /* ---------- 展开集合 ---------- */
  const expanded = ref<Set<string>>(new Set());
  watch(
    () => props.tree,
    (tree) => {
      const next = new Set<string>();
      const depth = props.defaultExpandDepth ?? 1;
      const walk = (nodes: typeof tree, level: number) => {
        for (const n of nodes) {
          if (n.children?.length && level <= depth) {
            next.add(n.path);
            walk(n.children, level + 1);
          }
        }
      };
      walk(tree, 1);
      expanded.value = next;
    },
    { immediate: true },
  );

  function toggleDir(path: string, value?: boolean) {
    const next = new Set(expanded.value);
    const target = value ?? !next.has(path);
    if (target) next.add(path);
    else next.delete(path);
    expanded.value = next;
    return target;
  }

  /* ---------- 选中（受控优先，touched 哨兵回落 defaultSelected） ---------- */
  const touched = ref(false);
  const innerSelected = ref<string | undefined>(props.defaultSelected);
  const currentSelected = computed(() =>
    props.selected !== undefined || touched.value ? props.selected : innerSelected.value,
  );

  function select(path: string | undefined) {
    touched.value = true;
    innerSelected.value = path;
    return path;
  }

  /* ---------- 可见行 ---------- */
  const rows = computed(() => flattenTree(props.tree, (p) => expanded.value.has(p)));

  /* ---------- roving focus：↑↓ 移动的"当前项" ---------- */
  const focusedPath = ref<string | undefined>(rows.value[0]?.node.path);
  watch(rows, (r) => {
    if (!r.some((x) => x.node.path === focusedPath.value)) focusedPath.value = r[0]?.node.path;
  });

  function moveFocus(delta: number) {
    const list = rows.value;
    const idx = list.findIndex((r) => r.node.path === focusedPath.value);
    const next = list[Math.min(list.length - 1, Math.max(0, idx + delta))];
    if (next) focusedPath.value = next.node.path;
  }

  /** 聚焦当前项（keydown 后由模板 focus()） */
  function isActive(path: string) {
    return focusedPath.value === path;
  }

  return {
    expanded,
    toggleDir,
    currentSelected,
    select,
    rows,
    focusedPath,
    moveFocus,
    isActive,
  };
}
