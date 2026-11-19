/** VaPopover 的类型定义 */

/** 浮层初始方位：上下各带 start/center/end 对齐；左右仅居中（v1 不翻转左右） */
export type PopoverPlacement =
  | "bottom-start"
  | "bottom"
  | "bottom-end"
  | "top-start"
  | "top"
  | "top-end"
  | "right"
  | "left";

/** 虚拟锚点：任何能提供包围盒的对象（如鼠标位置、选区、跨组件传来的测量结果） */
export interface VirtualAnchor {
  getBoundingClientRect(): DOMRect;
}

/** 锚点：真实元素或虚拟锚点；null 表示暂不可用（浮层保持隐藏直到可测量） */
export type PopoverAnchor = HTMLElement | VirtualAnchor | null;

export interface PopoverProps {
  /** 受控开关（配合 @update:open 实现 v-model:open）；不传则非受控 */
  open?: boolean;
  /** 非受控初始开关 */
  defaultOpen?: boolean;
  /** 外部锚点；缺省时使用 trigger 插槽的内部包装元素作为锚点 */
  anchor?: PopoverAnchor;
  /** 初始方位（默认 bottom-start）；主方向空间不足时自动翻转 */
  placement?: PopoverPlacement;
  /** 锚点与浮层间距 px（默认 6） */
  offset?: number;
  /** 浮层 min-width = 锚点宽度（Select 场景） */
  matchAnchorWidth?: boolean;
  /** 点击浮层/锚点外部时关闭（默认 true） */
  closeOnOutsideClick?: boolean;
  /** Esc 关闭（默认 true；仅堆叠栈顶响应，多浮层叠开不误关底层） */
  closeOnEscape?: boolean;
  /** 禁用：trigger 点击不再切换；置 true 时若正开着会立即关闭 */
  disabled?: boolean;
  /** Teleport 目标（默认 'body'） */
  teleportTo?: string | HTMLElement;
}

export interface PopoverEvents {
  "update:open": [open: boolean];
  open: [];
  close: [];
}

export interface PopoverSlots {
  /** 触发器；组件内部包装元素自动绑定点击切换并充当锚点 */
  trigger?: (props: { open: boolean; toggle: () => void }) => unknown;
  /** 浮层内容；role/aria 由消费组件自行声明（容器保持语义中立） */
  default?: (props: { close: () => void }) => unknown;
}
