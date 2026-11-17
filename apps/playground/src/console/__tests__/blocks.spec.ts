import { describe, expect, it } from "vitest";
import { rebuildBlocksFromHistory } from "../stream/blocks";
import type { ActionCard } from "../types";

function approvalCard(id: string, offset?: number): ActionCard {
  return {
    id,
    type: "approval",
    data: offset === undefined ? { actionId: id } : { actionId: id, contentOffset: offset },
  };
}

describe("rebuildBlocksFromHistory — 历史时序块重建", () => {
  it("带 contentOffset 的审批卡插回文本流真实位置", () => {
    const blocks = rebuildBlocksFromHistory("分析中继续执行", [
      approvalCard("approval-act-1", 3),
    ]);
    expect(blocks).toEqual([
      { kind: "text", content: "分析中" },
      { kind: "card", cardId: "approval-act-1" },
      { kind: "text", content: "继续执行" },
    ]);
  });

  it("多张卡按偏移排序插入", () => {
    const blocks = rebuildBlocksFromHistory("ABCDEF", [
      approvalCard("b", 4),
      approvalCard("a", 2),
    ]);
    expect(blocks.map((b) => (b.kind === "card" ? b.cardId : b.content))).toEqual([
      "AB", "a", "CD", "b", "EF",
    ]);
  });

  it("无偏移的旧数据卡片追加到正文之后（旧行为兜底）", () => {
    const blocks = rebuildBlocksFromHistory("正文内容", [approvalCard("legacy")]);
    expect(blocks).toEqual([
      { kind: "text", content: "正文内容" },
      { kind: "card", cardId: "legacy" },
    ]);
  });

  it("偏移越界按正文长度截断；空正文且有卡时仍产出卡片块", () => {
    expect(rebuildBlocksFromHistory("ab", [approvalCard("x", 99)])).toEqual([
      { kind: "text", content: "ab" },
      { kind: "card", cardId: "x" },
    ]);
    expect(rebuildBlocksFromHistory("", [approvalCard("y", 0)])).toEqual([
      { kind: "card", cardId: "y" },
    ]);
  });
});
