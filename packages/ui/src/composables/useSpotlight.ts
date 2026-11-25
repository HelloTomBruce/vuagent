import { getCurrentInstance, onScopeDispose, ref } from "vue";

/**
 * 静态光斑指针追踪（TASK-105「追光」基建，与 styles/motion.css 的 .va-spotlight 联用）：
 * pointermove 以 rAF 节流把指针在元素内的百分比坐标写入 --va-spot-x/--va-spot-y
 * 自定义属性（motion.css 的 radial 光斑消费，无 3D 倾斜——glare 数学对齐 VaTiltCard）。
 *
 * 接入（宿主元素挂 .va-spotlight）：
 *   <div class="va-spotlight"
 *        @pointerenter="spot.onPointerEnter"
 *        @pointermove="spot.onPointerMove"
 *        @pointerleave="spot.onPointerLeave">
 *
 * 环境分频（一次性读取，不监听系统切换，对齐 useStagger 范式）：
 *   SSR（无 window）/ hover: none（触屏）/ reduced-motion → enabled=false，
 *   handler 直接短路（不写变量、不排帧）；显隐由 motion.css 媒体块兜底。
 * 光斑尺寸/颜色为 L3 钩子（--va-spot-size/--va-spot-color，见 motion.css），不进 tokens.css。
 */

/** 参与几何计算的矩形最小面（getBoundingClientRect 的可测子集） */
export interface SpotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 元素内百分比坐标（保留 1 位小数） */
export interface SpotPoint {
  x: number;
  y: number;
}

export interface UseSpotlightOptions {
  /** 显式关闭（宿主自行控制）；默认按环境检测 */
  disabled?: boolean;
}

/**
 * 纯几何：指针视口坐标 → 元素内百分比（0..100，越界钳制）。
 * 零宽/高（未布局，如 happy-dom 默认）回退中心 50——防御除零，可单测。
 */
export function spotPercent(clientX: number, clientY: number, rect: SpotRect): SpotPoint {
  const nx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const ny = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  const pct = (ratio: number) => Math.round(Math.min(Math.max(ratio, 0), 1) * 1000) / 10;
  return { x: pct(nx), y: pct(ny) };
}

export function useSpotlight(options: UseSpotlightOptions = {}) {
  const enabled = ref(
    !(options.disabled ?? false) &&
      typeof window !== "undefined" &&
      !(window.matchMedia?.("(hover: none)")?.matches ?? false) &&
      !(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false),
  );

  let frame: number | null = null;
  let pending: { el: HTMLElement; clientX: number; clientY: number } | null = null;

  function writeVars(el: HTMLElement, clientX: number, clientY: number) {
    const pos = spotPercent(clientX, clientY, el.getBoundingClientRect());
    el.style.setProperty("--va-spot-x", `${pos.x}%`);
    el.style.setProperty("--va-spot-y", `${pos.y}%`);
  }

  function cancelFrame() {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    pending = null;
  }

  // 组件作用域内注册清理：hover 进行中卸载时取消在途 rAF（对齐 useAgentChat
  // 的卸载 flush 范式），避免 detached 元素被迟到帧回调继续写 CSS 变量
  // （单测等非组件环境无实例，自然跳过）。
  if (getCurrentInstance()) {
    onScopeDispose(cancelFrame);
  }

  /** rAF 回调：取本帧最后一次 move 的坐标落变量（合并同帧高频移动） */
  function flush() {
    frame = null;
    if (!pending) return;
    const { el, clientX, clientY } = pending;
    pending = null;
    writeVars(el, clientX, clientY);
  }

  /** pointermove：每帧至多排一次 rAF（节流），同帧内取最新坐标 */
  function onPointerMove(e: PointerEvent | MouseEvent) {
    if (!enabled.value) return;
    pending = { el: e.currentTarget as HTMLElement, clientX: e.clientX, clientY: e.clientY };
    if (frame !== null) return;
    frame = window.requestAnimationFrame(flush);
  }

  /** pointerenter：立即写一次，避免沿用上次离开时的旧坐标闪一帧 */
  function onPointerEnter(e: PointerEvent | MouseEvent) {
    if (!enabled.value) return;
    cancelFrame();
    writeVars(e.currentTarget as HTMLElement, e.clientX, e.clientY);
  }

  /** pointerleave：光斑归中（显隐由 CSS :hover 负责，这里防下次进入闪旧位） */
  function onPointerLeave(e: PointerEvent | MouseEvent) {
    if (!enabled.value) return;
    cancelFrame();
    const el = e.currentTarget as HTMLElement;
    el.style.setProperty("--va-spot-x", "50%");
    el.style.setProperty("--va-spot-y", "50%");
  }

  return { enabled, onPointerEnter, onPointerMove, onPointerLeave };
}
