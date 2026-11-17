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
  /** 显示快捷键提示（Enter 批准 · Esc 拒绝） */
  shortcuts?: boolean;
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
