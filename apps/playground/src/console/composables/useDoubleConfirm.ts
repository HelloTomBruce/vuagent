/**
 * 危险操作二次确认（3 秒内再次点击同一目标才执行）
 * 从原 Console.vue 的 confirmDelete* + confirmTimer 模式抽象而来
 */
import { onUnmounted, ref } from "vue";

export function useDoubleConfirm(delayMs = 3000) {
  const confirmId = ref<string | null>(null);
  let timer: number | null = null;

  function ask(id: string, onConfirm: () => void) {
    if (confirmId.value === id) {
      confirmId.value = null;
      onConfirm();
    } else {
      confirmId.value = id;
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        confirmId.value = null;
      }, delayMs);
    }
  }

  onUnmounted(() => {
    if (timer) clearTimeout(timer);
  });

  return { confirmId, ask };
}
