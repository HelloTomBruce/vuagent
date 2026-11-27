/**
 * 评审 R1 回归：hasImages 必须锚定**本轮** prompt。
 * checkpoint 快照是累积的——若直接扫「任意 user 带图 parts」，图片轮之后的
 * 所有轮次都会被误判为有图，历史重建给它们追加不存在的 [图片] 注记。
 */
import { describe, it, expect } from "vitest";
import { deriveHasImages } from "../src/core/turn-persistence.js";
import type { CheckpointEntity } from "../src/storage/interfaces.js";

const IMAGE_TURN_PROMPT = "第一轮：看图说话";
const TEXT_TURN_PROMPT = "第二轮：那它多大";

/** 第 2 轮的累积快照（含第 1 轮的图片 parts） */
const cumulativeSnapshot = [
  { role: "user", content: [{ type: "text", text: IMAGE_TURN_PROMPT }, { type: "image_url", image_url: { url: "[图片]" } }] },
  { role: "assistant", content: "这是一只狗" },
  { role: "user", content: TEXT_TURN_PROMPT },
  { role: "assistant", content: "两岁" },
];

function cps(snapshot: unknown[]): CheckpointEntity[] {
  return [{ id: "cp-1", turnId: "turn-1", stepIndex: 1, snapshotAt: 1, messagesSnapshot: snapshot }];
}

describe("deriveHasImages（R1：按本轮 prompt 锚定）", () => {
  it("图片轮之后的纯文本轮 → false（不再被累积快照里的旧图污染）", () => {
    expect(deriveHasImages(undefined, cps(cumulativeSnapshot), TEXT_TURN_PROMPT)).toBe(false);
  });

  it("图片轮本身 → true", () => {
    expect(deriveHasImages(undefined, cps(cumulativeSnapshot), IMAGE_TURN_PROMPT)).toBe(true);
  });

  it("附件元数据含图 → true（不依赖快照）", () => {
    expect(
      deriveHasImages([{ name: "a.png", kind: "image", size: 10 }], [], "任意提问"),
    ).toBe(true);
  });

  it("[图片] 占位块（降级后的快照形态）同样识别", () => {
    const snapshot = [
      { role: "user", content: [{ type: "text", text: IMAGE_TURN_PROMPT }, { type: "text", text: "[图片]" }] },
    ];
    expect(deriveHasImages(undefined, cps(snapshot), IMAGE_TURN_PROMPT)).toBe(true);
  });

  it("无 checkpoint / 快照无锚点 → false（防御式）", () => {
    expect(deriveHasImages(undefined, [], "任意")).toBe(false);
    expect(deriveHasImages(undefined, cps([{ role: "assistant", content: "x" }]), "任意")).toBe(false);
  });
});
