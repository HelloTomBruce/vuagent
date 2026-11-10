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
}

export interface ApprovalCardEvents {
  approve: [];
  deny: [reason?: DenyReason];
}
