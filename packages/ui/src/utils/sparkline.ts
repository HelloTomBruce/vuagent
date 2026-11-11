/**
 * 零依赖 sparkline：数值序列 → SVG path（折线/平滑 + 面积闭合）。
 * 纯计算无 DOM，SSR 安全；供 KpiChart 等图表组件复用，也可独立使用。
 */

export interface SparklineGeometry {
  /** 折线 path（M/L 或平滑 Q） */
  line: string;
  /** 面积 path（line + 底边闭合） */
  area: string;
  /** 归一化后的坐标点（CSS px） */
  points: Array<[number, number]>;
  /** 数据的最小/最大值 */
  min: number;
  max: number;
}

export interface SparklineOptions {
  /** 中点二次贝塞尔平滑（默认 true；false 为直线段） */
  smooth?: boolean;
  /** 上下留白 px（默认 2，防止线贴边裁切） */
  pad?: number;
}

/** 数值序列 → SVG path 几何；空序列返回空 path */
export function sparkline(
  values: number[],
  width: number,
  height: number,
  opts: SparklineOptions = {},
): SparklineGeometry {
  const { smooth = true, pad = 2 } = opts;
  const n = values.length;

  if (n === 0) {
    return { line: "", area: "", points: [], min: 0, max: 0 };
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // 单点或全相同：画中线，避免 0 除
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const innerH = height - pad * 2;
  const x = (i: number) => (n === 1 ? width / 2 : (i / (n - 1)) * width);
  const y = (v: number) => pad + innerH - ((v - min) / (max - min)) * innerH;

  const points: Array<[number, number]> = values.map((v, i) => [x(i), y(v)]);

  let line: string;
  if (!smooth || n < 3) {
    line = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${r(px)},${r(py)}`).join(" ");
  } else {
    // 中点平滑：Q 控制点取相邻点，落在中点上，保证曲线过每个中点且不越界
    line = `M${r(points[0]![0])},${r(points[0]![1])}`;
    for (let i = 1; i < n - 1; i++) {
      const [cx, cy] = points[i]!;
      const [nx, ny] = points[i + 1]!;
      line += ` Q${r(cx)},${r(cy)} ${r((cx + nx) / 2)},${r((cy + ny) / 2)}`;
    }
    const [lx, ly] = points[n - 1]!;
    line += ` L${r(lx)},${r(ly)}`;
  }

  const area = points.length ? `${line} L${r(points[n - 1]![0])},${r(height)} L${r(points[0]![0])},${r(height)} Z` : "";

  return { line, area, points, min, max };
}

/** 两位小数取整（path 简短） */
function r(v: number): number {
  return Math.round(v * 100) / 100;
}
