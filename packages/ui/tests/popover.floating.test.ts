/**
 * useFloating 纯函数单测：placement 解析 / 坐标计算 / flip / shift / clamp / 端到端管线。
 * 全部无 DOM 依赖，直接喂矩形与视口。
 */
import { describe, expect, it } from "vitest";
import {
  clamp,
  computeCoords,
  computeFloating,
  flipPlacement,
  parsePlacement,
  shiftIntoView,
  VIEWPORT_PADDING,
  type Rect,
  type Viewport,
} from "../src/components/popover/useFloating";

const rect = (top: number, left: number, right: number, bottom: number): Rect => ({
  top,
  left,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
});

/** 锚点：top=100 left=50 right=150 bottom=120（100×20） */
const ANCHOR = rect(100, 50, 150, 120);
const FLOAT = { width: 80, height: 30 };
const VIEW: Viewport = { width: 400, height: 300 };

describe("clamp", () => {
  it("区间内原样返回，越界夹到端点", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(13, 0, 10)).toBe(10);
  });
  it("min > max 时退化为 min（浮层比视口大的极端场景）", () => {
    expect(clamp(50, 8, -10)).toBe(8);
  });
});

describe("parsePlacement", () => {
  it("解析 side 与 align；无对齐后缀时 align=center", () => {
    expect(parsePlacement("bottom-start")).toEqual({ side: "bottom", align: "start" });
    expect(parsePlacement("top-end")).toEqual({ side: "top", align: "end" });
    expect(parsePlacement("bottom")).toEqual({ side: "bottom", align: "center" });
    expect(parsePlacement("right")).toEqual({ side: "right", align: "center" });
    expect(parsePlacement("left")).toEqual({ side: "left", align: "center" });
  });
});

describe("computeCoords", () => {
  it("bottom-start：左对齐锚点左边，顶部贴锚点底部 + offset", () => {
    expect(computeCoords("bottom", "start", ANCHOR, FLOAT, 6)).toEqual({ x: 50, y: 126 });
  });
  it("bottom（center）：水平居中锚点", () => {
    expect(computeCoords("bottom", "center", ANCHOR, FLOAT, 6)).toEqual({ x: 60, y: 126 });
  });
  it("bottom-end：右对齐锚点右边", () => {
    expect(computeCoords("bottom", "end", ANCHOR, FLOAT, 6)).toEqual({ x: 70, y: 126 });
  });
  it("top-start：底部贴锚点顶部 - offset", () => {
    expect(computeCoords("top", "start", ANCHOR, FLOAT, 6)).toEqual({ x: 50, y: 64 });
  });
  it("right：左缘贴锚点右缘 + offset，垂直居中", () => {
    expect(computeCoords("right", "center", ANCHOR, FLOAT, 6)).toEqual({ x: 156, y: 95 });
  });
  it("left：右缘贴锚点左缘 - offset，垂直居中", () => {
    expect(computeCoords("left", "center", ANCHOR, FLOAT, 6)).toEqual({ x: -36, y: 95 });
  });
});

describe("flipPlacement", () => {
  it("bottom 空间不足且上方更宽敞 → 翻成 top（对齐保留）", () => {
    // 视口高 160：锚点下方仅剩 160-120-8=32 < 30+6=36；上方 100-8=92 充足
    expect(flipPlacement("bottom-start", ANCHOR, FLOAT, { width: 400, height: 160 }, 6, 8)).toBe("top-start");
  });
  it("bottom 空间充足 → 不翻转", () => {
    expect(flipPlacement("bottom-start", ANCHOR, FLOAT, VIEW, 6, 8)).toBe("bottom-start");
  });
  it("top 空间不足且下方更宽敞 → 翻成 bottom", () => {
    // 锚点上移到 top=20：上方 20-8=12 < 36；下方充足
    expect(flipPlacement("top-end", rect(20, 50, 150, 40), FLOAT, VIEW, 6, 8)).toBe("bottom-end");
  });
  it("两侧都放不下时保持原方位（交给 shift 夹取）", () => {
    // 视口高 130、浮层高 120：need=126，上方 22、下方 72 均放不下 → 不翻转
    const tiny: Viewport = { width: 400, height: 130 };
    expect(flipPlacement("top", rect(30, 50, 150, 50), { width: 80, height: 120 }, tiny, 6, 8)).toBe("top");
    expect(flipPlacement("bottom", rect(60, 50, 150, 80), { width: 80, height: 120 }, tiny, 6, 8)).toBe("bottom");
  });
  it("right / left 永不翻转（v1 承诺范围）", () => {
    const squeezed = rect(100, 380, 390, 120); // 锚点贴右边缘
    expect(flipPlacement("right", squeezed, FLOAT, VIEW, 6, 8)).toBe("right");
    expect(flipPlacement("left", rect(100, 10, 20, 120), FLOAT, VIEW, 6, 8)).toBe("left");
  });
});

describe("shiftIntoView", () => {
  it("左/上越界夹到 padding，右/下越界夹到 viewport-size-padding", () => {
    expect(shiftIntoView(-50, -20, FLOAT, VIEW, 8)).toEqual({ x: 8, y: 8 });
    expect(shiftIntoView(390, 290, FLOAT, VIEW, 8)).toEqual({ x: 312, y: 262 });
  });
  it("未越界原样返回", () => {
    expect(shiftIntoView(50, 126, FLOAT, VIEW, 8)).toEqual({ x: 50, y: 126 });
  });
});

describe("computeFloating 端到端", () => {
  it("常规 bottom-start：坐标 + 原方位 + 无 minWidth", () => {
    const r = computeFloating({ anchorRect: ANCHOR, floatingSize: FLOAT, placement: "bottom-start", viewport: VIEW });
    expect(r).toEqual({ x: 50, y: 126, placement: "bottom-start", minWidth: undefined });
  });
  it("下方放不下 → flip 到 top 且 y 贴锚点上方", () => {
    const r = computeFloating({
      anchorRect: ANCHOR,
      floatingSize: FLOAT,
      placement: "bottom",
      viewport: { width: 400, height: 160 },
    });
    expect(r.placement).toBe("top");
    expect(r.y).toBe(64); // 100 - 30 - 6
  });
  it("水平越界 → shift 保留 8px 视口边距", () => {
    // 锚点贴左边缘：bottom-start 的 x = 2，未越界；用 end 对齐使 x = 30-80 = -50 → 夹到 8
    const r = computeFloating({
      anchorRect: rect(100, 2, 30, 120),
      floatingSize: FLOAT,
      placement: "bottom-end",
      viewport: VIEW,
    });
    expect(r.x).toBe(VIEWPORT_PADDING);
  });
  it("matchAnchorWidth：minWidth = 锚点宽度", () => {
    const r = computeFloating({
      anchorRect: ANCHOR,
      floatingSize: FLOAT,
      placement: "bottom-start",
      viewport: VIEW,
      matchAnchorWidth: true,
    });
    expect(r.minWidth).toBe(100);
  });
  it("自定义 offset 生效", () => {
    const r = computeFloating({
      anchorRect: ANCHOR,
      floatingSize: FLOAT,
      placement: "bottom-start",
      viewport: VIEW,
      offset: 12,
    });
    expect(r.y).toBe(132);
  });
});
