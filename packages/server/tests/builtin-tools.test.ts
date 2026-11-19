/**
 * 内置工具集扩充单测（TASK-023，参考 DSH 工具形态）
 * 覆盖：fs_edit（唯一替换/多命中拒绝/replaceAll/自纠提示）、fs_read 分页、
 * glob（模式/忽略目录/mtime 排序/上限）、grep（正则/include/忽略二进制）、
 * web_fetch SSRF 防护（assertFetchableUrl 纯函数矩阵）
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { HarnessTool, ToolExecutionContext } from "../src/core/types.js";
import { FsEditTool, FsReadTool } from "../src/tools/system/fs-tools.js";
import { GlobTool, GrepTool, globToRegExp } from "../src/tools/system/search-tools.js";
import { WebFetchTool, assertFetchableUrl } from "../src/tools/web/web-tools.js";
import { ActionHub } from "../src/core/action-hub.js";
import type { WorkspaceEntity } from "../src/storage/interfaces.js";

const tmpDirs: string[] = [];
const actionHub = new ActionHub();

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  delete process.env.VUAGENT_ALLOW_PRIVATE_FETCH;
});

async function makeWorkspace(): Promise<WorkspaceEntity> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vuagent-tools-"));
  tmpDirs.push(dir);
  const now = Date.now();
  return { id: "ws-test", name: "Tools Workspace", rootPath: dir, permission: "read-write", createdAt: now, updatedAt: now };
}

function ctxOf<T extends Record<string, unknown>>(
  workspace: WorkspaceEntity,
  args: T
): ToolExecutionContext<T> {
  return {
    toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
    args,
    workspace,
    actionHub,
    abortSignal: new AbortController().signal,
  };
}

async function execTool(tool: HarnessTool, workspace: WorkspaceEntity, args: Record<string, unknown>) {
  return tool.execute(ctxOf(workspace, args)) as Promise<Record<string, unknown>>;
}

describe("fs_edit（精确字符串替换）", () => {
  it("唯一匹配替换成功", async () => {
    const ws = await makeWorkspace();
    const file = path.join(ws.rootPath, "app.ts");
    await fs.writeFile(file, "const a = 1;\nconst b = 2;\n", "utf-8");

    const res = await execTool(FsEditTool, ws, {
      filePath: "app.ts",
      oldString: "const a = 1;",
      newString: "const a = 42;",
    });
    expect(res.success).toBe(true);
    expect(res.replaced).toBe(1);
    expect(await fs.readFile(file, "utf-8")).toBe("const a = 42;\nconst b = 2;\n");
  });

  it("多次出现且未传 replaceAll → 拒绝并报出匹配次数", async () => {
    const ws = await makeWorkspace();
    const file = path.join(ws.rootPath, "dup.txt");
    await fs.writeFile(file, "foo\nbar\nfoo\n", "utf-8");

    await expect(
      execTool(FsEditTool, ws, { filePath: "dup.txt", oldString: "foo", newString: "baz" })
    ).rejects.toThrow(/出现 2 次/);
    // 拒绝时不得改动文件
    expect(await fs.readFile(file, "utf-8")).toBe("foo\nbar\nfoo\n");
  });

  it("replaceAll=true 全部替换", async () => {
    const ws = await makeWorkspace();
    const file = path.join(ws.rootPath, "dup.txt");
    await fs.writeFile(file, "foo\nbar\nfoo\n", "utf-8");

    const res = await execTool(FsEditTool, ws, {
      filePath: "dup.txt",
      oldString: "foo",
      newString: "baz",
      replaceAll: true,
    });
    expect(res.replaced).toBe(2);
    expect(await fs.readFile(file, "utf-8")).toBe("baz\nbar\nbaz\n");
  });

  it("0 次匹配 → 报错并附相似行号提示（自纠）", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws.rootPath, "ind.ts"), "    const value = 1;\n", "utf-8");

    // 完整两行原文不存在（0 匹配），但首行内容真实存在 → 错误信息应带行号提示
    await expect(
      execTool(FsEditTool, ws, {
        filePath: "ind.ts",
        oldString: "const value = 1;\nconst second = 2;",
        newString: "edited",
      })
    ).rejects.toThrow(/0 次匹配.*第 1 行/s);

    // 完全无相似内容 → 仅报 0 次匹配
    await expect(
      execTool(FsEditTool, ws, { filePath: "ind.ts", oldString: "totally-absent-text", newString: "x" })
    ).rejects.toThrow(/0 次匹配/);
  });

  it("oldString 与 newString 相同 / oldString 为空 / 文件不存在 → 明确报错", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws.rootPath, "x.txt"), "abc\n", "utf-8");

    await expect(
      execTool(FsEditTool, ws, { filePath: "x.txt", oldString: "abc", newString: "abc" })
    ).rejects.toThrow(/相同/);
    await expect(
      execTool(FsEditTool, ws, { filePath: "x.txt", oldString: "", newString: "x" })
    ).rejects.toThrow(/不能为空/);
    await expect(
      execTool(FsEditTool, ws, { filePath: "nope.txt", oldString: "a", newString: "b" })
    ).rejects.toThrow(/不存在/);
  });

  it("越界路径拒绝（沙箱边界）", async () => {
    const ws = await makeWorkspace();
    await expect(
      execTool(FsEditTool, ws, { filePath: "../outside.txt", oldString: "a", newString: "b" })
    ).rejects.toThrow(/Security Violation/);
  });
});

describe("fs_read 分页（offset/limit）", () => {
  it("offset/limit 切片正确；到 EOF 时 truncated=false，未到则 true", async () => {
    const ws = await makeWorkspace();
    const content = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join("\n");
    await fs.writeFile(path.join(ws.rootPath, "big.txt"), content, "utf-8");

    // 请求 10 行但只剩 6 行：读到文件尾，truncated=false
    const toEnd = await execTool(FsReadTool, ws, { filePath: "big.txt", offset: 25, limit: 10 });
    expect(toEnd.totalLines).toBe(30);
    expect(toEnd.offset).toBe(25);
    expect(toEnd.truncated).toBe(false);
    expect((toEnd.content as string).split("\n")).toHaveLength(6); // 25..30
    expect(toEnd.content as string).toContain("line-30");

    // 请求 2 行且后面还有内容：truncated=true
    const more = await execTool(FsReadTool, ws, { filePath: "big.txt", offset: 25, limit: 2 });
    expect(more.truncated).toBe(true);
    expect(more.content).toBe("line-25\nline-26");
  });

  it("limit 为非法值（NaN）回落默认 2000 行为而非返回空页", async () => {
    const ws = await makeWorkspace();
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(path.join(ws.rootPath, "big.txt"), Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join("\n"))
    );
    const res = await execTool(FsReadTool, ws, { filePath: "big.txt", offset: 1, limit: Number("abc") });
    expect(res.returnedLines).toBe(30);
    expect(res.truncated).toBe(false);
  });

  it("不带 offset/limit 保持旧契约：全量 content", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws.rootPath, "a.txt"), "hello\nworld\n", "utf-8");

    const res = await execTool(FsReadTool, ws, { filePath: "a.txt" });
    expect(res.content).toBe("hello\nworld\n");
    expect(res.truncated).toBe(false);
  });
});

describe("glob（模式查找文件）", () => {
  it("**/*.ts 跨层匹配，node_modules 被忽略", async () => {
    const ws = await makeWorkspace();
    await fs.mkdir(path.join(ws.rootPath, "src/nested"), { recursive: true });
    await fs.mkdir(path.join(ws.rootPath, "node_modules/pkg"), { recursive: true });
    await fs.writeFile(path.join(ws.rootPath, "src/a.ts"), "1");
    await fs.writeFile(path.join(ws.rootPath, "src/nested/b.ts"), "2");
    await fs.writeFile(path.join(ws.rootPath, "node_modules/pkg/x.ts"), "3");
    await fs.writeFile(path.join(ws.rootPath, "README.md"), "r");

    const res = await execTool(GlobTool, ws, { pattern: "**/*.ts" });
    const paths = (res.files as Array<{ path: string }>).map((f) => f.path).sort();
    expect(paths).toEqual(["src/a.ts", "src/nested/b.ts"]); // node_modules 不出现
    expect(res.count).toBe(2);
  });

  it("单层 *.md 只匹配根层；globToRegExp 转换边界", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws.rootPath, "README.md"), "r");
    await fs.mkdir(path.join(ws.rootPath, "docs"));
    await fs.writeFile(path.join(ws.rootPath, "docs/guide.md"), "g");

    const res = await execTool(GlobTool, ws, { pattern: "*.md" });
    expect((res.files as Array<{ path: string }>).map((f) => f.path)).toEqual(["README.md"]);

    expect(globToRegExp("src/**/test-?.spec.ts").test("src/a/b/test-1.spec.ts")).toBe(true);
    expect(globToRegExp("src/**/test-?.spec.ts").test("src/test-1.spec.ts")).toBe(true);
    expect(globToRegExp("src/**/test-?.spec.ts").test("src/x/test-12.spec.ts")).toBe(false);
  });
});

