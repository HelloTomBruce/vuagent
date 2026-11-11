/** VaKpiChart 的类型定义 */

export interface KpiChartProps {
  /** 指标名，如「今日 agent 运行」 */
  label: string;
  /** 当前值 */
  value: number;
  /** 数值格式化（Intl.NumberFormatOptions，如货币/百分数） */
  format?: Intl.NumberFormatOptions;
  /** 环比变化（小数，0.12 = +12%）；正负决定涨跌色与箭头 */
  delta?: number;
  /** 变化率的参照文案，如「较上周」 */
  deltaLabel?: string;
  /** sparkline 数据序列 */
  series: number[];
  /** sparkline 尺寸 px（默认 120×36） */
  width?: number;
  height?: number;
  /** 线条主色（CSS 色），默认 accent */
  color?: string;
  /** 涨=好（默认）/跌=好（如错误率场景翻转变色） */
  invertDelta?: boolean;
}

export interface KpiChartEvents {
  /** 点击卡片 */
  click: [];
}
