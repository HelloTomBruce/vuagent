import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { HarnessTool } from "../../core/types.js";

export const FsReadTool: HarnessTool = {
  name: "fs_read",
  description: "读取工作区沙箱内的文件内容",
  parameters: Type.Object({
    filePath: Type.String({ description: "工作区相对路径或文件名" }),
  }),
  riskLevel: "low",
  requiresApproval: false,
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
  description: "写入或修改工作区沙箱内的文件",
  parameters: Type.Object({
    filePath: Type.String({ description: "工作区相对路径或文件名" }),
    content: Type.String({ description: "要写入的文件完整文本内容" }),
  }),
  riskLevel: "medium",
  requiresApproval: false,
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
