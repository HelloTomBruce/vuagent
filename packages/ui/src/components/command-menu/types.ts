/** VaCommandMenu 的类型定义 */

export interface CommandItem {
  id: string;
  /** 菜单项文案 */
  label: string;
  /** 分组标题；相同 group 相邻渲染为一组 */
  group?: string;
  /** 右侧提示（快捷键文案，如 "⌘K"） */
  hint?: string;
  /** 过滤用关键词（与 label 一起参与匹配） */
  keywords?: string;
  disabled?: boolean;
  /** 危险操作（红色文案） */
  danger?: boolean;
}

export interface CommandMenuProps {
  commands: CommandItem[];
  /** 受控开关（配合 @update:open 实现 v-model:open） */
  open?: boolean;
  /** 非受控初始开（仅未绑定 open 时生效） */
  defaultOpen?: boolean;
  /** 输入框占位 */
  placeholder?: string;
  /** 触发按钮上展示的快捷键提示（仅文案，不自动注册全局热键） */
  hotkey?: string;
  /** 触发按钮文案，默认 "命令" */
  triggerLabel?: string;
  /** 空结果文案 */
  emptyLabel?: string;
  /** 面板最大高度 px，默认 380 */
  maxHeight?: number;
}

export interface CommandMenuEvents {
  "update:open": [v: boolean];
  /** 键盘或点击选中某项（disabled 项不可选中） */
  select: [item: CommandItem];
}
