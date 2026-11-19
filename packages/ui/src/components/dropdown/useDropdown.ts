import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch, type Ref } from "vue";
import type { VirtualAnchor } from "../popover/types";
import type { DropdownEntry, DropdownItem, DropdownProps } from "./types";

/**
 * VaDropdown 的状态机：开关（受控/非受控）+ 主菜单/子菜单的 roving 焦点导航。
 *
 * 结构约定：
 *   - 主菜单与一层子菜单都是 role=menu，子菜单由独立 VaPopover 以「当前子菜单入口元素」为锚点渲染；
 *   - 键盘焦点在各 menuitem 之间移动（roving tabindex 语义），Esc 统一由 document 监听接管，
 *     因为子菜单 DOM 被 Teleport 到 body，父菜单容器的 keydown 事件收不到子菜单里的按键；
 *   - VaPopover 的 closeOnOutsideClick / closeOnEscape 全部关闭，外部点击与 Esc 在此统一处理，
 *     这样点进子菜单不会被父浮层误判为「点到了外面」。
 * SSR 安全：所有 document 访问都在事件回调 / nextTick / onMounted 内，并有 isBrowser 短路。
 */

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

/** 把 items 展开为「组标题 / 分隔线 / 项」渲染序列 */
export function buildEntries(items: DropdownItem[]): DropdownEntry[] {
  const out: DropdownEntry[] = [];
  let lastGroup: string | undefined;
  items.forEach((item, index) => {
    if (item.divider) {
      out.push({ type: "divider", key: `divider-${index}` });
      lastGroup = undefined;
      return;
    }
    if (item.group && item.group !== lastGroup) {
      out.push({ type: "group", key: `group-${index}`, label: item.group });
    }
    lastGroup = item.group;
    out.push({ type: "item", key: `item-${item.id}-${index}`, item });
  });
  return out;
}

/** 右键位置 → 零尺寸虚拟锚点（Popover 复用同一套定位管线） */
function pointAnchor(x: number, y: number): VirtualAnchor {
  return {
    getBoundingClientRect: () =>
      ({ x, y, top: y, left: x, right: x, bottom: y, width: 0, height: 0 }) as unknown as DOMRect,
  };
}

export interface DropdownRefs {
  /** 默认触发器按钮（关闭后还原焦点） */
  trigger: Ref<HTMLElement | null>;
  /** 触发器插槽外包装（自定义触发器时用于外部点击判定 / 焦点兜底） */
  triggerWrap: Ref<HTMLElement | null>;
  /** 主菜单容器（外部点击判定） */
  menu: Ref<HTMLElement | null>;
  /** 子菜单容器（外部点击判定） */
  submenu: Ref<HTMLElement | null>;
}

export interface DropdownEmitters {
  "update:open": (open: boolean) => void;
  open: () => void;
  close: () => void;
  select: (item: DropdownItem) => void;
}

