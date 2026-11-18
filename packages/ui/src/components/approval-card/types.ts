/** VaApprovalCard 的类型定义 */

export type ApprovalRisk = "low" | "medium" | "high";
export type ApprovalResult = "approved" | "denied";
export type DenyReason = "manual" | "timeout";

export interface ApprovalCardProps {
  /** 请求文案，如"agent 想执行一条命令" */
  title: string;
  /** 补充说明 */
  detail?: string;
  risk?: ApprovalRisk;
  /** 命令 / 代码预览（等宽块） */
  preview?: string;
  confirmLabel?: string;
  denyLabel?: string;
  /** 倒计时秒数，到 0 自动拒绝；0 或不传则不限时 */
  countdown?: number;
  /** 显示快捷键提示（缺省 Enter/Esc 均为拒绝；开启 approveShortcut 后 Enter=批准） */
  shortcuts?: boolean;
  /**
   * 危险操作放行开关（安全默认关闭）：
   * 缺省时 Enter 与 Esc 都触发拒绝，避免误触一键放行高危操作；
   * 仅当宿主显式传 true 时，Enter 才映射为批准。
   */
  approveShortcut?: boolean;
  /** 外部传入状态持久化支持："approved" | "denied" | "pending" */
  status?: ApprovalResult | "pending";
  /** 外部传入决策原因，例如超时或用户驳回说明 */
  reason?: string;
  /** 是否支持折叠展开，默认 true */
  collapsible?: boolean;
  /** 默认是否折叠，不传时若已决策默认折叠，未决策默认展开 */
  defaultCollapsed?: boolean;
}

export interface ApprovalCardEvents {
  approve: [];
  deny: [reason?: DenyReason];
}
