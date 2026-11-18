import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "../../core/types.js";

export const FsReadTool: HarnessTool = {
  name: "fs_read",
  description: [
    "读取工作区沙箱内的文件内容。",
    "执行契约：",
    "- 返回 { filePath, content, sizeBytes }；content 为完整文本（UTF-8），不做截断——大文件会占用大量上下文，建议先用 bash_run 的 grep/sed/head 定位再读。",
    "- 路径按工作区根目录解析；越出工作区的路径（如 ../、绝对路径指向外部）会被拒绝并返回 Security Violation 错误。",
    "- 文件不存在或非 UTF-8 可读时返回错误信息，不会静默返回空内容。",
  ].join("\n"),
  parameters: Type.Object({
    filePath: Type.String({ description: "工作区相对路径或文件名" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const rawPath = String(ctx.args.filePath || "");
    const safePath = path.resolve(ctx.workspace.rootPath, rawPath);

    // 边界安全校验
    const rel = path.relative(ctx.workspace.rootPath, safePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`[Security Violation] Path [${rawPath}] outside workspace sandbox`);
    }

    const content = await fs.readFile(safePath, "utf-8");
    return {
      filePath: rawPath,
      content,
      sizeBytes: Buffer.byteLength(content, "utf-8"),
    };
  },
};

export const FsWriteTool: HarnessTool = {
  name: "fs_write",
  description: [
    "写入或修改工作区沙箱内的文件。",
    "执行契约：",
    "- 全量覆写语义：content 会完整替换目标文件内容，不是追加；修改既有文件前应先用 fs_read 读取。",
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
    const safePath = path.resolve(ctx.workspace.rootPath, rawPath);

    const rel = path.relative(ctx.workspace.rootPath, safePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`[Security Violation] Path [${rawPath}] outside workspace sandbox`);
    }

    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, String(ctx.args.content || ""), "utf-8");

    return {
      filePath: rawPath,
      success: true,
      writtenBytes: Buffer.byteLength(String(ctx.args.content || ""), "utf-8"),
    };
  },
};
