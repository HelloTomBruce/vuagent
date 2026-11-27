/**
 * 附件来源抽象（TASK-082）：composer 实时态与队列项快照的统一访问层。
 *
 * 背景：运行中入队曾只存文本——附件被静默丢弃，残留 chip 又错挂到
 * 下一条手动发送。修复后附件在入队时快照（含未读完图片的 File 引用，
 * flush 时补读），发送路径只认「来源」，直发/队列两条逻辑收敛为一条。
 */
import type { ComposerAttachment } from "@vuagent/ui";

/** 附件来源：composer 实时态或队列项入队快照 */
export interface AttachmentSource {
  /** chip 元数据（含 previewUrl 对象 URL） */
  atts: ComposerAttachment[];
  /** 文本附件内容（选择时即读，受 48KB 截断） */
  texts: Map<string, string>;
  /** 已读完的图片 base64（视觉通道 P2：随请求 images 字段发送） */
  images: Map<string, { name: string; mediaType: string; data: string }>;
  /** 尚未读完 base64 的图片 File 引用：发送瞬间补读 */
  files: Map<string, File>;
}

/**
 * 读单张图为 base64 存入 images；读完（或失败）即释放 files 中的 File 引用。
 * 后台读完成时若 files 已无该 id（所有权已随入队快照转移），不写回旧来源——
 * 否则 composer 侧缓存会残留无人引用的陈旧条目（泄漏）。
 */
export function readImageToBase64(
  id: string,
  file: File,
  images: Map<string, { name: string; mediaType: string; data: string }>,
  files: Map<string, File>
): Promise<void> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (files.has(id)) {
        const m = /^data:([^;]+);base64,(.+)$/.exec(String(reader.result ?? ""));
        if (m) images.set(id, { name: file.name, mediaType: m[1], data: m[2] });
        files.delete(id);
      }
      resolve();
    };
    reader.onerror = () => {
      files.delete(id); // 读取失败：不留死引用，发送侧按缺图处理
      resolve();
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 入队快照（TASK-082）：把当前 composer 附件的所有权转移给队列项。
 * 无附件返回 undefined；调用方随后清空 composer chip（不释放缓存/对象 URL——
 * 所有权已随快照转移，由 flush 消费或队列项移除时统一 dispose）。
 */
export function snapshotAttachments(src: AttachmentSource): AttachmentSource | undefined {
  if (src.atts.length === 0) return undefined;
  const snap: AttachmentSource = { atts: [...src.atts], texts: new Map(), images: new Map(), files: new Map() };
  // 所有权转移：条目从来源摘除（配合 readImageToBase64 的 files.has 守卫，
  // 进行中的后台读取不会把陈旧数据写回旧来源）
  for (const a of src.atts) {
    const text = src.texts.get(a.id);
    if (text !== undefined) {
      snap.texts.set(a.id, text);
      src.texts.delete(a.id);
    }
    const img = src.images.get(a.id);
    if (img) {
      snap.images.set(a.id, img);
      src.images.delete(a.id);
    }
    const file = src.files.get(a.id);
    if (file) {
      snap.files.set(a.id, file);
      src.files.delete(a.id);
    }
  }
  return snap;
}

/** 文本附件内联前缀；图片不进 prompt（视觉通道：经 images 字段组装 content parts） */
export function buildAttachmentPrefix(src: AttachmentSource): string {
  const fileLikes = src.atts.filter((a) => a.kind !== "image");
  if (fileLikes.length === 0) return "";
  const parts: string[] = [];
  for (const a of fileLikes) {
    const text = src.texts.get(a.id);
    parts.push(text ? `---\n[${a.name}]\n${text}\n---` : `[附件] ${a.name}（文件）`);
  }
  return parts.join("\n\n") + "\n\n";
}

/** 附件回显元数据（TASK-050）：图片带 dataUrl（当日真图），文本附件带名字 */
export function collectTurnAttachments(
  src: AttachmentSource
): { name: string; kind: "image" | "file"; size: number; dataUrl?: string }[] {
  return src.atts.map((a) => {
    const size = a.size ?? 0;
    if (a.kind !== "image") return { name: a.name, kind: "file" as const, size };
    const d = src.images.get(a.id);
    return {
      name: a.name,
      kind: "image" as const,
      size,
      ...(d ? { dataUrl: `data:${d.mediaType};base64,${d.data}` } : {}),
    };
  });
}

/**
 * 收集本轮图片附件（视觉通道 P2）；无图返回 undefined（请求不带 images 字段）。
 * 发送瞬间仍在读取的图片先补读——否则「选完图立刻发送」会遇到 chip 已清
 * 而请求不带图的静默丢失；队列快照路径同理（入队时未读完的 File 随快照保存）。
 */
export async function collectTurnImages(
  src: AttachmentSource
): Promise<{ name: string; mediaType: string; data: string }[] | undefined> {
  const imageAtts = src.atts.filter((a) => a.kind === "image");
  if (imageAtts.length === 0) return undefined;
  await Promise.all(
    imageAtts
      .filter((a) => !src.images.has(a.id) && src.files.has(a.id))
      .map((a) => readImageToBase64(a.id, src.files.get(a.id)!, src.images, src.files))
  );
  const images = imageAtts
    .map((a) => src.images.get(a.id))
    .filter((x): x is { name: string; mediaType: string; data: string } => !!x);
  return images.length > 0 ? images : undefined;
}

/** 释放来源持有的对象 URL 与缓存（发送完成 / 队列项移除后调用，不留孤儿引用） */
export function disposeAttachments(src: AttachmentSource): void {
  for (const a of src.atts) {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    src.texts.delete(a.id);
    src.images.delete(a.id);
    src.files.delete(a.id);
  }
}
