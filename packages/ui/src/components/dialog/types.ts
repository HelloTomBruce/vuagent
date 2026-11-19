/** VaDialog 的类型定义 */

/** 弹窗尺寸：sm/md/lg 限最大宽度；full 占满视口（留 16px 边距） */
export type DialogSize = "sm" | "md" | "lg" | "full";

export interface DialogProps {
  /** 受控开关（配合 @update:open 实现 v-model:open）；不传则非受控 */
  open?: boolean;
  /** 非受控初始开关 */
  defaultOpen?: boolean;
  /** 标题（渲染为 h2 并自动关联 aria-labelledby） */
  title?: string;
  /** 描述文本（渲染为 p 并自动关联 aria-describedby） */
  description?: string;
  /** 无 title / title 插槽时必填：为弹窗提供可访问名（缺省控制台警告） */
  ariaLabel?: string;
  /** 语义角色（默认 dialog）；危险操作确认等需打断读屏的场合用 alertdialog */
  role?: "dialog" | "alertdialog";
  /** 尺寸（默认 md） */
  size?: DialogSize;
  /** 右上角关闭按钮（默认 true；点击派发 close 请求） */
  closable?: boolean;
  /** 点遮罩关闭（默认 true；仅堆叠栈顶响应） */
  maskClosable?: boolean;
  /** Esc 关闭（默认 true；仅堆叠栈顶响应） */
  closeOnEscape?: boolean;
  /** 锁定 body 滚动（默认 true；计数器实现，叠开不提前解锁；补偿滚动条宽度防抖动） */
  lockScroll?: boolean;
  /** Teleport 目标（默认 'body'） */
  teleportTo?: string | HTMLElement;
  /** 打开时的初始焦点：选择器或元素；缺省（null）聚焦容器内第一个可聚焦元素 */
  initialFocus?: string | HTMLElement | null;
  /** 关闭并播完退出动画后卸载内容（默认 false：保留 DOM 仅 visibility 隐藏） */
  destroyOnClose?: boolean;
}

export interface DialogEvents {
  "update:open": [open: boolean];
  /** 用户请求关闭（关闭按钮 / 遮罩 / Esc / 程序化 close） */
  close: [];
  /** 进入动画结束 */
  opened: [];
  /** 退出动画结束（焦点已恢复、滚动锁已释放） */
  closed: [];
}

export interface DialogSlots {
  /** 弹窗主体内容 */
  default?: (props: { close: () => void }) => unknown;
  /** 头部整块自定义（替换默认 title/description 渲染，ARIA 关联需自行处理） */
  header?: (props: { close: () => void }) => unknown;
  /** 仅自定义标题内容（保留默认头部结构与 aria 关联） */
  title?: () => unknown;
  /** 底部操作区 */
  footer?: (props: { close: () => void }) => unknown;
}
