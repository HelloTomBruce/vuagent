/**
 * css-tokens-lib（tokens 门禁共享解析库）单元测试
 * 覆盖 TASK-006 评审修复的解析器边界行为：归一化、注释剥离与行号映射、
 * 亮暗解析（头注释含 dark 字样不污染）、同名令牌取后值、嵌套 var 链、
 * 未配对括号不中断扫描（R4 回归守卫）、L2 裸引用识别、.vue style 块提取、
 * @keyframes 花括号配对与跨文件一致性原材料。
 */
import { describe, expect, it } from "vitest";
import {
  extractKeyframes,
  extractStyleBlocks,
  extractVarRefs,
  findBareL2Refs,
  isL2Token,
  lineAtRaw,
  normalize,
  parseTokens,
  stripComments,
} from "../../scripts/lib/css-tokens-lib.mjs";

describe("normalize", () => {
  it("空白/大小写归一", () => {
    expect(normalize("RGBA( 26, 25, 23, 0.12 )")).toBe("rgba(26,25,23,0.12)");
  });

  it("#abc 三位简写等价展开为 #aabbcc", () => {
    expect(normalize("#abc")).toBe(normalize("#aabbcc"));
  });

  it("前导零补齐：.5 与 0.5 等价（含括号/冒号/逗号前）", () => {
    expect(normalize("rgba(1,2,.5)")).toBe(normalize("rgba(1,2,0.5)"));
    expect(normalize("translateY(-.5px)")).toBe(normalize("translateY(-0.5px)"));
  });

  it("负号前导零同样归一（N2 回归：-.5 不再误报漂移）", () => {
    expect(normalize("-.5px")).toBe(normalize("-0.5px"));
  });
});

describe("stripComments", () => {
  it("剥离注释且保留词法分隔；映射回原始行号（注释内换行随注释折叠）", () => {
    const css = '/* 头部说明\ndark 字样不应污染 */\n:root { --va-a: 1; }';
    const { text, map } = stripComments(css);
    expect(text).not.toContain("不应污染");
    expect(text).toContain(":root");
    // :root 在原始文件第 3 行（注释跨 1-2 行，内部换行随注释一起折叠）
    const idx = text.indexOf(":root");
    expect(lineAtRaw(css, map, idx)).toBe(3);
  });
});

describe("parseTokens", () => {
  it("亮色 :root 与暗色块分组；头注释含 dark 不污染选择器判定", () => {
    const css = `
      /* 说明文字里出现 dark 这个词，甚至单独一行 dark */
      :root { --va-accent: #c2410c; }
      [data-theme="dark"], .dark { --va-accent: #e8925e; }
    `;
    const { light, dark } = parseTokens(css);
    expect(light["--va-accent"]).toBe("#c2410c");
    expect(dark["--va-accent"]).toBe("#e8925e");
  });

  it("同一令牌重复定义取后值（与 CSS 级联一致）", () => {
    const css = ":root { --va-a: 1px; --va-a: 2px; }";
    expect(parseTokens(css).light["--va-a"]).toBe("2px");
  });
});

describe("extractVarRefs", () => {
  it("嵌套 var 链：内外层各自命中，fallback 正确切分", () => {
    const { refs } = extractVarRefs("color: var(--va-x, var(--va-y, #fff));");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ name: "--va-x", fallback: "var(--va-y, #fff)" });
    expect(refs[1]).toMatchObject({ name: "--va-y", fallback: "#fff" });
  });

  it("未配对括号只跳过该引用，不中断后续扫描（R4 回归守卫）", () => {
    const css = "/* 注释残句 var(--va-typo, */ a { font-size: var(--va-fs-md, 13px); }";
    const { refs, unmatched } = extractVarRefs(css);
    expect(unmatched).toHaveLength(1);
    expect(refs.map((r) => r.name)).toContain("--va-fs-md");
  });
});

describe("findBareL2Refs / isL2Token", () => {
  it("L2 裸引用命中并给出正确行号；带 fallback 与 L1 裸引用不误报", () => {
    const css = `:root {\n  color: var(--va-accent);\n  font-size: var(--va-fs-md);\n  gap: var(--va-s3h);\n  padding: var(--va-fs-sm, 12px);\n}`;
    const bare = findBareL2Refs(css);
    expect(bare.map((b) => b.name)).toEqual(["--va-fs-md", "--va-s3h"]);
    expect(bare[0].line).toBe(3);
    expect(bare[1].line).toBe(4);
  });

  it("L2 家族判定：语义档位族全部命中", () => {
    for (const name of [
      "--va-fs-md", "--va-lh-tight", "--va-fw-bold", "--va-tracking-wide",
      "--va-h-sm", "--va-icon-md", "--va-z-toast", "--va-dur-loop",
      "--va-dist-m", "--va-ease", "--va-ease-out-quart", "--va-skel-bg",
      "--va-s3h", "--va-s4h", "--va-scrim", "--va-accent-contrast",
    ]) {
      expect(isL2Token(name)).toBe(true);
    }
  });

  it("L1/L3 令牌不属 L2 门禁（存量裸引用为登记债务，非本门禁范围）", () => {
    for (const name of ["--va-accent", "--va-bg", "--va-edge", "--va-s3", "--va-s4", "--va-radius-m", "--va-shadow-1", "--va-font", "--va-btn-ink"]) {
      expect(isL2Token(name)).toBe(false);
    }
  });

  it("注释里的裸引用不误报（扫描前剥注释）", () => {
    const css = "/* 示例：var(--va-fs-md) */ a { color: var(--va-ink); }";
    expect(findBareL2Refs(css)).toHaveLength(0);
  });
});

describe("extractStyleBlocks", () => {
  it("提取块内容与起始行号；无 style 块返回空", () => {
    const vue = `<template><div/></template>\n\n<style>\n.a {\n  color: red;\n}\n</style>\n<style scoped>\n.b {}\n</style>\n`;
    const blocks = extractStyleBlocks(vue);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].css).toContain(".a");
    expect(blocks[0].startLine).toBe(3);
    expect(blocks[1].startLine).toBe(8);
    expect(extractStyleBlocks("<template/>")).toEqual([]);
  });
});

describe("extractKeyframes", () => {
  it("花括号配对解析嵌套帧块；同名定义取后值；仅空白差异归一相等", () => {
    const css = `
      @keyframes va-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes va-spin { to { transform: rotate(360deg); } }
    `;
    const kf = extractKeyframes(css);
    expect(kf["va-spin"]).toBe(normalize(" to { transform: rotate(360deg); } "));
  });
});
