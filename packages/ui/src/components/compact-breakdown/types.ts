/** VaCompactBreakdown 的类型定义 */

export interface CompactSegment {
  label: string;
  value: number;
  /** CSS 色；缺省按序取内置色板 */
  color?: string;
}

export interface CompactBreakdownProps {
  segments: CompactSegment[];
  /** 总量分母；缺省求和 */
  total?: number;
  /** 堆叠条高度 px（默认 8） */
  height?: number;
  /** 显示下方内联图例（默认 true） */
  legend?: boolean;
}
