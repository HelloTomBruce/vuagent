/**
 * useFloating — VaPopover 的定位引擎（零依赖，不引 floating-ui）。
 *
 * 结构分两层：
 *   1. 纯函数（clamp / parsePlacement / computeCoords / flipPlacement / shiftIntoView / computeFloating）
 *      —— 无 DOM 依赖，可单测；registry 分发时随组件目录整体拷贝。
 *   2. useFloating 组合式函数 —— 负责测量（getBoundingClientRect）、
 *      scroll(capture)/resize 的 rAF 节流重算、点击外部与 Esc（堆叠栈顶）关闭、
 *      监听器的挂载/卸载同步，SSR 下全部短路。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { PopoverAnchor, PopoverPlacement } from "./types";

/* ==========================================================================
   纯函数：定位计算
   ========================================================================== */

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type FloatingSide = "top" | "bottom" | "left" | "right";
export type FloatingAlign = "start" | "center" | "end";

/** 视口边缘留白（shift 平移时保留） */
export const VIEWPORT_PADDING = 8;
/** 默认锚点-浮层间距 */
export const DEFAULT_OFFSET = 6;

/** 夹取到 [min, max]；min > max 时退化为 min（浮层比视口还大的极端场景） */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

/** "bottom-start" → { side: "bottom", align: "start" }；"right" → align: "center" */
export function parsePlacement(placement: PopoverPlacement): { side: FloatingSide; align: FloatingAlign } {
  const [side, align] = placement.split("-") as [FloatingSide, FloatingAlign | undefined];
  return { side, align: align ?? "center" };
}

function composePlacement(side: FloatingSide, align: FloatingAlign): PopoverPlacement {
  return (align === "center" ? side : `${side}-${align}`) as PopoverPlacement;
}

function alignMainX(align: FloatingAlign, anchor: Rect, floatingWidth: number): number {
  if (align === "start") return anchor.left;
  if (align === "end") return anchor.right - floatingWidth;
  return anchor.left + anchor.width / 2 - floatingWidth / 2;
}

/** 按方位计算未加防溢出的初始坐标（视口坐标系，与 getBoundingClientRect 一致） */
export function computeCoords(
  side: FloatingSide,
  align: FloatingAlign,
  anchor: Rect,
  floating: Size,
  offset: number,
): { x: number; y: number } {
  switch (side) {
    case "bottom":
      return { x: alignMainX(align, anchor, floating.width), y: anchor.bottom + offset };
    case "top":
      return { x: alignMainX(align, anchor, floating.width), y: anchor.top - floating.height - offset };
    case "right":
      return { x: anchor.right + offset, y: anchor.top + anchor.height / 2 - floating.height / 2 };
    case "left":
      return { x: anchor.left - floating.width - offset, y: anchor.top + anchor.height / 2 - floating.height / 2 };
  }
}

/**
 * flip：仅主方向 top/bottom 参与——本侧空间放不下浮层（含 offset）且对侧充足（放得下）时翻转，
 * 对齐方式保留；两侧都放不下时保持原方位（交给 shift 夹取）。left/right 不翻转（v1 承诺范围）。
 */
export function flipPlacement(
  placement: PopoverPlacement,
  anchor: Rect,
  floating: Size,
  viewport: Viewport,
  offset: number,
  padding: number,
): PopoverPlacement {
  const { side, align } = parsePlacement(placement);
  if (side !== "top" && side !== "bottom") return placement;
  const need = floating.height + offset;
  const spaceBelow = viewport.height - anchor.bottom - padding;
  const spaceAbove = anchor.top - padding;
  if (side === "bottom" && need > spaceBelow && need <= spaceAbove) {
    return composePlacement("top", align);
  }
  if (side === "top" && need > spaceAbove && need <= spaceBelow) {
    return composePlacement("bottom", align);
  }
  return placement;
}

