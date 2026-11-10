import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { parseAnsiLine } from "../../utils/ansi";
import type { AnsiSpan } from "../../utils/ansi";
import type { TerminalLine, TerminalLogProps } from "./types";

/** VaTerminalLog 的渲染行与自动滚动逻辑（bodyEl 由组件 useTemplateRef 传入） */
export function useTerminalLog(props: TerminalLogProps, bodyEl: Ref<HTMLElement | null>) {
  /** 环形裁剪后的规范行（字符串行归一为对象） */
  const rows = computed<TerminalLine[]>(() => {
    const cap = props.maxLines ?? 1000;
    const norm = props.lines.map((l, i) =>
      typeof l === "string" ? { text: l, id: String(i) } : { id: String(i), ...l },
    );
    return norm.length > cap ? norm.slice(norm.length - cap) : norm;
  });

  /** 每行解析 ANSI（只有含 ESC 的行真正解析） */
  const spans = computed<AnsiSpan[][]>(() =>
    rows.value.map((r) => (r.text.includes("\u001b") ? parseAnsiLine(r.text) : [{ text: r.text }])),
  );

  /** 行纯文本（复制用） */
  const plainText = (i: number) => spans.value[i]!.map((s) => s.text).join("");

  /* ---------- 自动滚动：贴底时跟随，上翻暂停 ---------- */
  const stickToBottom = ref(true);

  function onScroll() {
    const el = bodyEl.value;
    if (!el) return;
    stickToBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
  }

  function scrollToBottom() {
    const el = bodyEl.value;
    if (!el) return;
    const reduced =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }

  watch(
    () => props.lines.length,
    () => {
      if (props.autoScroll === false || !stickToBottom.value) return;
      nextTick(scrollToBottom);
    },
  );

  let ro: ResizeObserver | undefined;
  onMounted(() => {
    const el = bodyEl.value;
    if (el && props.autoScroll !== false) el.scrollTop = el.scrollHeight;
    if (typeof ResizeObserver !== "undefined" && el) {
      ro = new ResizeObserver(() => {
        if (stickToBottom.value && props.autoScroll !== false) el.scrollTop = el.scrollHeight;
      });
      ro.observe(el);
    }
  });
  onBeforeUnmount(() => ro?.disconnect());

  return { rows, spans, plainText, onScroll };
}
