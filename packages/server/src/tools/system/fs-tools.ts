import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "../../core/types.js";

/**
 * 路径沙箱校验（fs_read / fs_write / fs_edit 共用）：
 * 按 workspace.rootPath 解析相对路径，越出工作区（../ 或绝对路径外指）即拒绝。
 */
function resolveInWorkspace(rootPath: string, rawPath: string): string {
  const safePath = path.resolve(rootPath, rawPath);
  const rel = path.relative(rootPath, safePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`[Security Violation] Path [${rawPath}] outside workspace sandbox`);
  }
  return safePath;
}

export const FsReadTool: HarnessTool = {
  name: "fs_read",
  description: [
    "读取工作区沙箱内的文件内容。",
    "执行契约：",
    "- 返回 { filePath, content, sizeBytes, totalLines, truncated }；content 为 UTF-8 文本。",
    "- 全量读（不带 offset/limit）不做截断——大文件会占用大量上下文，超过 2000 行的文件请务必带 offset/limit 分页读取。",
    "- offset 为 1-based 起始行号，limit 为本次最多读取的行数（缺省 2000）；truncated=true 表示后面还有内容，用 offset 接续读。",
    "- 路径按工作区根目录解析；越出工作区的路径（如 ../、绝对路径指向外部）会被拒绝并返回 Security Violation 错误。",
    "- 文件不存在或非 UTF-8 可读时返回错误信息，不会静默返回空内容。",
  ].join("\n"),
  parameters: Type.Object({
    filePath: Type.String({ description: "工作区相对路径或文件名" }),
    offset: Type.Optional(
      Type.Number({ description: "1-based 起始行号；缺省从第 1 行读全量" })
    ),
    limit: Type.Optional(
      Type.Number({ description: "最多读取行数（仅 offset 给出时生效，缺省 2000）" })
    ),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const rawPath = String(ctx.args.filePath || "");
    const safePath = resolveInWorkspace(ctx.workspace.rootPath, rawPath);

    const raw = await fs.readFile(safePath, "utf-8");
    const allLines = raw.split("\n");
    const totalLines = allLines.length;
    const sizeBytes = Buffer.byteLength(raw, "utf-8");

    // 兼容旧调用：不带 offset/limit 时全量返回（content 语义不变）
    if (ctx.args.offset === undefined && ctx.args.limit === undefined) {
      return { filePath: rawPath, content: raw, sizeBytes, totalLines, truncated: false };
    }

    const startLine = Math.max(1, Math.floor(Number(ctx.args.offset) || 1));
    const limitNum = Math.floor(Number(ctx.args.limit));
    const limitRaw =
      ctx.args.limit === undefined || !Number.isFinite(limitNum) ? 2000 : limitNum;
    const limit = Math.min(Math.max(1, limitRaw), 5000);
    const slice = allLines.slice(startLine - 1, startLine - 1 + limit);
    const truncated = startLine - 1 + slice.length < totalLines;

    return {
      filePath: rawPath,
      content: slice.join("\n"),
      sizeBytes,
      totalLines,
      offset: startLine,
      returnedLines: slice.length,
      truncated,
    };
  },
};

export const FsWriteTool: HarnessTool = {
  name: "fs_write",
  description: [
    "写入或修改工作区沙箱内的文件。",
    "执行契约：",
    "- 全量覆写语义：content 会完整替换目标文件内容，不是追加；修改既有文件前应先用 fs_read 读取。",
    "- 局部修改优先用 fs_edit（精确字符串替换），避免大文件全量重写浪费上下文。",
    "- 父目录不存在时自动递归创建；返回 { filePath, success, writtenBytes }。",
    "- 路径按工作区根目录解析；越出工作区的路径会被拒绝并返回 Security Violation 错误。",
  ].join("\n"),
  parameters: Type.Object({
    filePath: Type.String({ description: "工作区相对路径或文件名" }),
    content: Type.String({ description: "要写入的文件完整文本内容" }),
  }),
  riskLevel: "medium",
  requiresApproval: false,
  writesWorkspace: true,
  execute: async (ctx) => {
    const rawPath = String(ctx.args.filePath || "");
    const safePath = resolveInWorkspace(ctx.workspace.rootPath, rawPath);

    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, String(ctx.args.content || ""), "utf-8");

    return {
      filePath: rawPath,
      success: true,
      writtenBytes: Buffer.byteLength(String(ctx.args.content || ""), "utf-8"),
    };
  },
};