export function useDropdown(props: DropdownProps, refs: DropdownRefs, emit: DropdownEmitters) {
  const uid = useId();
  const menuId = `va-dd-${uid}-menu`;
  const submenuId = `va-dd-${uid}-submenu`;

  /* ---------------- 开关 ---------------- */
  const innerOpen = ref(props.defaultOpen ?? false);
  const isOpen = computed(() => props.open ?? innerOpen.value);

  /* ---------------- 高亮 / 子菜单 ---------------- */
  // defaultOpen 时同步初始化高亮（SSR 输出也带 data-active），运行期由 watch(isOpen) 接管
  const activeId = ref<string | null>(
    isOpen.value ? firstEnabledId(props.items.filter((it) => !it.divider)) : null,
  );
  const openSubId = ref<string | null>(null);
  const subActiveId = ref<string | null>(null);
  /** 子菜单浮层的锚点 = 当前子菜单入口元素 */
  const submenuAnchor = ref<HTMLElement | null>(null);
  /** contextmenu 模式的虚拟锚点 */
  const contextAnchor = ref<VirtualAnchor | null>(null);
  /** 关闭时是否需要把焦点还回触发器（Esc / 选中） */
  let restoreFocusPending = false;

  const popoverAnchor = computed<VirtualAnchor | undefined>(() =>
    props.trigger === "contextmenu" ? (contextAnchor.value ?? undefined) : undefined,
  );

  /* ---------------- 渲染模型 ---------------- */
  const navItems = computed(() => props.items.filter((it) => !it.divider));
  const entries = computed(() => buildEntries(props.items));

  const subItems = computed<DropdownItem[]>(() => {
    if (!openSubId.value) return [];
    return props.items.find((it) => it.id === openSubId.value)?.children ?? [];
  });
  const subNavItems = computed(() => subItems.value.filter((it) => !it.divider));
  const subEntries = computed(() => buildEntries(subItems.value));
  const submenuOpen = computed(() => openSubId.value !== null);
  const submenuLabel = computed(
    () => props.items.find((it) => it.id === openSubId.value)?.label ?? "子菜单",
  );

  const activeItem = computed(
    () => navItems.value.find((it) => it.id === activeId.value) ?? null,
  );

  /* ---------------- DOM id / 焦点 ---------------- */
  const safe = (v: string) => String(v).replace(/[^\w-]+/g, "-");
  const itemDomId = (id: string) => `${menuId}-i-${safe(id)}`;
  const subItemDomId = (parentId: string, id: string) =>
    `${submenuId}-${safe(parentId)}-${safe(id)}`;

  function firstEnabledId(items: DropdownItem[]): string | null {
    return items.find((it) => !it.disabled)?.id ?? items[0]?.id ?? null;
  }

  function focusById(id: string | null | undefined) {
    if (!isBrowser() || !id) return;
    document.getElementById(id)?.focus();
  }

  function restoreFocus() {
    if (refs.trigger.value) {
      refs.trigger.value.focus();
      return;
    }
    // 自定义触发器：聚焦包装内首个可聚焦元素
    refs.triggerWrap.value
      ?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      )
      ?.focus();
  }

  /* ---------------- 开关动作 ---------------- */
  function setOpen(v: boolean) {
    if (isOpen.value === v) return;
    innerOpen.value = v;
    emit["update:open"](v);
    if (v) emit.open();
    else emit.close();
  }

  function openMenu() {
    if (props.disabled || isOpen.value) return;
    setOpen(true);
  }

  function closeMenu(opts: { restoreFocus?: boolean } = {}) {
    if (!isOpen.value) return;
    restoreFocusPending = !!opts.restoreFocus;
    setOpen(false);
  }

  function toggleMenu() {
    if (isOpen.value) closeMenu();
    else openMenu();
  }

  /* 打开：高亮首个可用项并把焦点送进菜单；关闭：清理子菜单并按需还原焦点 */
  watch(isOpen, async (v) => {
    if (v) {
      openSubId.value = null;
      subActiveId.value = null;
      submenuAnchor.value = null;
      activeId.value = firstEnabledId(navItems.value);
      await nextTick();
      focusById(activeId.value ? itemDomId(activeId.value) : null);
    } else {
      openSubId.value = null;
      subActiveId.value = null;
      submenuAnchor.value = null;
      contextAnchor.value = null;
      activeId.value = null;
      const pending = restoreFocusPending;
      restoreFocusPending = false;
      await nextTick();
      if (pending) restoreFocus();
    }
  });

  /* ---------------- 移动 ---------------- */
  function nextId(
    items: DropdownItem[],
    current: string | null,
    delta: 1 | -1,
  ): string | null {
    const len = items.length;
    if (!len) return null;
    let idx = current ? items.findIndex((it) => it.id === current) : -1;
    if (idx < 0) idx = delta > 0 ? -1 : 0;
    for (let n = 0; n < len; n++) {
      idx = (idx + delta + len) % len;
      if (!items[idx].disabled) return items[idx].id;
    }
    return current;
  }

  function edgeId(items: DropdownItem[], edge: "first" | "last"): string | null {
    const seq = edge === "first" ? items : [...items].reverse();
    return seq.find((it) => !it.disabled)?.id ?? null;
  }

  function setActive(id: string) {
    activeId.value = id;
  }

  function setSubActive(id: string) {
    subActiveId.value = id;
  }

  function move(delta: 1 | -1) {
    const id = nextId(navItems.value, activeId.value, delta);
    if (!id) return;
    activeId.value = id;
    focusById(itemDomId(id));
  }

  function moveTo(edge: "first" | "last") {
    const id = edgeId(navItems.value, edge);
    if (!id) return;
    activeId.value = id;
    focusById(itemDomId(id));
  }

  function subMove(delta: 1 | -1) {
    const parentId = openSubId.value;
    if (!parentId) return;
    const id = nextId(subNavItems.value, subActiveId.value, delta);
    if (!id) return;
    subActiveId.value = id;
    focusById(subItemDomId(parentId, id));
  }

  function subMoveTo(edge: "first" | "last") {
    const parentId = openSubId.value;
    if (!parentId) return;
    const id = edgeId(subNavItems.value, edge);
    if (!id) return;
    subActiveId.value = id;
    focusById(subItemDomId(parentId, id));
  }

  /* ---------------- 子菜单 ---------------- */
  function openSub(id: string) {
    const parent = props.items.find((it) => it.id === id);
    if (!parent?.children?.length || openSubId.value === id) return;
    submenuAnchor.value = isBrowser() ? document.getElementById(itemDomId(id)) : null;
    openSubId.value = id;
    subActiveId.value = firstEnabledId(parent.children.filter((it) => !it.divider));
    nextTick(() => {
      if (openSubId.value && subActiveId.value) {
        focusById(subItemDomId(openSubId.value, subActiveId.value));
      }
    });
  }

  function closeSub(opts: { focusParent?: boolean } = {}) {
    const parentId = openSubId.value;
    openSubId.value = null;
    subActiveId.value = null;
    submenuAnchor.value = null;
    if (opts.focusParent && parentId) {
      activeId.value = parentId;
      nextTick(() => focusById(itemDomId(parentId)));
    }
  }

  /* ---------------- 选中 ---------------- */
  /** allowSubmenu=false：子菜单项一律当叶子处理（v1 只有一层） */
  function activate(item: DropdownItem, allowSubmenu = true) {
    if (item.disabled || item.divider) return;
    if (allowSubmenu && item.children?.length) {
      openSub(item.id);
      return;
    }
    emit.select(item);
    if (!props.keepOpenOnSelect) closeMenu({ restoreFocus: true });
  }

  function onItemClick(item: DropdownItem) {
    if (item.disabled) return;
    activeId.value = item.id;
    activate(item);
  }

  function onSubItemClick(item: DropdownItem) {
    if (item.disabled) return;
    subActiveId.value = item.id;
    activate(item, false);
  }

  /* ---------------- 触发器 ---------------- */

  /** click 模式交给 VaPopover 的 trigger 包装元素切换；其余模式在此拦截，避免点击误开 */
  function onTriggerClick(e: MouseEvent) {
    if (props.trigger !== "click") e.stopPropagation();
  }

  function onTriggerContextmenu(e: MouseEvent) {
    if (props.trigger !== "contextmenu" || props.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    contextAnchor.value = pointAnchor(e.clientX, e.clientY);
    // 已打开时右键仅更新锚点（popover 监听 anchor 变化自动重定位），不重复触发 open 事件
    if (!isOpen.value) openMenu();
  }

  function onTriggerKeydown(e: KeyboardEvent) {
    if (props.disabled || props.trigger === "manual") return;
    if (!isOpen.value) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    }
  }

  /** Space 的原生 click 在 keyup 派发：keydown 已处理，keyup 拦掉防二次切换 */
  function onTriggerKeyup(e: KeyboardEvent) {
    if (e.key === " ") e.preventDefault();
  }

  /* ---------------- 菜单键盘 ---------------- */
  function onMenuKeydown(e: KeyboardEvent) {
    if (!isOpen.value) return;
    const item = activeItem.value;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        e.preventDefault();
        moveTo("first");
        break;
      case "End":
        e.preventDefault();
        moveTo("last");
        break;
      case "Enter":
      case " ":
        if (!item) return;
        e.preventDefault();
        activate(item);
        break;
      case "ArrowRight":
        if (item?.children?.length) {
          e.preventDefault();
          openSub(item.id);
        }
        break;
      case "ArrowLeft":
        if (openSubId.value) {
          e.preventDefault();
          closeSub({ focusParent: true });
        }
        break;
      case "Tab":
        // 不拦截：关闭后焦点自然移出
        closeMenu();
        break;
      default:
        break;
    }
  }

  function onSubKeydown(e: KeyboardEvent) {
    if (!openSubId.value) return;
    const item = subNavItems.value.find((it) => it.id === subActiveId.value) ?? null;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        subMove(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        subMove(-1);
        break;
      case "Home":
        e.preventDefault();
        subMoveTo("first");
        break;
      case "End":
        e.preventDefault();
        subMoveTo("last");
        break;
      case "Enter":
      case " ":
        if (!item) return;
        e.preventDefault();
        activate(item, false);
        break;
      case "ArrowLeft":
        e.preventDefault();
        closeSub({ focusParent: true });
        break;
      case "ArrowRight":
        e.preventDefault(); // v1 无二级子菜单
        break;
      case "Tab":
        closeMenu();
        break;
      default:
        break;
    }
  }

  /* ---------------- 外部点击 / Esc（全局统一接管） ---------------- */
  function isInside(target: Node): boolean {
    return [
      refs.trigger.value,
      refs.triggerWrap.value,
      refs.menu.value,
      refs.submenu.value,
    ].some((el) => !!el && el.contains(target));
  }

  function onDocMousedown(e: MouseEvent) {
    if (!isOpen.value) return;
    const target = e.target as Node | null;
    if (!target || isInside(target)) return;
    closeMenu();
  }

  function onDocKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !isOpen.value) return;
    e.preventDefault();
    closeMenu({ restoreFocus: true });
  }

  onMounted(() => {
    if (!isBrowser()) return;
    document.addEventListener("mousedown", onDocMousedown);
    document.addEventListener("keydown", onDocKeydown);
    // defaultOpen：挂载即把焦点交给首个可用项（SSR 不执行）
    if (isOpen.value) focusById(activeId.value ? itemDomId(activeId.value) : null);
  });

  onBeforeUnmount(() => {
    if (!isBrowser()) return;
    document.removeEventListener("mousedown", onDocMousedown);
    document.removeEventListener("keydown", onDocKeydown);
  });

  return {
    menuId,
    submenuId,
    isOpen,
    activeId,
    openSubId,
    subActiveId,
    submenuAnchor,
    submenuOpen,
    submenuLabel,
    popoverAnchor,
    entries,
    subEntries,
    navItems,
    subNavItems,
    activeItem,
    itemDomId,
    subItemDomId,
    setActive,
    setSubActive,
    openMenu,
    closeMenu,
    toggleMenu,
    setOpen,
    onTriggerClick,
    onTriggerKeydown,
    onTriggerKeyup,
    onTriggerContextmenu,
    onMenuKeydown,
    onSubKeydown,
    onItemClick,
    onSubItemClick,
    openSub,
    closeSub,
  };
}
