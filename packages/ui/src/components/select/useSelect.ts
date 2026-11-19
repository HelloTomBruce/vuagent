import { computed, nextTick, ref, useId, watch, type Ref } from "vue";
import type { SelectOption, SelectProps, SelectValue } from "./types";

/** 渲染条目：分组（role=group + 组标题）或未分组连续段 */
export interface SelectRenderOption {
  option: SelectOption;
  /** 扁平下标（跨分组连续编号，键盘导航 / aria-activedescendant 用） */
  index: number;
  domId: string;
}
export interface SelectRenderGroup {
  type: "group";
  label: string;
  titleId: string;
  items: SelectRenderOption[];
}
export interface SelectRenderPlain {
  type: "plain";
  items: SelectRenderOption[];
}
export type SelectRenderEntry = SelectRenderGroup | SelectRenderPlain;

/**
 * VaSelect：纯选择型下拉（区别于 VaCombobox 的可输入创建）。
 * 状态机：open / query / activeIdx + 受控·非受控值；键盘导航（↑↓ 跳过 disabled、
 * Home/End、字母首字符跳转、Enter/Space 选中、多选 Space 切换）。
 * 打开入口有鼠标点击（经 popover toggle）与键盘两条，故打开副作用统一收在 watch(open)。
 * SSR 安全：DOM 访问全部收在 nextTick / 事件回调里。
 */
