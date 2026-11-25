/**
 * surface.css（.va-glass / .va-noise，TASK-110）静态断言：
 * glass 的 @supports not (backdrop-filter) 纯色 scrim 降级分支存在（happy-dom
 * 无 backdrop-filter 口径即走该分支）、blur 档位消费、噪点 data-URI 体积 <2KB、
 * dark 减淡分支、tokens.css 的 glass 表面对（亮暗两套）与工具类 fallback 一致。
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTokens, stripComments } from "../../scripts/lib/css-tokens-lib.mjs";

const raw = fs.readFileSync(new URL("../src/styles/surface.css", import.meta.url), "utf8");
// 剥注释后匹配（避免注释示例误命中）
const css = stripComments(raw).text;
const tokens = parseTokens(
  fs.readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8"),
);

/** 从 surface.css 提取噪点 data-URI（--va-noise-url fallback），测其字节体积 */
function noiseUrlBytes(): number {
  const m = raw.match(/--va-noise-url,\s*url\("data:image\/svg\+xml,([^"]+)"\)/);
  expect(m, "surface.css 应内联噪点 data-URI").toBeTruthy();
  return Buffer.byteLength(`data:image/svg+xml,${m![1]}`, "utf8");
}

describe(".va-glass（TASK-110）", () => {
  it("半透明玻璃面 + blur 档 3 + 描边与顶缘高光", () => {
    expect(css).toMatch(/\.va-glass\s*\{[^}]*--va-surface-glass, rgba\(255, 255, 255, 0\.68\)/);
    expect(css).toMatch(/\.va-glass\s*\{[^}]*backdrop-filter:\s*blur\(var\(--va-blur-3, 16px\)\)/);
    expect(css).toMatch(/\.va-glass\s*\{[^}]*box-shadow:\s*inset 0 1px 0 rgba\(255, 255, 255, 0\.25\)/);
  });

  it("@supports not (backdrop-filter) 降级为纯色 scrim（--va-surface-raised）", () => {
    const idx = css.indexOf("@supports not (backdrop-filter: blur(1px))");
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, css.indexOf("}", idx) + 1);
    expect(block).toMatch(/\.va-glass\s*\{[^}]*background:\s*var\(--va-surface-raised, #ffffff\)/);
    expect(block).toMatch(/backdrop-filter:\s*none/);
  });

  it("dark 减淡顶缘高光（双选择器口径对齐 tokens.css）", () => {
    expect(css).toMatch(/\[data-theme="dark"\] \.va-glass,\s*\n\.dark \.va-glass\s*\{[^}]*rgba\(255, 255, 255, 0\.08\)/);
  });

  it("tokens.css 定义 glass 表面对（亮暗两套，亮色 = stage-raised 半透明/同值）", () => {
    expect(tokens.light["--va-surface-glass"]).toBe("rgba(255, 255, 255, 0.68)");
    expect(tokens.light["--va-surface-raised"]).toBe("#ffffff");
    expect(tokens.dark["--va-surface-glass"]).toBe("rgba(28, 26, 23, 0.68)");
    expect(tokens.dark["--va-surface-raised"]).toBe("#1c1a17");
  });
});

describe(".va-noise（TASK-110）", () => {
  it("噪点 data-URI 内联且体积 < 2KB（记录值见测试输出）", () => {
    const bytes = noiseUrlBytes();
    expect(bytes).toBeLessThan(2048);
    // 灰度噪声：feTurbulence + saturate(0)（彩色噪声会显脏）
    expect(css).toContain("feTurbulence");
    expect(css).toContain("saturate");
    console.info(`[TASK-110] 噪点 data-URI 体积：${bytes} bytes（< 2KB 达标）`);
  });

  it("透明度阶梯钩子 --va-noise-o（默认 0.05）+ dark 减淡", () => {
    expect(css).toMatch(/\.va-noise\s*\{[^}]*opacity:\s*var\(--va-noise-o, 0\.05\)/);
    const idx = css.indexOf("[data-theme=\"dark\"] .va-noise");
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, css.indexOf("}", idx) + 1);
    expect(block).toContain("calc(var(--va-noise-o, 0.05) * 0.6)");
  });

  it("纯静态纹理：surface.css 无 animation/transition（与动效分频约定无冲突）", () => {
    expect(css).not.toMatch(/animation|transition/);
  });
});
