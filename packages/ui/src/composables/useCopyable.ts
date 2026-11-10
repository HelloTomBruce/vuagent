import { onBeforeUnmount, ref } from "vue";

/**
 * 复制到剪贴板 + copied 短暂置真反馈。
 * SSR 安全：navigator/document 均有守卫；失败静默（宿主可监听回调自行提示）。
 */
export function useCopyable(getText: () => string, onCopy?: (text: string) => void) {
  const copied = ref(false);
  let timer: number | undefined;

  async function copy() {
    const t = getText();
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(t);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
    } catch {
      /* 剪贴板不可用 */
    }
    copied.value = true;
    onCopy?.(t);
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => (copied.value = false), 1500);
  }

  onBeforeUnmount(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });

  return { copied, copy };
}