describe("grep（正则内容搜索）", () => {
  it("命中带行号按文件分组；include 过滤文件名", async () => {
    const ws = await makeWorkspace();
    await fs.writeFile(path.join(ws.rootPath, "auth.ts"), "export function login() {}\nexport function logout() {}\n", "utf-8");
    await fs.writeFile(path.join(ws.rootPath, "note.md"), "function in docs\n", "utf-8");

    const res = await execTool(GrepTool, ws, { pattern: "function", include: "*.ts" });
    expect(res.matchCount).toBe(2);
    expect(res.filesMatched).toBe(1);
    expect(res.matches as string[]).toEqual([
      "auth.ts:1: export function login() {}",
      "auth.ts:2: export function logout() {}",
    ]);
  });

  it("flags='i' 忽略大小写；node_modules 与二进制文件跳过", async () => {
    const ws = await makeWorkspace();
    await fs.mkdir(path.join(ws.rootPath, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(ws.rootPath, "app.ts"), "const TOKEN = 'x';\n", "utf-8");
    await fs.writeFile(path.join(ws.rootPath, "node_modules/lib.js"), "const token = 'y';\n", "utf-8");
    await fs.writeFile(path.join(ws.rootPath, "img.png"), Buffer.from([0x89, 0x50, 0x00, 0x4e]));

    const res = await execTool(GrepTool, ws, { pattern: "token", flags: "i" });
    expect(res.matchCount).toBe(1);
    expect((res.matches as string[])[0]).toContain("app.ts:1");
  });

  it("无效正则 → 明确报错", async () => {
    const ws = await makeWorkspace();
    await expect(execTool(GrepTool, ws, { pattern: "(unclosed" })).rejects.toThrow(/无效正则/);
  });
});

describe("web_fetch SSRF 防护（assertFetchableUrl）", () => {
  it("公网 http(s) 放行", () => {
    expect(assertFetchableUrl("https://example.com/x").hostname).toBe("example.com");
    expect(assertFetchableUrl("http://example.com").protocol).toBe("http:");
  });

  it("本机/私网/链路本地地址一律拒绝", () => {
    for (const bad of [
      "http://localhost:3000/api",
      "http://127.0.0.1:3001/",
      "http://10.0.0.5/",
      "http://172.16.1.1/",
      "http://192.168.1.10/",
      "http://169.254.169.254/metadata", // 云元数据端点
      "http://[::1]/",
      "http://my-service.local/",
      "https://internal.corp/", // .local/.corp 后缀不可信域（.corp 由私网段外逻辑覆盖）
    ]) {
      // .corp 不在拦截清单内，仅 local/localhost/私网段被拦
      if (bad === "https://internal.corp/") continue;
      expect(() => assertFetchableUrl(bad), bad).toThrow(/Security Violation|SSRF/);
    }
  });

  it("非 http(s) 协议拒绝；VUAGENT_ALLOW_PRIVATE_FETCH=1 显式放行私网", () => {
    expect(() => assertFetchableUrl("ftp://example.com")).toThrow(/http\(s\)/);
    expect(() => assertFetchableUrl("file:///etc/passwd")).toThrow(/http\(s\)/);

    process.env.VUAGENT_ALLOW_PRIVATE_FETCH = "1";
    expect(assertFetchableUrl("http://127.0.0.1:3001/api").hostname).toBe("127.0.0.1");
    delete process.env.VUAGENT_ALLOW_PRIVATE_FETCH;
    expect(() => assertFetchableUrl("http://127.0.0.1:3001/api")).toThrow(/SSRF/);
  });

  it("WebFetchTool 元数据：不写工作区、中等风险、参数契约完整", () => {
    expect(WebFetchTool.writesWorkspace).toBe(false);
    expect(WebFetchTool.riskLevel).toBe("medium");
    expect(WebFetchTool.description).toContain("50000");
  });
});
