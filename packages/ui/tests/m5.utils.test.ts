import { describe, expect, it } from "vitest";
import { buildFileTree, countStatus, flattenTree } from "../src/components/file-tree/tree";
import { formatRelative } from "../src/components/checkpoint-list/useCheckpointList";
import { formatBytes } from "../src/components/dropzone/formatSize";

describe("buildFileTree", () => {
  it("扁平路径 → 层级树，目录在前字母序", () => {
    const tree = buildFileTree([
      { path: "src/ui/button.tsx", status: "modified" },
      { path: "src/hooks/use-form.ts", status: "added" },
      { path: "package.json", status: "modified" },
    ]);
    expect(tree.map((n) => n.path)).toEqual(["src", "package.json"]);
    const src = tree[0]!;
    expect(src.type).toBe("dir");
    expect(src.children!.map((n) => n.path.split("/").pop())).toEqual(["hooks", "ui"]);
    expect(src.children![1]!.children![0]).toMatchObject({
      path: "src/ui/button.tsx",
      type: "file",
      status: "modified",
    });
  });

  it("status 聚合计数 + flatten 按展开集裁剪", () => {
    const tree = buildFileTree([
      { path: "a/one.ts", status: "added" },
      { path: "a/two.ts", status: "added" },
      { path: "a/three.ts" },
    ]);
    expect(countStatus(tree[0]!)).toBe(2);
    // 全折叠：只看到顶层目录
    const closed = flattenTree(tree, () => false);
    expect(closed).toHaveLength(1);
    expect(closed[0]!.isDir).toBe(true);
    // 展开：目录 + 3 文件
    const open = flattenTree(tree, (p) => p === "a");
    expect(open).toHaveLength(4);
    expect(open.every((r) => !r.isDir || r.node.path === "a")).toBe(true);
  });
});

describe("formatRelative", () => {
  const NOW = new Date("2026-11-10T12:00:00").getTime();

  it("阶梯文案", () => {
    expect(formatRelative(NOW - 30_000, NOW)).toBe("刚刚");
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
    expect(formatRelative(NOW, NOW)).toBe("刚刚");
  });

  it("今天 / 昨天 / 更早带时刻", () => {
    expect(formatRelative(new Date("2026-11-10T09:00:00").getTime(), NOW)).toBe("今天 09:00");
    expect(formatRelative(new Date("2026-11-09T20:00:00").getTime(), NOW)).toBe("昨天 20:00");
    expect(formatRelative(new Date("2026-11-01T10:05:00").getTime(), NOW)).toBe("11-1 10:05");
  });

  it("未来时间不产生负数（钳到刚刚）", () => {
    expect(formatRelative(NOW + 60_000, NOW)).toBe("刚刚");
  });
});

describe("formatBytes", () => {
  it("单位阶梯与保留位数", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1024 * 512)).toBe("512 KB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
    expect(formatBytes(1024 ** 3 * 2.2)).toBe("2.2 GB");
  });

  it("非法输入回落 0 B", () => {
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
  });
});
