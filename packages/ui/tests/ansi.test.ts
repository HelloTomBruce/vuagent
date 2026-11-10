import { describe, expect, it } from "vitest";
import { parseAnsi, parseAnsiLine } from "../src/utils/ansi";

const ESC = "\u001b";

describe("parseAnsiLine", () => {
  it("纯文本 → 单 span 无样式", () => {
    expect(parseAnsiLine("hello")).toEqual([{ text: "hello" }]);
  });

  it("基础前景色 + reset", () => {
    const spans = parseAnsiLine(`${ESC}[31merr${ESC}[0m ok`);
    expect(spans).toEqual([
      { text: "err", color: "#e06c75" },
      { text: " ok" },
    ]);
  });

  it("加粗/下划线等样式", () => {
    const spans = parseAnsiLine(`${ESC}[1m${ESC}[4mbold underline${ESC}[22m${ESC}[24mplain`);
    expect(spans[0]).toMatchObject({ text: "bold underline", bold: true, underline: true });
    expect(spans[1]).toEqual({ text: "plain" });
  });

  it("亮色 90-97 与背景 100-107", () => {
    const spans = parseAnsiLine(`${ESC}[92mgreen${ESC}[0m`);
    expect(spans[0]!.color).toBe("#98c379");
    const bg = parseAnsiLine(`${ESC}[101mred-bg`);
    expect(bg[0]!.bgColor).toBe("#e06c75");
  });

  it("256 色与真彩色", () => {
    expect(parseAnsiLine(`${ESC}[38;5;196mx`)[0]!.color).toBe("rgb(255, 0, 0)");
    expect(parseAnsiLine(`${ESC}[38;2;10;20;30mx`)[0]!.color).toBe("rgb(10, 20, 30)");
  });

  it("复合序列一次下发多个属性", () => {
    const spans = parseAnsiLine(`${ESC}[1;33mwarn`);
    expect(spans[0]).toMatchObject({ text: "warn", bold: true, color: "#e5c07b" });
  });

  it("非 SGR 的 CSI 与 OSC 剥除", () => {
    expect(parseAnsiLine(`${ESC}[2K${ESC}[1Gclean${ESC}]0;title\x07`)).toEqual([{ text: "clean" }]);
  });

  it("\\r 重写取最终帧（进度条）", () => {
    const spans = parseAnsiLine(`  0%${ESC}[K\r${ESC}[32m100% done`);
    expect(spans[0]).toMatchObject({ text: "100% done", color: "#98c379" });
  });

  it("空 SGR（ lone ESC[m ）视作 reset", () => {
    expect(parseAnsiLine(`${ESC}[31mred${ESC}[mok`)).toEqual([
      { text: "red", color: "#e06c75" },
      { text: "ok" },
    ]);
  });
});

describe("parseAnsi", () => {
  it("多行拆行独立解析", () => {
    const lines = parseAnsi(`${ESC}[32mok\nerr`);
    expect(lines).toHaveLength(2);
    expect(lines[0]![0]!.color).toBe("#98c379");
    expect(lines[1]).toEqual([{ text: "err" }]);
  });
});
