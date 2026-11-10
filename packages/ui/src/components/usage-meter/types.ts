/** VaUsageMeter 的类型定义 */

export interface UsageSegment {
  label: string;
  used: number;
  /** 段色（CSS 色）；缺省按序取内置色 */
  color?: string;
}

export interface UsageMeterProps {
  /** 多段用量（如 fast/slow tokens、credits），堆叠展示 */
  segments: UsageSegment[];
  /** 周期限额（分母） */
  limit: number;
  /** 计数单位文案，如 "tokens" / "credits" */
  unit?: string;
  /** 周期文案，如 "今日 · 明早 8 点重置" */
  period?: string;
  /** 占限额比例超过该值显示预警（0-1，默认 0.8） */
  warnAt?: number;
  /** 用量条高度 px（默认 10） */
  barHeight?: number;
}

export interface UsageMeterEvents {
  /** 点击"管理/升级"入口 */
  manage: [];
}