export const FsEditTool: HarnessTool = {
  name: "fs_edit",
  description: [
    "对工作区沙箱内的既有文件做精确字符串替换（局部编辑首选，优先于 fs_write 全量重写）。",
    "执行契约：",
    "- oldString/newString 为字面文本（含缩进与换行的精确原文），不是正则；编辑前必须先用 fs_read 读取确切内容。",
    "- oldString 在文件中必须唯一匹配；出现多次会被拒绝并报出匹配次数——此时扩大上下文（多带几行前后文）使其唯一，或显式传 replaceAll=true 全部替换。",
    "- 0 次匹配会报错：常见原因是缩进/换行/全半角不一致，用 fs_read 原文复制，不要凭记忆拼。",
    "- 返回 { filePath, success, replaced, sizeBytes }；replaced 为实际替换次数。",
    "- 路径按工作区根目录解析；越出工作区的路径会被拒绝并返回 Security Violation 错误。",
  ].join("\n"),
  parameters: Type.Object({
    filePath: Type.String({ description: "工作区相对路径（文件必须已存在）" }),
    oldString: Type.String({ description: "要替换的精确原文（字面文本，含缩进换行）" }),
    newString: Type.String({ description: "替换后的文本" }),
    replaceAll: Type.Optional(
      Type.Boolean({ description: "oldString 多次出现时是否全部替换；默认 false（仅唯一匹配可替换）" })
    ),
  }),
  riskLevel: "medium",
  requiresApproval: false,
  writesWorkspace: true,
  execute: async (ctx) => {
    const rawPath = String(ctx.args.filePath || "");
    const safePath = resolveInWorkspace(ctx.workspace.rootPath, rawPath);

    const original = await fs.readFile(safePath, "utf-8").catch(() => {
      throw new Error(`文件 [${rawPath}] 不存在或不可读；新建文件请用 fs_write`);
    });

    const oldStr = String(ctx.args.oldString ?? "");
    const newStr = String(ctx.args.newString ?? "");
    if (!oldStr) throw new Error("oldString 不能为空");
    if (oldStr === newStr) throw new Error("oldString 与 newString 相同，编辑无意义");

    const count = original.split(oldStr).length - 1;
    const replaceAll = ctx.args.replaceAll === true;

    if (count === 0) {
      // 附一个最相近行号提示，便于模型自纠：取 oldString 首行在原文中的模糊命中
      const firstLine = oldStr.split("\n")[0].trim();
      let hint = "";
      if (firstLine.length >= 4) {
        const lineIdx = original.split("\n").findIndex((l) => l.includes(firstLine));
        if (lineIdx >= 0) hint = `（相似内容出现在第 ${lineIdx + 1} 行附近，多半是缩进/空白不一致——用 fs_read 复制原文）`;
      }
      throw new Error(`oldString 在文件中未找到（0 次匹配）${hint}`);
    }
    if (count > 1 && !replaceAll) {
      throw new Error(
        `oldString 在文件中出现 ${count} 次，非唯一匹配已拒绝；扩大上下文使其唯一，或传 replaceAll=true 全部替换`
      );
    }

    const updated = replaceAll
      ? original.split(oldStr).join(newStr)
      : original.replace(oldStr, newStr);
    await fs.writeFile(safePath, updated, "utf-8");

    return {
      filePath: rawPath,
      success: true,
      replaced: replaceAll ? count : 1,
      sizeBytes: Buffer.byteLength(updated, "utf-8"),
    };
  },
};
