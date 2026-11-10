import { nextTick, onMounted, ref, type Ref } from "vue";
import type { ComposerProps } from "./types";

/** VaComposer 的状态逻辑：自动增高、Enter 发送（Shift+Enter 换行、IME 组合期不发送）。area 由 SFC 传入 */
export function useComposer(
  props: ComposerProps,
  text: Ref<string>,
  area: Ref<HTMLTextAreaElement | null>,
  emit: { send: (t: string) => void },
) {
  const composing = ref(false);

  /** 输入后按内容调整高度，封顶 props.maxHeight */
  async function autosize() {
    const el = area.value;
    if (!el) return;
    el.style.height = "auto";
    await nextTick();
    const max = props.maxHeight ?? 160;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }

  function onInput(e: Event) {
    text.value = (e.target as HTMLTextAreaElement).value;
    void autosize();
  }

  function submit() {
    const t = text.value.trim();
    if (props.disabled || props.busy) return;
    if (!props.allowEmpty && !t) return;
    emit.send(t);
    text.value = "";
    void autosize();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey || composing.value) return;
    e.preventDefault();
    submit();
  }

  // 初始已有文本（如草稿回填）时也按内容定高
  onMounted(() => {
    if (text.value) void autosize();
  });

  return { composing, onInput, submit, onKeydown };
}
