/** VaProgressTracker 的类型定义 */

export type TrackerStepStatus = "pending" | "current" | "done" | "error";

export interface TrackerStep {
  label: string;
  /** 缺省按位置推断：当前位置 current、之前 done、之后 pending */
  status?: TrackerStepStatus;
}

export interface ProgressTrackerProps {
  steps: TrackerStep[];
  /** 当前步下标（steps 未显式给 status 时按此推断） */
  current?: number;
  orientation?: "horizontal" | "vertical";
}

export interface ProgressTrackerEvents {
  /** 点击步骤节点（横向可作跳转；携带下标） */
  select: [index: number];
}
