import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { ModelItem, ModelPickerProps } from "./types";

export const DEFAULT_MODELS: ModelItem[] = [
  { id: "claude", name: "Claude", tag: "推荐" },
  { id: "gpt", name: "GPT" },
  { id: "gemini", name: "Gemini" },
  { id: "deepseek", name: "DeepSeek" },
  { id: "qwen", name: "Qwen" },
];

/** VaModelPicker 的状态逻辑：开合、点外关闭、上下键导航、Enter 选中。root 由 SFC 传入 */
export function useModelPicker(props: ModelPickerProps, selected: Ref<string>, root: Ref<HTMLElement | null>) {
  const models = computed(() => (props.models?.length ? props.models : DEFAULT_MODELS));
  const open = ref(false);
  const activeIdx = ref(0);

  const current = computed(() => models.value.find((m) => m.id === selected.value) ?? models.value[0]);

  function onOutside(e: Event) {
    const el = root.value;
    if (el && !el.contains(e.target as Node)) closeMenu();
  }

  function openMenu() {
    open.value = true;
    activeIdx.value = Math.max(0, models.value.findIndex((m) => m.id === selected.value));
    if (typeof document !== "undefined") {
      document.addEventListener("pointerdown", onOutside, true);
    }
  }
  function closeMenu() {
    open.value = false;
    if (typeof document !== "undefined") {
      document.removeEventListener("pointerdown", onOutside, true);
    }
  }
  function toggle() {
    open.value ? closeMenu() : openMenu();
  }

  /** 触发按钮的 click：键盘 Enter/Space 合成的 click（detail===0）已由 onKeydown 处理，跳过避免"关了又开" */
  function onTriggerClick(e: MouseEvent) {
    if (e.detail === 0) return;
    toggle();
  }

  function pick(m: ModelItem) {
    selected.value = m.id;
    closeMenu();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (!open.value) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      activeIdx.value = (activeIdx.value + dir + models.value.length) % models.value.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = models.value[activeIdx.value];
      if (m) pick(m);
    }
  }

  onMounted(() => {
    // 卫语句：selected 不在列表里时回落到第一个
    if (!models.value.some((m) => m.id === selected.value)) {
      selected.value = models.value[0]?.id ?? "";
    }
  });
  onBeforeUnmount(closeMenu);

  return { models, open, activeIdx, current, toggle, onTriggerClick, closeMenu, pick, onKeydown };
}
