/**
 * 队列附件快照（TASK-082）
 *
 * 背景：运行中入队曾只存文本——附件被静默丢弃，残留 chip 又错挂到下一条
 * 手动发送。修复后附件在入队时快照（含未读完图片的 File 引用），flush 时
 * 经与直发相同的 collect* 路径产出。固化约束：
 *   1. 空附件快照返回 undefined（队列项不带附件字段）；
 *   2. 快照转移文本/图片/待读 File 所有权，flush 产出与直发一致；
 *   3. 入队时未读完的图片：File 引用随快照保存，flush 时补读不丢图；
 *   4. dispose 释放对象 URL 并清空缓存（消费/移除后不留孤儿）。
 */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  buildAttachmentPrefix,
  collectTurnAttachments,
  collectTurnImages,
  disposeAttachments,
  readImageToBase64,
  snapshotAttachments,
} from "../composables/attachments";
import type { AttachmentSource } from "../composables/attachments";

function makeSource(): AttachmentSource {
  return { atts: [], texts: new Map(), images: new Map(), files: new Map() };
}

describe("队列附件快照（TASK-082）", () => {
  it("空附件快照返回 undefined（队列项不带附件字段）", () => {
    expect(snapshotAttachments(makeSource())).toBeUndefined();
  });

  it("快照转移文本/图片所有权，flush 产出与直发一致", async () => {
    const src = makeSource();
    src.atts.push(
      { id: "a1", name: "note.md", size: 12, kind: "file" },
      { id: "a2", name: "p.png", size: 100, kind: "image", previewUrl: "blob:mock" }
    );
    src.texts.set("a1", "hello");
    src.images.set("a2", { name: "p.png", mediaType: "image/png", data: "aGk=" });

    const snap = snapshotAttachments(src);
    expect(snap).toBeDefined();
    expect(snap!.atts).toHaveLength(2);
    expect(snap!.texts.get("a1")).toBe("hello");
    expect(snap!.images.get("a2")?.data).toBe("aGk=");
    // 所有权转移语义：来源缓存同步摘除（composer 侧不留陈旧条目）
    expect(src.texts.size).toBe(0);
    expect(src.images.size).toBe(0);

    // flush：回显元数据（图片带当日 dataUrl）与 images 字段，同直发路径
    expect(collectTurnAttachments(snap!)).toEqual([
      { name: "note.md", kind: "file", size: 12 },
      { name: "p.png", kind: "image", size: 100, dataUrl: "data:image/png;base64,aGk=" },
    ]);
    expect(await collectTurnImages(snap!)).toEqual([
      { name: "p.png", mediaType: "image/png", data: "aGk=" },
    ]);
    // 文本附件仍内联进 prompt 前缀
    expect(buildAttachmentPrefix(snap!)).toBe("---\n[note.md]\nhello\n---\n\n");
  });

  it("入队时未读完的图片：File 引用随快照保存，flush 时补读不丢图", async () => {
    const src = makeSource();
    src.atts.push({ id: "a1", name: "p.png", size: 3, kind: "image" });
    // 只持有 File（base64 未读完）——修复前这条路径图片被静默丢弃
    src.files.set("a1", new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" }));

    const snap = snapshotAttachments(src);
    expect(snap!.files.has("a1")).toBe(true);

    const images = await collectTurnImages(snap!);
    expect(images).toHaveLength(1);
    expect(images![0].mediaType).toBe("image/png");
    expect(images![0].data.length).toBeGreaterThan(0);
    // 补读后释放 File 引用（不留死引用）
    expect(snap!.files.has("a1")).toBe(false);
    expect(snap!.images.has("a1")).toBe(true);
  });

  it("后台读在所有权转移后不写回旧来源（files.has 守卫）", async () => {
    const src = makeSource();
    src.atts.push({ id: "a1", name: "p.png", size: 3, kind: "image" });
    src.files.set("a1", new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" }));

    // 入队瞬间后台读仍在进行；快照先转移所有权，读完成时不得写回旧来源
    const pending = readImageToBase64("a1", src.files.get("a1")!, src.images, src.files);
    const snap = snapshotAttachments(src);
    await pending;

    expect(src.images.has("a1")).toBe(false); // 旧来源无陈旧写入
    // flush 时经快照补读拿到图（所有权已转移后的唯一正确归宿）
    const images = await collectTurnImages(snap!);
    expect(images).toHaveLength(1);
    expect(images![0].mediaType).toBe("image/png");
  });

  it("dispose 释放对象 URL 并清空缓存", () => {
    const revoke = vi.fn();
    const original = URL.revokeObjectURL?.bind(URL);
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = revoke;
    try {
      const src = makeSource();
      src.atts.push({ id: "a1", name: "p.png", size: 1, kind: "image", previewUrl: "blob:x" });
      src.images.set("a1", { name: "p.png", mediaType: "image/png", data: "eA==" });
      src.texts.set("a1", "x");

      disposeAttachments(src);
      expect(revoke).toHaveBeenCalledWith("blob:x");
      expect(src.images.size).toBe(0);
      expect(src.texts.size).toBe(0);
    } finally {
      if (original) (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = original;
    }
  });
});
