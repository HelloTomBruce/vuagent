export { default as VaPopover } from "./VaPopover.vue";
export {
  clamp,
  computeCoords,
  computeFloating,
  flipPlacement,
  parsePlacement,
  shiftIntoView,
  useFloating,
  DEFAULT_OFFSET,
  VIEWPORT_PADDING,
} from "./useFloating";
export type {
  ComputeFloatingOptions,
  FloatingAlign,
  FloatingResult,
  FloatingSide,
  Rect,
  Size,
  UseFloatingOptions,
  UseFloatingReturn,
  Viewport,
} from "./useFloating";
export type { PopoverAnchor, PopoverEvents, PopoverPlacement, PopoverProps, PopoverSlots, VirtualAnchor } from "./types";
