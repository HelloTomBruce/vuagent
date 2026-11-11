/** VaExperimentCard 的类型定义 */

export type ExperimentStatus = "running" | "success" | "error";

export interface ExperimentVariant {
  id: string;
  /** 变体名，如「对照组」/「改写提示词」 */
  name: string;
  /** 指标值（如 0.342 的完成率） */
  value: number;
  /** 指标格式化（如 { style: "percent", maximumFractionDigits: 1 }） */
  format?: Intl.NumberFormatOptions;
  /** 相对基线的提升（小数）；胜者上色 */
  delta?: number;
  /** 显式标记胜者（不传时由组件按 value 最大者标记） */
  winner?: boolean;
}

export interface ExperimentCardProps {
  title: string;
  status?: ExperimentStatus;
  /** 对比的指标名，如「任务完成率」 */
  metric: string;
  /** 通常 2 个变体 */
  variants: ExperimentVariant[];
  /** 置信度 0-1（如 0.95）；≥ 阈值时显示结论 */
  confidence?: number;
  /** 结论阈值，默认 0.95 */
  confidenceThreshold?: number;
  /** 开始时间 ms 时间戳（running 态展示已运行时长） */
  startedAt?: number;
}

export interface ExperimentCardEvents {
  stop: [];
  reopen: [];
}