export function useSelect(
  props: SelectProps,
  els: {
    trigger: Ref<HTMLButtonElement | null>;
    search: Ref<HTMLInputElement | null>;
  },
  emit: {
    "update:modelValue": (v: SelectValue) => void;
    change: (v: SelectValue, o: SelectOption) => void;
    clear: () => void;
    visibleChange: (open: boolean) => void;
  },
) {
  const uid = useId();
  const listId = `va-sel-${uid}-list`;

  const open = ref(props.defaultOpen ?? false);
  const query = ref("");
  /** 当前高亮的扁平下标；-1 表示无 */
  const activeIdx = ref(-1);

  /* ---------------- 值（受控优先，缺省回落非受控 defaultValue） ---------------- */
  const innerValue = ref<SelectValue | undefined>(
    props.defaultValue ?? (props.multiple ? [] : undefined),
  );
  const value = computed<SelectValue>(
    () => props.modelValue ?? innerValue.value ?? (props.multiple ? [] : ""),
  );
  /** 归一为数组，单/多选统一处理 */
  const values = computed<string[]>(() =>
    Array.isArray(value.value) ? value.value : value.value ? [value.value] : [],
  );
  const selectedOptions = computed(() => props.options.filter((o) => values.value.includes(o.value)));
  const hasValue = computed(() => values.value.length > 0);

  function isSelected(o: SelectOption) {
    return values.value.includes(o.value);
  }

  /* ---------------- 过滤 + 分组渲染模型 ---------------- */
  const filtered = computed(() => {
    const q = query.value.trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  });

  /** 扁平渲染序列：未分组在前（保持原序），随后按组名首次出现顺序排列各组 */
  const flatItems = computed<SelectRenderOption[]>(() => {
    const ungrouped = filtered.value.filter((o) => !o.group);
    const groupNames: string[] = [];
    for (const o of filtered.value) {
      if (o.group && !groupNames.includes(o.group)) groupNames.push(o.group);
    }
    const ordered = [
      ...ungrouped,
      ...groupNames.flatMap((g) => filtered.value.filter((o) => o.group === g)),
    ];
    return ordered.map((option, index) => ({ option, index, domId: `${listId}-opt-${index}` }));
  });

  const renderEntries = computed<SelectRenderEntry[]>(() => {
    const entries: SelectRenderEntry[] = [];
    for (const item of flatItems.value) {
      const g = item.option.group;
      if (!g) {
        let last = entries[entries.length - 1];
        if (!last || last.type !== "plain") {
          last = { type: "plain", items: [] };
          entries.push(last);
        }
        last.items.push(item);
      } else {
        let last = entries[entries.length - 1];
        if (!last || last.type !== "group" || last.label !== g) {
          last = { type: "group", label: g, titleId: `${listId}-group-${entries.length}`, items: [] };
          entries.push(last);
        }
        last.items.push(item);
      }
    }
    return entries;
  });

  /* ---------------- 开关 ---------------- */
  function setOpen(v: boolean) {
    if (open.value === v) return;
    open.value = v;
    emit.visibleChange(v);
  }

  function openMenu() {
    if (props.disabled || open.value) return;
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
  }

  function toggleMenu() {
    if (open.value) closeMenu();
    else openMenu();
  }

  function focusTrigger() {
    els.trigger.value?.focus();
  }

  /* 打开副作用（两条打开入口共用）：重置搜索、高亮首个已选/首个可选项、searchable 聚焦搜索框 */
  watch(open, (v) => {
    if (v) {
      query.value = "";
      const items = flatItems.value;
      const firstSelected = items.findIndex((it) => isSelected(it.option) && !it.option.disabled);
      const firstEnabled = items.findIndex((it) => !it.option.disabled);
      activeIdx.value = firstSelected >= 0 ? firstSelected : firstEnabled;
      nextTick(() => {
        if (props.searchable) els.search.value?.focus();
        scrollActiveIntoView();
      });
    } else {
      query.value = "";
      activeIdx.value = -1;
    }
  });

  /* ---------------- 选中 / 清除 ---------------- */
  function commit(next: SelectValue, o: SelectOption) {
    innerValue.value = next;
    emit["update:modelValue"](next);
    emit.change(next, o);
  }

  function pick(o: SelectOption) {
    if (o.disabled) return;
    if (props.multiple) {
      const cur = [...values.value];
      const i = cur.indexOf(o.value);
      if (i >= 0) cur.splice(i, 1);
      else cur.push(o.value);
      commit(cur, o);
      // 多选保持打开；搜索词清空回到全量列表
      query.value = "";
    } else {
      commit(o.value, o);
      closeMenu();
      focusTrigger();
    }
  }

  const showClear = computed(
    () => !!(props.clearable && hasValue.value && !props.disabled && !props.loading),
  );

  function onClear(e: MouseEvent) {
    // 阻止冒泡：不触发 popover trigger 包装元素的点击切换
    e.stopPropagation();
    const next: SelectValue = props.multiple ? [] : "";
    innerValue.value = next;
    emit["update:modelValue"](next);
    emit.clear();
    focusTrigger();
  }

  /* ---------------- 键盘导航 ---------------- */
  function scrollActiveIntoView() {
    if (typeof document === "undefined") return;
    const it = flatItems.value[activeIdx.value];
    if (!it) return;
    document.getElementById(it.domId)?.scrollIntoView?.({ block: "nearest" });
  }

  /** ↑↓ 循环移动，跳过 disabled */
  function move(step: 1 | -1) {
    const items = flatItems.value;
    const len = items.length;
    if (!len) return;
    let i = activeIdx.value;
    for (let n = 0; n < len; n++) {
      i = (i + step + len) % len;
      if (!items[i].option.disabled) {
        activeIdx.value = i;
        scrollActiveIntoView();
        return;
      }
    }
  }

  function moveTo(edge: "first" | "last") {
    const items = flatItems.value;
    const seq = edge === "first" ? items : [...items].reverse();
    const it = seq.find((x) => !x.option.disabled);
    if (it) {
      activeIdx.value = it.index;
      scrollActiveIntoView();
    }
  }

  /** 字母首字符跳转：从当前高亮之后循环找下一个 label 以该字符开头的可选项 */
  function jumpToChar(ch: string) {
    const items = flatItems.value;
    const len = items.length;
    if (!len) return;
    const c = ch.toLowerCase();
    for (let n = 1; n <= len; n++) {
      const i = (activeIdx.value + n) % len;
      const it = items[i];
      if (!it.option.disabled && it.option.label.toLowerCase().startsWith(c)) {
        activeIdx.value = i;
        scrollActiveIntoView();
        return;
      }
    }
  }

  function pickActive() {
    const it = flatItems.value[activeIdx.value];
    if (it) pick(it.option);
  }

  const activeDomId = computed(() =>
    open.value && activeIdx.value >= 0 ? flatItems.value[activeIdx.value]?.domId : undefined,
  );

  /**
   * 触发器键盘（焦点在按钮上；searchable 打开后焦点移到搜索框，走 onSearchKeydown）。
   * Enter/Space 打开或选中；需 preventDefault 拦截原生 button 的 click 激活，
   * 否则会冒泡到 popover trigger 包装元素造成二次切换（Space 的 click 在 keyup 派发，故 keyup 也要拦）。
   */
  function onTriggerKeydown(e: KeyboardEvent) {
    if (props.disabled) return;
    if (!open.value) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
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
        e.preventDefault();
        pickActive();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation(); // 自行处理：关闭并还原焦点，不再冒泡给 popover
        closeMenu();
        focusTrigger();
        break;
      case "Tab":
        closeMenu(); // 不拦截：焦点自然移出
        break;
      default:
        // 字母/数字首字符跳转（searchable 打开时焦点在搜索框，不会走到这）
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          jumpToChar(e.key);
        }
    }
  }

  /** Space 的原生 click 在 keyup 派发：keydown 已处理，keyup 拦掉防二次切换 */
  function onTriggerKeyup(e: KeyboardEvent) {
    if (e.key === " ") e.preventDefault();
  }

  /** 搜索框键盘：导航/选中/Esc；字符键留给输入本身 */
  function onSearchKeydown(e: KeyboardEvent) {
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
        e.preventDefault();
        pickActive();
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        focusTrigger();
        break;
    }
  }

  /* 打开中选项被过滤/替换时，夹取高亮下标 */
  watch(flatItems, (items) => {
    if (!open.value) return;
    if (!items.length) {
      activeIdx.value = -1;
      return;
    }
    if (activeIdx.value < 0 || activeIdx.value >= items.length) {
      activeIdx.value = items.findIndex((it) => !it.option.disabled);
    }
  });

  return {
    listId,
    open,
    query,
    activeIdx,
    value,
    values,
    selectedOptions,
    hasValue,
    isSelected,
    filtered,
    flatItems,
    renderEntries,
    showClear,
    activeDomId,
    setOpen,
    openMenu,
    closeMenu,
    toggleMenu,
    focusTrigger,
    pick,
    onClear,
    move,
    onTriggerKeydown,
    onTriggerKeyup,
    onSearchKeydown,
  };
}
