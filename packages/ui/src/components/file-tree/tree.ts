import type { FileNode, FileStatus } from "./types";

/**
 * 扁平变更路径列表 → 文件树。
 * agent 后端通常直接给出 git 变更列表（"src/ui/button.tsx" + status），
 * 这里按路径段建树：目录优先、同级字母序，文件继承传入 status。
 */
export function buildFileTree(files: Array<{ path: string; status?: FileStatus }>): FileNode[] {
  type Draft = FileNode & { childrenMap?: Map<string, Draft> };

  const root: Draft = { path: "", type: "dir", children: [], childrenMap: new Map() };

  for (const f of files) {
    const segs = f.path.split("/").filter(Boolean);
    let cur = root;
    segs.forEach((seg, i) => {
      const isLeaf = i === segs.length - 1;
      const path = segs.slice(0, i + 1).join("/");
      let next = cur.childrenMap!.get(seg);
      if (!next) {
        next = isLeaf
          ? { path, type: "file", status: f.status }
          : { path, type: "dir", children: [], childrenMap: new Map() };
        cur.childrenMap!.set(seg, next);
        cur.children!.push(next);
      } else if (isLeaf && next.type !== "dir") {
        next.status = f.status; // 重复路径以最后一次为准
      }
      cur = next;
    });
  }

  const sortRec = (nodes: Draft[]): Draft[] => {
    nodes.sort((a, b) => {
      const ad = a.type === "dir" || (a.children?.length ?? 0) > 0 ? 1 : 0;
      const bd = b.type === "dir" || (b.children?.length ?? 0) > 0 ? 1 : 0;
      if (ad !== bd) return bd - ad; // 目录在前
      return a.path.split("/").pop()!.localeCompare(b.path.split("/").pop()!);
    });
    for (const n of nodes) if (n.children?.length) sortRec(n.children as Draft[]);
    return nodes;
  };

  const clean = (nodes: Draft[]): FileNode[] =>
    nodes.map(({ childrenMap, children, ...rest }) => {
      const out: FileNode = rest;
      if (children?.length) out.children = clean(children);
      return out;
    });

  return clean(sortRec(root.children!));
}

/** 深度优先展开可见行（level 从 1 起） */
export interface FlatRow {
  node: FileNode;
  level: number;
  isDir: boolean;
  expanded: boolean;
}

export function flattenTree(tree: FileNode[], isExpanded: (p: string) => boolean): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: FileNode[], level: number) => {
    for (const node of nodes) {
      const isDir = node.type === "dir" || (node.children?.length ?? 0) > 0;
      const expanded = isDir && isExpanded(node.path);
      out.push({ node, level, isDir, expanded });
      if (expanded && node.children?.length) walk(node.children, level + 1);
    }
  };
  walk(tree, 1);
  return out;
}

/** 目录下（递归）带变更标记的文件数，用于目录行的计数徽章 */
export function countStatus(node: FileNode): number {
  if (!node.children?.length) return node.status ? 1 : 0;
  return node.children.reduce((sum, c) => sum + countStatus(c), 0);
}
