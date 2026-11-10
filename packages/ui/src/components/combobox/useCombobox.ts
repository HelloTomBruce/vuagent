import { computed, ref, watch, type Ref } from "vue";
import type { ComboboxOption, ComboboxProps } from "./types";

/**
 * VaCombobox：可输入过滤 + 可创建的下拉选择。
 * 键盘：↑↓ 循环高亮、Enter 选中/创建、Esc 关闭；SSR 安全（无直接 DOM 访问）。
 */
export function useCombobox(
  props: ComboboxProps,
  inputEl: Ref<HTMLInputElement | null>,
  emit: {
    "update:modelValue": (v: string) => void;
    create: (v: string) => void;
    select: (o: ComboboxOption) => void;
  },
) {
  const query = ref("");
  const open = ref(false);
  const activeIdx = ref(0);

  const selected = computed(() => props.options.find((o) => o.value === props.modelValue));

  /** 过滤结果 + creatable 时的"创建"伪项 */
  const items = computed<ComboboxOption[]>(() => {
    const q = query.value.trim().toLowerCase();
    const base = q
      ? props.options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : props.options;
    if (props.creatable && q && !base.some((o) => o.value.toLowerCase() === q)) {
      return [...base, { value: query.value.trim(), label: `创建「${query.value.trim()}」` }];
    }
    return base;
  });

  /** 项是否为"创建新值"伪项（不在原始 options 里） */
  const isNewItem = (o: ComboboxOption) => !props.options.some((x) => x.value === o.value);

  watch(items, () => {
    activeIdx.value = 0;
  });

  function focusInput() {
    inputEl.value?.focus();
  }

  function openMenu() {
    open.value = true;
    query.value = "";
    activeIdx.value = 0;
  }

  function close() {
    open.value = false;
    query.value = "";
  }

  function pick(o: ComboboxOption) {
    if (o.disabled) return;
    if (isNewItem(o)) {
      emit.create(o.value);
    } else {
      emit.select(o);
    }
    emit["update:modelValue"](o.value);
    open.value = false;
    query.value = "";
    focusInput();
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open.value) {
        openMenu();
        return;
      }
      const len = items.value.length;
      if (!len) return;
      activeIdx.value = (activeIdx.value + (e.key === "ArrowDown" ? 1 : -1) + len) % len;
    } else if (e.key === "Enter") {
      if (!open.value) return;
      e.preventDefault();
      const item = items.value[activeIdx.value];
      if (item) pick(item);
    } else if (e.key === "Escape" && open.value) {
      e.preventDefault();
      close();
    }
  }

  return { query, open, activeIdx, selected, items, openMenu, close, pick, onInputKeydown, focusInput };
}
