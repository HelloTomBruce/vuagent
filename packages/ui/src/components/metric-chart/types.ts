/**
 * @vuagent/ui - VaMetricChart 类型定义
 */

export interface MetricSeriesItem {
  label: string;
  value: number;
}

export interface MetricChartProps {
  title: string;
  chartType?: "line" | "bar";
  unit?: string;
  series: MetricSeriesItem[];
}
