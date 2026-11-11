/** VaBreakdownChart 的类型定义 */

export interface BreakdownItem {
  label: string;
  value: number;
  /** CSS 色；缺省按序取内置色板 */
  color?: string;
}

export interface BreakdownChartProps {
  items: BreakdownItem[];
  /** 总量（分母）；缺省为各项求和 */
  total?: number;
  /** 单位文案，如 "次" / "tokens" */
  unit?: string;
  /** 条长按最大项（默认）还是按总占比 */
  barScale?: "max" | "total";
  /** 超过该行数折叠为"其他"（聚合剩余）；不设则全部展示 */
  maxRows?: number;
}

export interface BreakdownChartEvents {
  /** 点击某行（含折叠出的"其他"聚合行，label 为 "其他"） */
  select: [item: BreakdownItem];
}
