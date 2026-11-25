// @vitest-environment happy-dom
/**
 * VaGradientBorder dom 测试（TASK-109）：static/running 变体类、from/to/width/speed
 * 变量绑定（数字 ms 归一）、slot 渲染；running 光环 keyframes 命名
 * （va-<组件>-<动作>）与 reduced-motion 静止分支的 CSS 静态断言。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VaGradientBorder from "../src/components/gradient-border/VaGradientBorder.vue";

// happy-dom 环境的全局 URL 实现会劫持 new URL 相对解析（fs 拒绝非 file 协议），
// 统一走 fileURLToPath + path.resolve（对齐 agent-renderer.dom.test.ts 口径）
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(here, "../src/components/gradient-border/VaGradientBorder.css"), "utf8");

describe("VaGradientBorder（dom 挂载）", () => {
  it("默认 static：变体类 + 边宽/端点色缺省（accent 渐变 token），slot 渲染", () => {
    const w = mount(VaGradientBorder, { slots: { default: "<span>运行日志</span>" } });
    expect(w.classes()).toEqual(["va-gborder", "va-gborder--static"]);
    expect(w.text()).toContain("运行日志");
    const style = w.attributes("style") ?? "";
    expect(style).toContain("--va-gb-w: 1px");
    expect(style).toContain("--va-gb-from: var(--va-grad-accent-from, #c2410c)");
    expect(style).toContain("--va-gb-to: var(--va-grad-accent-to, #2563eb)");
    expect(style).not.toContain("--va-gb-speed");
  });

  it("running：变体类；speed 字符串原样、数字归一为 ms", () => {
    const sec = mount(VaGradientBorder, { props: { variant: "running", speed: "2.4s" } });
    expect(sec.classes()).toContain("va-gborder--running");
    expect(sec.attributes("style")).toContain("--va-gb-speed: 2.4s");

    const ms = mount(VaGradientBorder, { props: { variant: "running", speed: 2200 } });
    expect(ms.attributes("style")).toContain("--va-gb-speed: 2200ms");
  });

  it("width / from / to 覆盖绑定", () => {
    const w = mount(VaGradientBorder, { props: { width: 2, from: "#111111", to: "#eeeeee" } });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("--va-gb-w: 2px");
    expect(style).toContain("--va-gb-from: #111111");
    expect(style).toContain("--va-gb-to: #eeeeee");
  });
});

describe("VaGradientBorder.css 静态断言", () => {
  it("static 双背景手法（padding-box 内容面 + border-box 渐变面）", () => {
    expect(css).toMatch(
      /\.va-gborder--static\s*\{[^}]*padding-box,[^}]*linear-gradient\([^}]*border-box;/,
    );
  });

  it("running：conic 光环 + @property 注册角度 + keyframes 命名 va-gradient-border-spin", () => {
    expect(css).toMatch(/\.va-gborder--running\s*\{[^}]*conic-gradient\(from var\(--va-gb-spin/);
    expect(css).toContain("@property --va-gb-spin");
    // 命名约定 va-<组件>-<动作>
    expect(css).toContain("@keyframes va-gradient-border-spin");
    expect(css).toMatch(/animation:\s*va-gradient-border-spin[^;]*--va-dur-loop, 1\.8s/);
    expect(css).toMatch(/@keyframes va-gradient-border-spin\s*\{[^}]*--va-gb-spin:\s*360deg/);
  });

  it("reduced-motion：光环静止（animation: none → 停在静态 conic 渐变）", () => {
    const idx = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx);
    expect(block).toMatch(/\.va-gborder--running\s*\{\s*animation:\s*none/);
  });
});
