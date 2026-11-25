/**
 * motion.css 静态断言（TASK-102 动效基建）：读文件字符串断言——
 * 进出场/交叉淡入工具类存在、keyframes 定义与类引用一致、
 * var() 全带字面 fallback（单文件拷贝分发口径）、
 * reduced-motion 媒体块存在且降级为纯 opacity（位移/缩放清零）。
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(new URL("../src/styles/motion.css", import.meta.url), "utf8");

describe("motion.css 静态断言", () => {
  it("进出场/交叉淡入/空态渐入工具类存在", () => {
    for (const cls of [
      "va-enter-up",
      "va-enter-left",
      "va-enter-scale",
      "va-exit-up",
      "va-exit-left",
      "va-exit-scale",
      "va-crossfade",
      "va-fade-in",
    ]) {
      expect(css, `缺少 .${cls}`).toMatch(new RegExp(`\\.${cls}\\s*\\{`));
    }
  });

  it("keyframes 全部定义且类引用的动画名一一对应", () => {
    for (const kf of [
      "va-motion-in-up",
      "va-motion-in-left",
      "va-motion-in-scale",
      "va-motion-out-up",
      "va-motion-out-left",
      "va-motion-out-scale",
      "va-motion-fade-in",
      "va-motion-fade-out",
    ]) {
      expect(css).toContain(`@keyframes ${kf}`);
    }
    // 工具类 animation 引用（animation shorthand；不含 animation-name 覆盖行）
    const referenced = [...css.matchAll(/animation:\s*(va-motion-[\w-]+)/g)].map((m) => m[1]);
    expect(referenced).toHaveLength(8);
    for (const name of referenced) expect(css).toContain(`@keyframes ${name}`);
  });

  it("var() 引用全部带字面 fallback（无裸引用）", () => {
    const bare = [...css.matchAll(/var\((--va-[\w-]+)\)/g)].map((m) => m[1]);
    expect(bare).toEqual([]);
  });

  it("工具类消费动效骨架令牌：in→dur-in/out-quart，out→dur-out/in-quad", () => {
    expect(css).toMatch(/\.va-enter-up\s*\{[^}]*--va-dur-in, 180ms[^}]*--va-ease-out-quart/);
    expect(css).toMatch(/\.va-exit-up\s*\{[^}]*--va-dur-out, 140ms[^}]*--va-ease-in-quad/);
  });

  it("reduced-motion 媒体块存在：进出场整体换成 fade，位移/缩放清零", () => {
    const idx = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx);
    for (const cls of ["va-enter-up", "va-enter-left", "va-enter-scale", "va-crossfade"]) {
      expect(block).toContain(`.${cls}`);
    }
    expect(block).toContain("animation-name: va-motion-fade-in");
    expect(block).toContain("animation-name: va-motion-fade-out");
    // 降级块内不出现新的位移/缩放声明（纯 opacity 口径；类名含 scale 属选择器正常现象）
    expect(block).not.toMatch(/transform\s*:/);
  });

  it(".va-fade-in 空态渐入：仅 opacity 弱化档（复用 va-motion-fade-in，--va-dur-2）", () => {
    expect(css).toMatch(/\.va-fade-in\s*\{[^}]*animation:\s*va-motion-fade-in[^}]*--va-dur-2, 200ms/);
    // 纯 opacity keyframes（降级终点形态，reduced-motion 无需额外换名）
    const kfStart = css.indexOf("@keyframes va-motion-fade-in");
    const kfEnd = css.indexOf("}", kfStart);
    const kf = css.slice(kfStart, kfEnd);
    expect(kf).not.toMatch(/transform/);
  });

  it(".va-spotlight 光斑基类：radial 光斑 + hover 点亮 + 双降级媒体块（TASK-105）", () => {
    expect(css).toMatch(/\.va-spotlight\s*\{/);
    expect(css).toMatch(/\.va-spotlight::after\s*\{[^}]*radial-gradient\(/);
    // 指针坐标变量带字面 fallback（50% 中心）
    expect(css).toMatch(/--va-spot-x, 50%\)/);
    expect(css).toMatch(/--va-spot-y, 50%\)/);
    expect(css).toMatch(/\.va-spotlight:hover::after\s*\{\s*opacity:\s*1/);
    // hover: none（触屏）与 reduced-motion 双降级：不绘制
    expect(css).toMatch(/@media \(hover: none\)[^@]*\.va-spotlight::after\s*\{\s*display:\s*none/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^@]*\.va-spotlight::after\s*\{\s*display:\s*none/);
  });

  it(".va-copy 复制反馈结构：120ms 交叉 + done 态 ease-spring 微弹 + reduced-motion 瞬时（TASK-106）", () => {
    expect(css).toMatch(/\.va-copy\s*\{\s*display:\s*inline-grid/);
    // 交叉时长统一 --va-dur-1（120ms）
    expect(css).toMatch(/\.va-copy__idle,\s*\n\s*\.va-copy__done\s*\{[^}]*--va-dur-1, 120ms/);
    // 进入 done 态：transform 时序换 ease-spring（微弹），opacity 仍 ease
    expect(css).toMatch(/\.va-copy--done \.va-copy__done\s*\{[^}]*--va-ease-spring/);
    // reduced-motion：交叉瞬时完成
    const blocks = css.split("@media (prefers-reduced-motion: reduce)").slice(1);
    expect(blocks.some((b) => b.includes(".va-copy__idle") && b.includes("transition: none"))).toBe(true);
  });
});
