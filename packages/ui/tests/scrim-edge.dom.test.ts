// @vitest-environment happy-dom
/**
 * VaScrimEdge dom 测试（TASK-109）：四向修饰类、厚度/颜色/stops 变量绑定、
 * aria-hidden 纯装饰、CSS 四向渐变与 absolute 定位静态断言。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VaScrimEdge from "../src/components/scrim-edge/VaScrimEdge.vue";

// happy-dom 环境的全局 URL 实现会劫持 new URL 相对解析（fs 拒绝非 file 协议），
// 统一走 fileURLToPath + path.resolve（对齐 agent-renderer.dom.test.ts 口径）
const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(here, "../src/components/scrim-edge/VaScrimEdge.css"), "utf8");

describe("VaScrimEdge（dom 挂载）", () => {
  it("默认 bottom：方向类 + 厚度/颜色/stops 变量（颜色缺省 --va-scrim）+ aria-hidden", () => {
    const w = mount(VaScrimEdge);
    expect(w.classes()).toEqual(["va-scrim-edge", "va-scrim-edge--bottom"]);
    expect(w.attributes("aria-hidden")).toBe("true");
    const style = w.attributes("style") ?? "";
    expect(style).toContain("--va-scrim-edge-h: 72px");
    expect(style).toContain("--va-scrim-edge-c: var(--va-scrim, rgba(26, 25, 23, 0.45))");
    expect(style).toContain("--va-scrim-edge-from: 0%");
    expect(style).toContain("--va-scrim-edge-to: 100%");
  });

  it("direction 四向分支挂对应修饰类", () => {
    for (const direction of ["top", "left", "right"] as const) {
      const w = mount(VaScrimEdge, { props: { direction } });
      expect(w.classes()).toContain(`va-scrim-edge--${direction}`);
    }
  });

  it("height / stops / scrimColor 覆盖绑定", () => {
    const w = mount(VaScrimEdge, { props: { height: 120, stops: [10, 90], scrimColor: "#000000" } });
    const style = w.attributes("style") ?? "";
    expect(style).toContain("--va-scrim-edge-h: 120px");
    expect(style).toContain("--va-scrim-edge-from: 10%");
    expect(style).toContain("--va-scrim-edge-to: 90%");
    expect(style).toContain("--va-scrim-edge-c: #000000");
  });
});

describe("VaScrimEdge.css 静态断言", () => {
  it("四向修饰类各带正确渐变轴向", () => {
    expect(css).toMatch(/\.va-scrim-edge--bottom\s*\{[^}]*linear-gradient\(to top,/);
    expect(css).toMatch(/\.va-scrim-edge--top\s*\{[^}]*linear-gradient\(to bottom,/);
    expect(css).toMatch(/\.va-scrim-edge--left\s*\{[^}]*linear-gradient\(to right,/);
    expect(css).toMatch(/\.va-scrim-edge--right\s*\{[^}]*linear-gradient\(to left,/);
  });

  it("绝对定位覆盖层且不参与事件（bottom/top 撑宽，left/right 撑高）", () => {
    expect(css).toMatch(/\.va-scrim-edge\s*\{[^}]*position:\s*absolute[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.va-scrim-edge--bottom\s*\{[^}]*height:\s*var\(--va-scrim-edge-h/);
    expect(css).toMatch(/\.va-scrim-edge--left\s*\{[^}]*width:\s*var\(--va-scrim-edge-h/);
  });
});
