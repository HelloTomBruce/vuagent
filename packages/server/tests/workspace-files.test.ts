/**
 * GET /api/workspaces/:id/files 测试：
 * - 目录树结构（目录在前、按名排序、相对路径 POSIX 分隔）
 * - 忽略 node_modules 等目录
 * - 未知工作区 404
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { createHarnessServer } from "../src/server.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function makeTempWorkspace() {
  const root = await fs.mkdtemp(path.join("/tmp", "vuagent-ws-"));
  tmpDirs.push(root);
  await fs.writeFile(path.join(root, "README.md"), "# demo");
  await fs.writeFile(path.join(root, "a.ts"), "export {}");
  await fs.mkdir(path.join(root, "src/lib"), { recursive: true });
  await fs.writeFile(path.join(root, "src/index.ts"), "export {}");
  await fs.writeFile(path.join(root, "src/lib/util.ts"), "export {}");
  await fs.mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
  await fs.writeFile(path.join(root, "node_modules/pkg/index.js"), "module.exports = 1");

  const { app } = createHarnessServer({ dbPath: ":memory:" });
  const created = await app.request("/api/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "demo", rootPath: root, permission: "read-write" }),
  });
  const ws = await created.json();
  return { app, ws };
}

interface FileNodeLite {
  path: string;
  type: "file" | "dir";
  children?: FileNodeLite[];
}

function findNode(nodes: FileNodeLite[], p: string): FileNodeLite | undefined {
  for (const n of nodes) {
    if (n.path === p) return n;
    if (n.children) {
      const hit = findNode(n.children, p);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe("GET /api/workspaces/:id/files", () => {
  it("返回目录树：目录在前、忽略 node_modules、相对路径", async () => {
    const { app, ws } = await makeTempWorkspace();
    const res = await app.request(`/api/workspaces/${ws.id}/files`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.root).toBe(ws.rootPath);
    expect(json.truncated).toBe(false);

    const tree: FileNodeLite[] = json.tree;
    const src = findNode(tree, "src");
    expect(src?.type).toBe("dir");
    // 目录在前：第一个节点是 src 目录
    expect(tree[0]?.path).toBe("src");
    // node_modules 被忽略
    expect(findNode(tree, "node_modules")).toBeUndefined();
    // 深层文件可达（src/lib/util.ts）
    const util = findNode(tree, "src/lib/util.ts");
    expect(util?.type).toBe("file");
    // 顶层文件在列
    expect(findNode(tree, "README.md")?.type).toBe("file");
  });

  it("未知工作区返回 404", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const res = await app.request("/api/workspaces/ws-not-exist/files");
    expect(res.status).toBe(404);
  });

  it("rootPath 不存在时返回空树而非 500", async () => {
    const { app } = createHarnessServer({ dbPath: ":memory:" });
    const created = await app.request("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ghost", rootPath: "/tmp/vuagent-not-exist-xyz", permission: "read-write" }),
    });
    const ws = await created.json();
    const res = await app.request(`/api/workspaces/${ws.id}/files`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tree).toEqual([]);
  });
});
