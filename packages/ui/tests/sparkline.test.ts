import { describe, expect, it } from "vitest";
import { sparkline } from "../src/utils/sparkline";

describe("sparkline", () => {
  it("多点：归一化 + 平滑路径 + 面积闭合", () => {
    const g = sparkline([0, 5, 10, 5], 100, 40);
    expect(g.min).toBe(0);
    expect(g.max).toBe(10);
    expect(g.points).toHaveLength(4);
    // 首点在最左、值最大点贴顶（pad=2）
    expect(g.points[0]![0]).toBe(0);
    expect(g.points[2]![1]).toBe(2);
    // 面积 = 折线 + 底边闭合
    expect(g.area.startsWith(g.line)).toBe(true);
    expect(g.area.endsWith("Z")).toBe(true);
  });

  it("平滑（≥3 点）用 Q，直线模式（smooth:false）用 M/L", () => {
    expect(sparkline([1, 2, 3], 100, 40).line).toContain("Q");
    expect(sparkline([1, 2, 3], 100, 40, { smooth: false }).line).not.toContain("Q");
  });

  it("单点画中线（min==max 保护）", () => {
    const g = sparkline([7], 100, 40);
    expect(g.points).toEqual([[50, 20]]);
    expect(g.line).toContain("50");
  });

  it("全相同序列不产生 0 除", () => {
    const g = sparkline([3, 3, 3], 100, 40);
    expect(g.points.every(([, y]) => y === 20)).toBe(true);
  });

  it("空序列返回空几何", () => {
    expect(sparkline([], 100, 40)).toMatchObject({ line: "", area: "", points: [] });
  });
});