/** shift：越界时平移回视口，四周保留 padding 边距 */
export function shiftIntoView(
  x: number,
  y: number,
  floating: Size,
  viewport: Viewport,
  padding: number,
): { x: number; y: number } {
  return {
    x: clamp(x, padding, viewport.width - floating.width - padding),
    y: clamp(y, padding, viewport.height - floating.height - padding),
  };
}

export interface ComputeFloatingOptions {
  anchorRect: Rect;
  floatingSize: Size;
  placement: PopoverPlacement;
  viewport: Viewport;
  offset?: number;
  /** shift 边距（默认 VIEWPORT_PADDING = 8） */
  padding?: number;
  matchAnchorWidth?: boolean;
}

export interface FloatingResult {
  x: number;
  y: number;
  /** 实际生效方位（flip 后） */
  placement: PopoverPlacement;
  /** matchAnchorWidth 时等于锚点宽度，否则 undefined */
  minWidth?: number;
}

/** 完整定位管线：flip → 坐标 → shift；一次性返回样式所需全部数据 */
export function computeFloating(opts: ComputeFloatingOptions): FloatingResult {
  const offset = opts.offset ?? DEFAULT_OFFSET;
  const padding = opts.padding ?? VIEWPORT_PADDING;
  const placement = flipPlacement(opts.placement, opts.anchorRect, opts.floatingSize, opts.viewport, offset, padding);
  const { side, align } = parsePlacement(placement);
  const base = computeCoords(side, align, opts.anchorRect, opts.floatingSize, offset);
  const { x, y } = shiftIntoView(base.x, base.y, opts.floatingSize, opts.viewport, padding);
  return { x, y, placement, minWidth: opts.matchAnchorWidth ? opts.anchorRect.width : undefined };
}

/* ==========================================================================
   useFloating：测量 + 监听 + 关闭交互
   ========================================================================== */

export interface UseFloatingOptions {
  /** 解析后的锚点（外部 anchor 优先，缺省为 trigger 包装元素） */
  anchor: Readonly<Ref<PopoverAnchor | undefined>>;
  /** 浮层元素 */
  floating: Readonly<Ref<HTMLElement | null>>;
  open: Readonly<Ref<boolean>>;
  placement: Readonly<Ref<PopoverPlacement>>;
  offset: Readonly<Ref<number>>;
  matchAnchorWidth: Readonly<Ref<boolean>>;
  closeOnOutsideClick: Readonly<Ref<boolean>>;
  closeOnEscape: Readonly<Ref<boolean>>;
  /** 请求关闭（外部点击 / Esc 栈顶命中时触发） */
  onRequestClose: () => void;
}

export interface UseFloatingReturn {
  floatingStyle: Readonly<Ref<Record<string, string>>>;
  /** flip 后的实际方位（供 data-placement / 箭头定位） */
  actualPlacement: Readonly<Ref<PopoverPlacement>>;
  /** 已完成首次测量（未测量时浮层 visibility:hidden，避免 (0,0) 闪跳） */
  measured: Readonly<Ref<boolean>>;
  /** 立即重算位置 */
  update: () => void;
}

/** 多浮层堆叠栈：仅栈顶响应 Esc（模块级单例，跨实例共享） */
const overlayStack: number[] = [];
let overlaySeq = 0;

const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

function toRect(r: { top: number; left: number; right: number; bottom: number; width: number; height: number }): Rect {
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}

/** target 是否命中锚点（真实元素可 contains；虚拟锚点无 DOM 关系，判不命中） */
function hitAnchor(anchor: PopoverAnchor | undefined, target: Node): boolean {
  if (!anchor) return false;
  return anchor instanceof Element && anchor.contains(target);
}

