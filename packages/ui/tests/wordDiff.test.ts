import { describe, expect, it } from "vitest";
import { buildDiffUnits, diffResult, formatMs, formatTokens, tokenize } from "../src/utils/index";

describe("tokenize", () => {
  it("拉丁词、CJK 逐字、空格标记", () => {
    const toks = tokenize("Hello 世界 ok");
    expect(toks.map((t) => t.t)).toEqual(["Hello", "世", "界", "ok"]);
    expect(toks[0]!.sp).toBe(false);
    expect(toks[1]!.sp).toBe(true);
    expect(toks[2]!.sp).toBe(false); // CJK 之间无空格
    expect(toks[3]!.sp).toBe(true);
  });
});

describe("buildDiffUnits", () => {
  it("完全相同 → 单个静态片段", () => {
    const units = buildDiffUnits("Hello world", "Hello world");
    expect(units).toEqual([{ same: "Hello world" }]);
  });

  it("纯插入", () => {
    const units = buildDiffUnits("Hello world", "Hello brave world");
    expect(units).toEqual([{ same: "Hello" }, { add: " brave" }, { same: " world" }]);
  });

  it("纯删除", () => {
    const units = buildDiffUnits("Hello brave world", "Hello world");
    expect(units).toEqual([{ same: "Hello" }, { del: " brave" }, { same: " world" }]);
  });

  it("替换 → del+add 合并为一个单元", () => {
    const units = buildDiffUnits("使用 React 渲染", "使用 Vue 渲染");
    const change = units.find((u) => u.del !== undefined);
    expect(change).toEqual({ del: " React", add: " Vue" });
  });

  it("中文插入无多余空格", () => {
    const units = buildDiffUnits("你好世界", "你好新世界");
    expect(units).toEqual([{ same: "你好" }, { add: "新" }, { same: "世界" }]);
  });
});

describe("diffResult", () => {
  const units = buildDiffUnits("使用 React 渲染", "使用 Vue 渲染");
  const idx = units.findIndex((u) => u.del !== undefined);

  it("接受 → 新稿", () => {
    expect(diffResult(units, { [idx]: true })).toBe("使用 Vue 渲染");
  });
  it("拒绝 → 原文", () => {
    expect(diffResult(units, { [idx]: false })).toBe("使用 React 渲染");
  });
  it("未决不算数", () => {
    expect(diffResult(units, {})).toBe("使用渲染");
  });
});

describe("format 工具", () => {
  it("formatMs", () => {
    expect(formatMs(830)).toBe("830ms");
    expect(formatMs(1420)).toBe("1.4s");
    expect(formatMs(65_000)).toBe("1m 05s");
  });
  it("formatTokens", () => {
    expect(formatTokens(980)).toBe("980");
    expect(formatTokens(12_400)).toBe("12.4K");
    expect(formatTokens(1_240_000)).toBe("1.2M");
  });
});
