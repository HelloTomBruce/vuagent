/**
 * 工作区文件树读取（只读、有界）：
 * - 供 GET /api/workspaces/:id/files 使用，为控制台右栏 VaFileTree 提供数据；
 * - 安全：仅读工作区 rootPath 之内的内容，输出相对路径，不做任何写操作；
 * - 有界：深度与节点总数双重上限，忽略依赖/构建产物目录，防止大仓库拖垮响应。
 */
import fs from "node:fs/promises";
import path from "node:path";

/** 目录名忽略清单（依赖/构建产物/系统文件） */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".turbo",
  ".idea",
  ".vscode",
]);

/** 默认最大遍历深度（rootPath 本身为深度 0） */
export const DEFAULT_MAX_DEPTH = 4;
/** 默认节点总数上限（目录 + 文件合计），超过即截断并在结果中标记 */
export const DEFAULT_MAX_NODES = 2000;

export interface WorkspaceFileNode {
  /** 相对 rootPath 的路径（POSIX 分隔符），作为 VaFileTree 的 path/id */
  path: string;
  type: "file" | "dir";
  children?: WorkspaceFileNode[];
}

export interface BuildFileTreeOptions {
  maxDepth?: number;
  maxNodes?: number;
}

export interface BuildFileTreeResult {
  tree: WorkspaceFileNode[];
  /** 是否因节点上限截断（true 时宿主可提示「目录过大，仅展示部分」） */
  truncated: boolean;
}

function compareEntries(a: { name: string; isDir: boolean }, b: { name: string; isDir: boolean }): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // 目录在前
  return a.name.localeCompare(b.name);
}

export async function buildFileTree(
  rootPath: string,
  options: BuildFileTreeOptions = {},
): Promise<BuildFileTreeResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  let nodeCount = 0;
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<WorkspaceFileNode[]> {
    if (depth > maxDepth || nodeCount >= maxNodes) {
      if (nodeCount >= maxNodes) truncated = true;
      return [];
    }
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return []; // 目录不可读（权限等）：按空目录处理，不中断整棵树
    }
    const items = entries
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .filter((e) => (e.isDir ? !IGNORED_DIRS.has(e.name) : true))
      .sort(compareEntries);

    const nodes: WorkspaceFileNode[] = [];
    for (const item of items) {
      if (nodeCount >= maxNodes) {
        truncated = true;
        break;
      }
      const abs = path.join(dir, item.name);
      const rel = path.relative(rootPath, abs).split(path.sep).join("/");
      nodeCount += 1;
      if (item.isDir) {
        const children = await walk(abs, depth + 1);
        nodes.push({ path: rel, type: "dir", children });
      } else {
        nodes.push({ path: rel, type: "file" });
      }
    }
    return nodes;
  }

  const tree = await walk(rootPath, 0);
  return { tree, truncated };
}
