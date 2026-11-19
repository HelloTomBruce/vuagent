/**
 * useFocusTrap — VaDialog 的焦点陷阱与焦点恢复（零依赖，SSR 安全）。
 *
 * 分两层：
 *   1. 纯函数（isFocusable / getFocusable）—— 可单测，registry 分发时随组件目录整体拷贝；
 *   2. useFocusTrap 组合式函数 —— activate（记录触发元素并把焦点移入容器）、
 *      handleTab（Tab / Shift+Tab 循环）、deactivate（焦点还原，元素已移除则跳过不抛错）。
 *
 * Esc 与堆叠栈不归这里管：弹窗可能在非栈顶（此时陷阱必须静默），
 * 由 VaDialog 持有模块级栈并只在栈顶时调用 handleTab。
 */
import { nextTick, onBeforeUnmount, type Ref } from "vue";

/** 候选选择器：粗筛后再由 isFocusable 精滤（disabled / tabindex=-1 / 不可见） */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "iframe",
  "object",
  "embed",
  "[contenteditable]",
  "[tabindex]",
].join(",");

/** 元素是否可参与 Tab 循环：未禁用、tabindex >= 0、非 display:none / visibility:hidden */
export function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  if (el.tabIndex < 0) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

/** 容器内全部可聚焦元素（DOM 序） */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable);
}

export interface UseFocusTrapOptions {
  /** 陷阱容器（弹窗面板元素） */
  container: Readonly<Ref<HTMLElement | null>>;
  /** 自定义初始焦点；返回 null/undefined 时回落到容器内第一个可聚焦元素，再回落到容器本身 */
  initialFocus?: () => HTMLElement | null | undefined;
}

export interface UseFocusTrapReturn {
  /** 记录 document.activeElement 并把焦点移入容器（SSR / 容器缺失时短路） */
  activate: () => Promise<void>;
  /** Tab / Shift+Tab 循环；无焦点元素时把焦点钉在容器上 */
  handleTab: (e: KeyboardEvent) => void;
  /** 还原焦点到 activate 时记录的元素（已移除则跳过，不抛错） */
  deactivate: () => void;
}

export function useFocusTrap(opts: UseFocusTrapOptions): UseFocusTrapReturn {
  /** 打开前聚焦的元素（关闭后还原目标） */
  let returnFocusEl: HTMLElement | null = null;

  async function activate() {
    if (typeof document === "undefined") return;
    returnFocusEl = document.activeElement as HTMLElement | null;
    await nextTick();
    const container = opts.container.value;
    if (!container) return;
    const target = opts.initialFocus?.() ?? getFocusable(container)[0] ?? container;
    target.focus({ preventScroll: true });
  }

  function handleTab(e: KeyboardEvent) {
    const container = opts.container.value;
    if (!container || typeof document === "undefined") return;
    const focusables = getFocusable(container);
    if (focusables.length === 0) {
      // 容器无可聚焦元素：焦点钉在容器本身（容器带 tabindex=-1）
      e.preventDefault();
      container.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!container.contains(active)) {
      // 焦点逃出容器（如经浏览器 UI 回到文档）：拉回循环端点
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function deactivate() {
    const el = returnFocusEl;
    returnFocusEl = null;
    if (!el || typeof document === "undefined") return;
    try {
      // 元素可能已随父组件卸载被移除：仅还原仍挂在文档里的元素
      if (document.contains(el)) el.focus({ preventScroll: true });
    } catch {
      /* 元素失效：跳过不抛错 */
    }
  }

  onBeforeUnmount(() => {
    returnFocusEl = null;
  });

  return { activate, handleTab, deactivate };
}
