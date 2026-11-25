/**
 * useSpotlight 单元测试（TASK-105 静态光斑基建）：
 * spotPercent 纯几何（映射/钳制/零尺寸回退中心）、rAF 节流（同帧合并、取最新坐标）、
 * pointerenter 立即写、pointerleave 归中并取消在途帧、
 * hover: none / reduced-motion / disabled 分支短路、SSR 安全（无 window 不炸）。
 * 默认 vitest node 环境（无 window）即天然覆盖 SSR 路径。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { spotPercent, useSpotlight } from "../src/composables/useSpotlight";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 构造可断言的假元素 + 事件（getBoundingClientRect 由 rectOverride 驱动） */
function makeEl(rect: { left: number; top: number; width: number; height: number }) {
  const written: Record<string, string> = {};
  return {
    written,
    el: {
      getBoundingClientRect: () => rect,
      style: {
        setProperty: (name: string, value: string) => {
          written[name] = value;
        },
      },
    },
  };
}

/** stub window：matchMedia 按 matches 集合命中 + 可控 rAF（手动触发 flush） */
function stubWindow(opts: { hoverNone?: boolean; reduced?: boolean } = {}) {
  const rafCbs: Array<() => void> = [];
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: (query.includes("hover: none") && !!opts.hoverNone) ||
        (query.includes("prefers-reduced-motion") && !!opts.reduced),
    }),
    requestAnimationFrame: (cb: () => void) => {
      rafCbs.push(cb);
      return rafCbs.length; // id
    },
    cancelAnimationFrame: (id: number) => {
      delete rafCbs[id - 1];
    },
  });
  return {
    /** 手动触发全部在途帧（模拟下一帧；已 cancel 的槽位为洞，跳过） */
    flush: () => {
      const cbs = rafCbs.splice(0);
      for (const cb of cbs) if (typeof cb === "function") cb();
    },
    rafCbs,
  };
}

const RECT = { left: 100, top: 50, width: 200, height: 100 };

describe("spotPercent（纯几何）", () => {
  it("指针坐标映射为元素内百分比", () => {
    // 左上角 / 中心 / 右下角
    expect(spotPercent(100, 50, RECT)).toEqual({ x: 0, y: 0 });
    expect(spotPercent(200, 100, RECT)).toEqual({ x: 50, y: 50 });
    expect(spotPercent(300, 150, RECT)).toEqual({ x: 100, y: 100 });
  });

  it("越界钳制到 0..100（光斑不出元素）", () => {
    expect(spotPercent(0, 0, RECT)).toEqual({ x: 0, y: 0 });
    expect(spotPercent(500, 300, RECT)).toEqual({ x: 100, y: 100 });
    expect(spotPercent(90, 40, RECT)).toEqual({ x: 0, y: 0 });
  });

  it("零尺寸矩形回退中心 50（防御除零，未布局/happy-dom 口径）", () => {
    expect(spotPercent(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 50, y: 50 });
  });

  it("保留 1 位小数", () => {
    expect(spotPercent(101, 50, RECT)).toEqual({ x: 0.5, y: 0 });
  });
});

describe("useSpotlight", () => {
  it("pointermove 经 rAF 后写入 --va-spot-x/y（元素内百分比）", () => {
    const env = stubWindow();
    const { el, written } = makeEl(RECT);
    const spot = useSpotlight();
    expect(spot.enabled.value).toBe(true);

    spot.onPointerMove({ clientX: 200, clientY: 100, currentTarget: el } as MouseEvent);
    expect(written["--va-spot-x"]).toBeUndefined(); // 未到帧不写
    env.flush();
    expect(written["--va-spot-x"]).toBe("50%");
    expect(written["--va-spot-y"]).toBe("50%");
  });

  it("rAF 节流：同帧多次 move 只排一次帧，flush 取最新坐标", () => {
    const env = stubWindow();
    const { el, written } = makeEl(RECT);
    const spot = useSpotlight();

    spot.onPointerMove({ clientX: 100, clientY: 50, currentTarget: el } as MouseEvent);
    spot.onPointerMove({ clientX: 150, clientY: 75, currentTarget: el } as MouseEvent);
    spot.onPointerMove({ clientX: 300, clientY: 150, currentTarget: el } as MouseEvent);
    expect(env.rafCbs).toHaveLength(1); // 三次 move 只排一帧

    env.flush();
    expect(written["--va-spot-x"]).toBe("100%"); // 最新坐标
    expect(written["--va-spot-y"]).toBe("100%");

    // 下一帧无新 move：不重复排队
    spot.onPointerMove({ clientX: 100, clientY: 50, currentTarget: el } as MouseEvent);
    expect(env.rafCbs).toHaveLength(1);
    env.flush();
    expect(written["--va-spot-x"]).toBe("0%");
  });

  it("pointerenter 立即写变量（不排帧），避免沿用旧坐标闪一帧", () => {
    const env = stubWindow();
    const { el, written } = makeEl(RECT);
    const spot = useSpotlight();

    spot.onPointerEnter({ clientX: 120, clientY: 60, currentTarget: el } as MouseEvent);
    expect(written["--va-spot-x"]).toBe("10%");
    expect(env.rafCbs).toHaveLength(0);
  });

  it("pointerleave 归中 50% 并取消在途帧", () => {
    const env = stubWindow();
    const { el, written } = makeEl(RECT);
    const spot = useSpotlight();

    spot.onPointerMove({ clientX: 300, clientY: 150, currentTarget: el } as MouseEvent);
    expect(env.rafCbs).toHaveLength(1);
    spot.onPointerLeave({ currentTarget: el } as MouseEvent);
    env.flush(); // 在途帧已被取消，flush 无效果
    expect(written["--va-spot-x"]).toBe("50%");
    expect(written["--va-spot-y"]).toBe("50%");
  });

  it("hover: none（触屏）：enabled=false，handler 短路不写变量不排帧", () => {
    const env = stubWindow({ hoverNone: true });
    const { el, written } = makeEl(RECT);
    const spot = useSpotlight();
    expect(spot.enabled.value).toBe(false);

    spot.onPointerMove({ clientX: 200, clientY: 100, currentTarget: el } as MouseEvent);
    spot.onPointerEnter({ clientX: 200, clientY: 100, currentTarget: el } as MouseEvent);
    spot.onPointerLeave({ currentTarget: el } as MouseEvent);
    env.flush();
    expect(written).toEqual({});
    expect(env.rafCbs).toHaveLength(0);
  });

  it("reduced-motion：enabled=false（装饰性光斑不启用）", () => {
    stubWindow({ reduced: true });
    const spot = useSpotlight();
    expect(spot.enabled.value).toBe(false);
  });

  it("disabled 选项：显式关闭", () => {
    stubWindow();
    const spot = useSpotlight({ disabled: true });
    expect(spot.enabled.value).toBe(false);
  });

  it("matchMedia 缺失的环境按启用处理（守卫不炸）", () => {
    vi.stubGlobal("window", { requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
    const spot = useSpotlight();
    expect(spot.enabled.value).toBe(true);
  });

  it("SSR 安全：无 window 时 enabled=false，handler 不炸", () => {
    vi.stubGlobal("window", undefined);
    const spot = useSpotlight();
    expect(spot.enabled.value).toBe(false);
    expect(() =>
      spot.onPointerMove({ clientX: 1, clientY: 1, currentTarget: makeEl(RECT).el } as MouseEvent),
    ).not.toThrow();
  });
});
