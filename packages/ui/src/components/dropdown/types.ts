/** VaDropdown 的类型定义 */

import type { PopoverPlacement } from "../popover/types";

/** 触发方式：点击触发按钮 / 右键（虚拟锚点）/ 手动（宿主调用 open()） */
export type DropdownTrigger = "click" | "contextmenu" | "manual";

/** 复用 Popover 的方位枚举（默认 bottom-end，更贴合三点菜单） */
export type DropdownPlacement = PopoverPlacement;

/** 渲染条目：分组标题、分隔线、可交互项 */
export type DropdownEntry =
  | { type: "item"; key: string; item: DropdownItem }
  | { type: "divider"; key: string }
  | { type: "group"; key: string; label: string };

export interface DropdownItem {
  id: string;
  /** 项文案；divider 项可省略 */
  label?: string;
  /** 前置图标（字符 / emoji，零依赖） */
  icon?: string;
  /** 右侧快捷键提示（仅文案，不注册全局热键） */
  shortcut?: string;
  disabled?: boolean;
  /** 危险操作（红色文字） */
  danger?: boolean;
  /** 渲染为分隔线（其余字段忽略） */
  divider?: boolean;
  /** 分组标题：与相邻同组项共用一个组标题 */
  group?: string;
  /** 选中态：前置对勾 */
  checked?: boolean;
  /** 存在时该行是子菜单入口（v1 仅支持一层） */
  children?: DropdownItem[];
}

export interface DropdownProps {
  items: DropdownItem[];
  /** 触发方式，默认 click */
  trigger?: DropdownTrigger;
  /** 浮层方位，默认 bottom-end */
  placement?: DropdownPlacement;
  /** 受控开关（配合 @update:open 实现 v-model:open） */
  open?: boolean;
  /** 非受控初始打开 */
  defaultOpen?: boolean;
  /** 没有图标时的按钮文案；图标态下作为 aria-label */
  triggerLabel?: string;
  /** 触发器图标，默认垂直三点「⋮」；传空串可只显示文案 */
  triggerIcon?: string;
  /** 隐藏触发器右侧的箭头 */
  hideChevron?: boolean;
  /** 选中后保持打开（多选/连续操作场景） */
  keepOpenOnSelect?: boolean;
  /** 禁用：触发器不再打开菜单 */
  disabled?: boolean;
  /** 菜单 aria-label（缺省「动作菜单」） */
  ariaLabel?: string;
}

export interface DropdownEvents {
  "update:open": [open: boolean];
  /** 选中某个叶子项（disabled 项不触发；子菜单入口不触发） */
  select: [item: DropdownItem];
  open: [];
  close: [];
}

export interface DropdownSlots {
  /** 自定义触发器（不渲染默认按钮） */
  trigger?: (props: { open: boolean; toggle: () => void }) => unknown;
  /** 自定义单项内容（对勾/图标/快捷键外壳仍由组件渲染） */
  item?: (props: {
    item: DropdownItem;
    active: boolean;
    checked: boolean;
    disabled: boolean;
  }) => unknown;
}
