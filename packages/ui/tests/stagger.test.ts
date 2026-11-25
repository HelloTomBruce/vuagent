/**
 * useStagger 单元测试（TASK-102 动效基建）：
 * 契约口径：delayStyle 返回 animation-delay（.va-enter-* 全是 CSS animation，
 * transition-delay 对 animation 零作用——错轴修复后的正确契约）。
 * 覆盖：delay 按 index 递增、自定义步长、maxItems 档顶钳制、disabled/负数归零、
 * reduced-motion 分支（mock matchMedia）、SSR 安全（无 window 不炸，按非
 * reduced 分支返回）。默认 vitest node 环境（无 window）即天然覆盖 SSR 路径。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStagger } from "../src/composables/useStagger";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStagger", () => {
  it("delay 按 index 递增：i * 40ms，index 0 为 0ms（animation-delay 轴）", () => {
    const { delayStyle } = useStagger();
    expect(delayStyle(0)).toEqual({ "animation-delay": "0ms" });
    expect(delayStyle(1)).toEqual({ "animation-delay": "40ms" });
    expect(delayStyle(3)).toEqual({ "animation-delay": "120ms" });
  });

  it("自定义步长 stepMs", () => {
    const { delayStyle } = useStagger({ stepMs: 20 });
    expect(delayStyle(2)).toEqual({ "animation-delay": "40ms" });
  });

  it("maxItems 钳制：超出档位上限后延迟不再增长", () => {
    const { delayStyle } = useStagger({ stepMs: 10, maxItems: 4 });
    expect(delayStyle(3)).toEqual({ "animation-delay": "30ms" });
    expect(delayStyle(4)).toEqual({ "animation-delay": "40ms" });
    expect(delayStyle(100)).toEqual({ "animation-delay": "40ms" });
  });

  it("负数 index 钳到 0（防御性）", () => {
    const { delayStyle } = useStagger();
    expect(delayStyle(-3)).toEqual({ "animation-delay": "0ms" });
  });

  it("disabled 恒返回 0ms（宿主自行关闭错峰）", () => {
    const { delayStyle } = useStagger({ disabled: true });
    expect(delayStyle(5)).toEqual({ "animation-delay": "0ms" });
  });

  it("reduced-motion：matchMedia 命中时返回空错峰 style（0ms 延迟）", () => {
    // 契约为「延迟归零」而非空对象 {}：SSR（无 window）按正常分支输出
    // animation-delay:0ms，reduced 客户端若返回 {} 会产生 style 属性
    // hydration 差异——归零保两端首帧一致（见 useStagger.ts 头注释）。
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({ matches: query.includes("prefers-reduced-motion") }),
    });
    const { delayStyle } = useStagger();
    expect(delayStyle(0)).toEqual({ "animation-delay": "0ms" });
    expect(delayStyle(2)).toEqual({ "animation-delay": "0ms" });
  });

  it("无 matchMedia 的环境按非 reduced 分支返回（守卫不炸）", () => {
    vi.stubGlobal("window", {});
    const { delayStyle } = useStagger();
    expect(delayStyle(1)).toEqual({ "animation-delay": "40ms" });
  });

  it("SSR 安全：无 window 时不炸，服务端按非 reduced 分支返回（首帧输出与客户端一致）", () => {
    vi.stubGlobal("window", undefined);
    const { delayStyle } = useStagger();
    expect(delayStyle(1)).toEqual({ "animation-delay": "40ms" });
  });
});
