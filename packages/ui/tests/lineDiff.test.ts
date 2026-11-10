import { describe, expect, it } from "vitest";
import { expandKey, groupHunks, lineDiff, pairInline, splitLines } from "../src/utils/lineDiff";

describe("splitLines", () => {
  it("结尾换行不产生多余空行", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });
  it("空文本为 0 行，中间空行保留", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\n\nb\n")).toEqual(["a", "", "b"]);
  });
  it("CRLF 归一", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

describe("lineDiff", () => {
  it("完全相同 → 全 same，双侧行号", () => {
    const rows = lineDiff("a\nb\nc", "a\nb\nc");
    expect(rows).toEqual([
      { type: "same", oldNo: 1, newNo: 1, text: "a" },
      { type: "same", oldNo: 2, newNo: 2, text: "b" },
      { type: "same", oldNo: 3, newNo: 3, text: "c" },
    ]);
  });

  it("修改一行 → del + add 且 add 紧随 del", () => {
    const rows = lineDiff("a\nb\nc", "a\nB\nc");
    expect(rows).toEqual([
      { type: "same", oldNo: 1, newNo: 1, text: "a" },
      { type: "del", oldNo: 2, text: "b" },
      { type: "add", newNo: 2, text: "B" },
      { type: "same", oldNo: 3, newNo: 3, text: "c" },
    ]);
  });

  it("纯新增 / 纯删除", () => {
    expect(lineDiff("a", "a\nx")).toEqual([
      { type: "same", oldNo: 1, newNo: 1, text: "a" },
      { type: "add", newNo: 2, text: "x" },
    ]);
    expect(lineDiff("a\nx", "a")).toEqual([
      { type: "same", oldNo: 1, newNo: 1, text: "a" },
      { type: "del", oldNo: 2, text: "x" },
    ]);
  });

  it("空 → 有内容 全 add；有内容 → 空 全 del", () => {
    expect(lineDiff("", "x")).toEqual([{ type: "add", newNo: 1, text: "x" }]);
    expect(lineDiff("x", "")).toEqual([{ type: "del", oldNo: 1, text: "x" }]);
  });
});

describe("pairInline", () => {
  it("配对的 del/add 得到词级片段，未配对行为 undefined", () => {
    const rows = lineDiff("hello world", "hello brave world");
    const inline = pairInline(rows);
    expect(inline).toHaveLength(rows.length);
    const pair = inline.find(Boolean)!;
    // del 侧：same(hello) + same(world)；add 侧：same(hello) + add(brave) + same(world)
    expect(pair.del).toEqual([
      { kind: "same", text: "hello" },
      { kind: "same", text: " world" },
    ]);
    expect(pair.add).toEqual([
      { kind: "same", text: "hello" },
      { kind: "add", text: " brave" },
      { kind: "same", text: " world" },
    ]);
  });

  it("del 数多于 add 数时只配对 min 对", () => {
    const rows = lineDiff("a\nb\nc", "x");
    const inline = pairInline(rows);
    const paired = inline.filter(Boolean);
    expect(paired).toHaveLength(1);
  });

  it("enabled=false 直接关闭", () => {
    const rows = lineDiff("a", "b");
    expect(pairInline(rows, false).every((x) => x === undefined)).toBe(true);
  });
});

describe("groupHunks", () => {
  const OLD = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  // 修改第 10 行
  const NEW = OLD.split("\n")
    .map((l, i) => (i === 9 ? "line 10 CHANGED" : l))
    .join("\n");

  it("远离变更的行折叠为 expand，变更 ±context 保留", () => {
    const render = groupHunks(lineDiff(OLD, NEW), 3);
    const kinds = render.map((r) => r.kind);
    // 结构：expand(6 行) + 8 行（7-9 same + del + add + 11-13 same）+ expand(7 行)
    expect(kinds).toEqual(["expand", ...Array(8).fill("row"), "expand"]);
    const first = render[0]!;
    const last = render[render.length - 1]!;
    expect(first).toMatchObject({ kind: "expand", count: 6, from: 1, to: 6 });
    expect(last).toMatchObject({ kind: "expand", count: 7, from: 14, to: 20 });
  });

  it("expanded 集合内的段展开为逐行", () => {
    const rows = lineDiff(OLD, NEW);
    const once = groupHunks(rows, 3);
    const first = once[0] as { kind: "expand"; count: number; from: number; to: number };
    const expanded = new Set([expandKey(first)]);
    const render = groupHunks(rows, 3, undefined, expanded);
    expect(render[0]!.kind).toBe("row");
    // 首段 6 行 + 保留 8 行 + 尾段仍折叠 1 项
    expect(render).toHaveLength(6 + 8 + 1);
  });

  it("context=0 只留变更行；无变更全折叠", () => {
    const rows = lineDiff(OLD, NEW);
    const render = groupHunks(rows, 0);
    expect(render.filter((r) => r.kind === "row")).toHaveLength(2);
    expect(lineDiff("a", "a").length).toBe(1);
  });
});
