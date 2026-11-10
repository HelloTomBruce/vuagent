import { reactive } from "vue";
import type { ToastInput, ToastItem, ToastKind } from "./types";

/** 全局通知 store：任意位置调用 vaToaster.add()，宿主 <VaToaster /> 负责渲染 */
const state = reactive<{ toasts: ToastItem[] }>({ toasts: [] });
let uid = 0;

function dismiss(id: number) {
  const i = state.toasts.findIndex((t) => t.id === id);
  if (i >= 0) state.toasts.splice(i, 1);
}

function add(input: ToastInput): number {
  const item: ToastItem = {
    id: ++uid,
    kind: "info" as ToastKind,
    duration: 4200,
    ...input,
  };
  state.toasts.push(item);
  if (item.duration > 0 && typeof window !== "undefined") {
    window.setTimeout(() => dismiss(item.id), item.duration);
  }
  return item.id;
}

export const vaToaster = {
  /** 通知列表（reactive，只读使用） */
  state,
  /** 发一条通知，返回 id */
  add,
  /** 手动关闭 */
  dismiss,
};

/** 组合式别名，与 vaToaster 等价 */
export function useToaster() {
  return vaToaster;
}
