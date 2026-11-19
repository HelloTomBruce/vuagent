/** VaConfirm 的类型定义 */

/** 语气：danger / warning 视为危险操作（初始焦点落在取消按钮上，安全默认） */
export type ConfirmTone = "default" | "danger" | "warning";

export interface ConfirmOptions {
  /** 标题（必填；同时作为弹窗可访问名） */
  title: string;
  /** 补充说明 */
  description?: string;
  /** 确认按钮文案，默认「确认」 */
  confirmText?: string;
  /** 取消按钮文案，默认「取消」 */
  cancelText?: string;
  /** 语气（默认 default）：决定确认按钮配色与初始焦点 */
  tone?: ConfirmTone;
  /** 标题前图标（默认 false） */
  icon?: boolean;
  /**
   * 传入字符串则开启「手输确认」：必须逐字输入该文本，确认按钮才可用。
   * 用于不可撤销操作（如输入仓库名删除仓库）。
   */
  requireText?: string;
  /** 可选勾选项（如「同时删除远程分支」）；结果经 `vaConfirm.details.checked` 返回 */
  checkboxLabel?: string;
}

export interface ConfirmItem extends ConfirmOptions {
  id: number;
  tone: ConfirmTone;
  confirmText: string;
  cancelText: string;
  icon: boolean;
}

/** 最近一次确认的完整结果（Promise 只返回 ok；勾选态在 details 里取） */
export interface ConfirmResult {
  ok: boolean;
  checked: boolean;
}

/** 全局确认 store：queue 串行渲染（宿主只显示队首），details 保留最近一次结果 */
export interface ConfirmState {
  queue: ConfirmItem[];
  details: ConfirmResult | null;
}

/** 命令式确认 API（可调用 + 附带 state / details / closeAll） */
export interface VaConfirm {
  (options: ConfirmOptions): Promise<boolean>;
  /** 当前队列（reactive，只读使用） */
  readonly state: ConfirmState;
  /** 最近一次确认结果；未发生过为 null */
  readonly details: ConfirmResult | null;
  /** 关闭全部待确认项（均 resolve false），用于路由切换/登出等场景 */
  closeAll(): void;
}
