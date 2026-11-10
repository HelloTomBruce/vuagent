import { computed, nextTick, ref, watch, type Ref } from "vue";
import type { CommandItem, CommandMenuProps } from "./types";

/**
 * VaCommandMenu 的过滤 + 键盘导航 + 开关状态（布尔哨兵：open !== undefined 判定受控）。
 * SSR 安全：document 操作仅在 open 变 true 后执行（必然在客户端）。
 */
export function useCommandMenu(
  props: CommandMenuProps,
  inputEl: Ref<HTMLInputElement | null>,
  panelEl: Ref<HTMLElement | null>,
  emit: { "update:open": (v: boolean) => void; select: (item: CommandItem) => void },
) {
  /* ---------- 开关：受控优先，touched 哨兵回落 defaultOpen ---------- */
  const touched = ref(false);
  const innerOpen = ref(props.defaultOpen ?? false);
  const isOpen = computed(() => (props.open !== undefined || touched.value ? props.open : innerOpen.value));

  let lastFocus: HTMLElement | null = null;

  function openMenu() {
    touched.value = true;
    innerOpen.value = true;
    emit["update:open"](true);
  }

  function closeMenu() {
    touched.value = true;
    innerOpen.value = false;
    emit["update:open"](false);
  }

  // 打开：聚焦输入、记录来源焦点；关闭：恢复焦点
  watch(isOpen, (v) => {
    if (v) {
      if (typeof document !== "undefined") lastFocus = document.activeElement as HTMLElement | null;
      query.value = "";
      activeIdx.value = 0;
      nextTick(() => inputEl.value?.focus());
    } else if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
      lastFocus = null;
    }
  });

  /* ---------- 过滤：label/keywords 子串匹配（大小写不敏感） ---------- */
  const query = ref("");
  const filtered = computed<CommandItem[]>(() => {
    const q = query.value.trim().toLowerCase();
    if (!q) return props.commands;
    return props.commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.keywords?.toLowerCase().includes(q),
    );
  });

  /** 渲染分组：[{ group, items }]（group 为 undefined 时归"常用"） */
  const groups = computed(() => {
    const out: Array<{ group: string | undefined; items: CommandItem[] }> = [];
    for (const c of filtered.value) {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.items.push(c);
      else out.push({ group: c.group, items: [c] });
    }
    return out;
  });

  /** 扁平化（含禁用项——占据导航位置但 Enter 无效） */
  const flat = computed(() => groups.value.flatMap((g) => g.items));
  const activeIdx = ref(0);

  // 过滤结果变化时收拢高亮
  watch(filtered, () => {
    activeIdx.value = 0;
  });

  function move(delta: number) {
    const len = flat.value.length;
    if (!len) return;
    activeIdx.value = (activeIdx.value + delta + len) % len;
    nextTick(() => {
      const el = panelEl.value?.querySelector<HTMLElement>("[data-active='true']");
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  function pick(item: CommandItem) {
    if (item.disabled) return;
    emit.select(item);
    closeMenu();
  }

  /** 输入框键盘：↑↓ 高亮、Enter 选中、Esc 关闭 */
  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat.value[activeIdx.value];
      if (item) pick(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  }

  /** 面板内 Tab 圈进（输入框 + 面板本身两个焦点位） */
  function trapTab(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    inputEl.value?.focus();
  }

  /** 点击遮罩关闭 */
  function onBackdropClick() {
    closeMenu();
  }

  return {
    isOpen,
    openMenu,
    closeMenu,
    query,
    filtered,
    flat,
    groups,
    activeIdx,
    onInputKeydown,
    trapTab,
    onBackdropClick,
    pick,
  };
}
