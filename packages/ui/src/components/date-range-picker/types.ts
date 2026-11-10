/** VaDateRangePicker 的类型定义 */

export interface DateRangePreset {
  id: string;
  label: string;
  /** 相对今天的天数偏移（起, 止）；0 = 今天 */
  from: number;
  to: number;
}

export interface DateRangePickerProps {
  /** 起始日（当日 00:00 本地时区 ms 时间戳） */
  start?: number;
  /** 结束日（当日 00:00） */
  end?: number;
  presets?: DateRangePreset[];
  /** 预设追加在默认集之后 */
  /** 触发按钮文案模板；缺省显示范围摘要 */
  placeholder?: string;
  /** 单月宽度紧凑模式 */
  months?: 1 | 2;
}

export interface DateRangePickerEvents {
  "update:start": [ts: number];
  "update:end": [ts: number];
  /** 选择了完整范围（start 与 end 都有值且 start ≤ end） */
  change: [range: { start: number; end: number }];
}