export function useFloating(opts: UseFloatingOptions): UseFloatingReturn {
  const id = ++overlaySeq;
  const coords = ref({ x: 0, y: 0 });
  const actualPlacement = ref<PopoverPlacement>(opts.placement.value);
  const minWidthPx = ref<number | null>(null);
  const measured = ref(false);

  let rafId: number | null = null;
  let listening = false;
  /** 浮层自身尺寸变化的观察者：内容异步增长（列表加载/图片解码）时需重测算，
   *  否则位置停在"测量瞬间的矮高度"，浮层向下生长会压住锚点 */
  let sizeObserver: ResizeObserver | null = null;

  /** 立即重算（SSR / 未开 / 锚点或浮层缺失时短路） */
  function update() {
    if (!isBrowser() || !opts.open.value) return;
    const anchor = opts.anchor.value;
    const floating = opts.floating.value;
    if (!anchor || !floating) return;
    const result = computeFloating({
      anchorRect: toRect(anchor.getBoundingClientRect()),
      floatingSize: toRect(floating.getBoundingClientRect()),
      placement: opts.placement.value,
      offset: opts.offset.value,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      matchAnchorWidth: opts.matchAnchorWidth.value,
    });
    coords.value = { x: result.x, y: result.y };
    actualPlacement.value = result.placement;
    minWidthPx.value = result.minWidth ?? null;
    measured.value = true;
  }

  /** rAF 节流：同一帧内多次 scroll/resize 只重算一次；无 rAF 环境退化为同步 */
  function scheduleUpdate() {
    if (typeof requestAnimationFrame !== "function") {
      update();
      return;
    }
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      update();
    });
  }

  const onScrollOrResize = () => scheduleUpdate();

  const onDocMousedown = (e: MouseEvent) => {
    if (!opts.open.value || !opts.closeOnOutsideClick.value) return;
    const target = e.target as Node | null;
    if (!target) return;
    const floating = opts.floating.value;
    if (floating && floating.contains(target)) return;
    if (hitAnchor(opts.anchor.value, target)) return;
    opts.onRequestClose();
  };

  const onDocKeydown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (!opts.open.value || !opts.closeOnEscape.value) return;
    if (overlayStack[overlayStack.length - 1] !== id) return;
    opts.onRequestClose();
  };

  function addListeners() {
    if (!isBrowser() || listening) return;
    listening = true;
    // capture 阶段的 scroll：覆盖任意嵌套滚动容器（scroll 不冒泡）
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("mousedown", onDocMousedown);
    document.addEventListener("keydown", onDocKeydown);
    if (!overlayStack.includes(id)) overlayStack.push(id);

    // 浮层尺寸变化 → 重测算（ResizeObserver 缺失环境静默跳过）
    const floating = opts.floating.value;
    if (floating && typeof ResizeObserver === "function") {
      sizeObserver = new ResizeObserver(() => scheduleUpdate());
      sizeObserver.observe(floating);
    }
  }

  function removeListeners() {
    if (!listening) return;
    listening = false;
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    sizeObserver?.disconnect();
    sizeObserver = null;
    document.removeEventListener("mousedown", onDocMousedown);
    document.removeEventListener("keydown", onDocKeydown);
    const i = overlayStack.indexOf(id);
    if (i >= 0) overlayStack.splice(i, 1);
    if (rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // open 变化：开时等浮层渲染后测量并挂监听；关时卸监听、重置测量态
  watch(
    opts.open,
    async (v) => {
      if (v) {
        await nextTick();
        update();
        addListeners();
      } else {
        removeListeners();
        measured.value = false;
      }
    },
    { flush: "post" },
  );

  // 方位/间距/锚点变化时重算（仅在开着时）
  watch([opts.placement, opts.offset, opts.anchor, opts.matchAnchorWidth], () => {
    if (opts.open.value) scheduleUpdate();
  });

  onMounted(() => {
    if (opts.open.value) {
      update();
      addListeners();
    }
  });
  onBeforeUnmount(removeListeners);

  const floatingStyle = computed<Record<string, string>>(() => ({
    position: "fixed",
    top: `${coords.value.y}px`,
    left: `${coords.value.x}px`,
    ...(minWidthPx.value != null ? { minWidth: `${minWidthPx.value}px` } : {}),
    visibility: measured.value ? "visible" : "hidden",
  }));

  return { floatingStyle, actualPlacement, measured, update };
}
