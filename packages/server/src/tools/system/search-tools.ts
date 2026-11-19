import fs from "node:fs/promises";
import path from "node:path";
import type { HarnessTool } from "../../core/types.js";
import { GlobParamsSchema, GrepParamsSchema } from "@vuagent/protocol";

/** 目录遍历统一忽略项（依赖/构建产物/VCS/运行数据） */
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".vuagent"]);

/** 二进制类扩展名：grep 跳过（读成 UTF-8 只会得到乱码浪费上下文） */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf",
  ".zip", ".gz", ".tar", ".rar", ".7z", ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".mov", ".wav", ".db", ".sqlite", ".wasm",
]);

/** 单文件读取上限：超出视为超大文本跳过（防上下文爆炸） */
const MAX_FILE_BYTES = 1024 * 1024;

async function* walkFiles(root: string, relPrefix = ""): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(relPrefix ? path.join(root, relPrefix) : root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") {
      // 隐藏目录（.git 等）跳过；隐藏文件仍可能被 glob 精确点名，此处不跳过单文件
      if (entry.isDirectory()) continue;
    }
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walkFiles(root, relPrefix ? `${relPrefix}/${entry.name}` : entry.name);
    } else if (entry.isFile()) {
      yield relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    }
  }
}

/**
 * glob 模式 → 正则：支持 **（跨段）、*（段内）、?（单字符），其余字符字面匹配。
 * 相对工作区根的 POSIX 风格路径匹配（统一 / 分隔）。
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** 或 **/ ：跨任意层目录
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+{}()[\]\\^$|]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export const GlobTool: HarnessTool = {
  name: "glob",
  description: [
    "在工作区内按 glob 模式查找文件路径（内容搜索请用 grep）。",
    "执行契约：",
    "- 模式相对工作区根，支持 **（跨目录）、*（单段内）、?（单字符），如 `src/**/*.ts`、`packages/*/package.json`。",
    "- 自动跳过 node_modules / .git / dist 等目录；返回按文件修改时间降序（最新改动的最前），上限 100 条。",
    "- 返回 { pattern, count, truncated, files: [{ path, modifiedAt }] }；无匹配时 files 为空数组（不是错误）。",
  ].join("\n"),
  parameters: GlobParamsSchema, // TASK-055：契约收口至 @vuagent/protocol
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const pattern = String(ctx.args.pattern || "").trim();
    if (!pattern) throw new Error("pattern 不能为空");
    const regex = globToRegExp(pattern);

    const found: Array<{ path: string; modifiedAt: number }> = [];
    const LIMIT = 100;
    let truncated = false;

    for await (const rel of walkFiles(ctx.workspace.rootPath)) {
      if (!regex.test(rel)) continue;
      if (found.length >= LIMIT) {
        truncated = true;
        break;
      }
      let modifiedAt = 0;
      try {
        modifiedAt = (await fs.stat(path.join(ctx.workspace.rootPath, rel))).mtimeMs;
      } catch {
        // stat 失败（竞态删除）不致命，保持 0 排序垫底
      }
      found.push({ path: rel, modifiedAt });
    }

    found.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return { pattern, count: found.length, truncated, files: found };
  },
};

export const GrepTool: HarnessTool = {
  name: "grep",
  description: [
    "在工作区文件内容中做正则搜索（定位代码请优先用本工具，而非 bash_run 里跑 grep）。",
    "执行契约：",
    "- pattern 为 JavaScript 正则源（不带分隔符），默认大小写敏感；flags 可传 'i'（忽略大小写）等（g 自动附加）。",
    "- 可选 include 按 glob 过滤文件名（如 `*.ts`）；自动跳过 node_modules/.git/dist、二进制文件与超过 1MB 的文件。",
    "- 命中按文件分组输出 `相对路径:行号: 行内容`，上限 250 条（truncated=true 表示还有更多，建议收窄 pattern 或 include）。",
    "- 返回 { pattern, matchCount, truncated, filesMatched, matches }；无命中返回空数组（不是错误）。",
  ].join("\n"),
  parameters: GrepParamsSchema, // TASK-055：契约收口至 @vuagent/protocol
  riskLevel: "low",
  requiresApproval: false,
  writesWorkspace: false,
  execute: async (ctx) => {
    const pattern = String(ctx.args.pattern ?? "");
    if (!pattern) throw new Error("pattern 不能为空");
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, `${String(ctx.args.flags ?? "")}g`.replace(/[^gimsuy]/g, ""));
    } catch (e) {
      throw new Error(`无效正则 [${pattern}]: ${e instanceof Error ? e.message : String(e)}`);
    }
    const includePattern = ctx.args.include ? String(ctx.args.include) : null;
    const includeRe = includePattern ? globToRegExp(includePattern) : null;
    // include 语义（对齐 ripgrep --glob）：无斜杠的模式匹配任意深度下的文件名，
    // 含斜杠的模式匹配相对工作区根的完整路径
    const includeMatcher = includeRe
      ? (rel: string) =>
          includePattern!.includes("/") ? includeRe!.test(rel) : includeRe!.test(path.basename(rel))
      : null;

    const MATCH_LIMIT = 250;
    const matches: string[] = [];
    let truncated = false;
    const filesMatched = new Set<string>();

    for await (const rel of walkFiles(ctx.workspace.rootPath)) {
      if (matches.length >= MATCH_LIMIT) {
        truncated = true;
        break;
      }
      const ext = path.extname(rel).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;
      if (includeMatcher && !includeMatcher(rel)) continue;

      let content: string;
      try {
        const stat = await fs.stat(path.join(ctx.workspace.rootPath, rel));
        if (stat.size > MAX_FILE_BYTES) continue;
        content = await fs.readFile(path.join(ctx.workspace.rootPath, rel), "utf-8");
      } catch {
        continue; // 竞态删除/不可读，跳过
      }
      if (content.includes("\u0000")) continue; // 二进制内容

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (!regex.test(lines[i])) continue;
        matches.push(`${rel}:${i + 1}: ${lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i]}`);
        filesMatched.add(rel);
        if (matches.length >= MATCH_LIMIT) {
          truncated = true;
          break;
        }
      }
    }

    return {
      pattern,
      matchCount: matches.length,
      truncated,
      filesMatched: filesMatched.size,
      matches,
    };
  },
};
