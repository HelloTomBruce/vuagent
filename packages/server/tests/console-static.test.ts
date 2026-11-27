/**
 * console 静态托管（T03，0.7.0 CLI 形态）：
 * - 传入 console.dir：/assets/* 命中静态且带 immutable 长缓存；目录命中入口 no-cache；
 *   SPA 深链回 index.html；/api 前缀不被 fallback 吞（保持 404 JSON）；
 * - 不传 console：行为不变（/ 与非 API GET 404 JSON）；
 * - console.dir 缺 index.html：启动即报错（fail fast，而非运行期 500）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHarnessServer } from "../src/server.js";

const INDEX_HTML = `<!doctype html><html><head><title>Vuagent Console</title></head><body><div id="app"></div><script type="module" src="/assets/index-abc123.js"></script></body></html>`;
const ASSET_JS = `console.log("bundle");`;

let dir: string;
let consoleDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-static-"));
  consoleDir = path.join(dir, "console");
  fs.mkdirSync(path.join(consoleDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(consoleDir, "index.html"), INDEX_HTML);
  fs.writeFileSync(path.join(consoleDir, "assets", "index-abc123.js"), ASSET_JS);
  fs.writeFileSync(path.join(consoleDir, "favicon.svg"), "<svg/>");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeApp(withConsole: boolean) {
  return createHarnessServer({
    dbPath: ":memory:",
    ...(withConsole ? { console: { dir: consoleDir } } : {}),
  }).app;
}

describe("console 静态托管", () => {
  it("GET / 返回 index.html（no-cache），内容即 SPA 入口", async () => {
    const res = await makeApp(true).request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain('<div id="app">');
  });

  it("GET /assets/* 命中静态文件并带 immutable 长缓存与正确 MIME", async () => {
    const res = await makeApp(true).request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toBe(ASSET_JS);
  });

  it("GET /favicon.svg 等根级静态文件可访问", async () => {
    const res = await makeApp(true).request("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("svg");
  });

  it("SPA 深链（/console、/settings/models）回 index.html", async () => {
    const app = makeApp(true);
    for (const deep of ["/console", "/settings/models", "/some/deep/route"]) {
      const res = await app.request(deep);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(await res.text()).toContain('<div id="app">');
    }
  });

  it("/api 前缀不被 SPA fallback 吞：未知 API 仍 404 JSON；已知 API 正常", async () => {
    const app = makeApp(true);

    const unknown = await app.request("/api/nope");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
    expect(await unknown.json()).toMatchObject({ code: "NOT_FOUND" });

    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
  });

  it("静态未命中与路径穿越：/assets/* 404 JSON，穿越尝试不回首页", async () => {
    const app = makeApp(true);
    // /assets/* 未命中 = 静态资源缺失 → 404 JSON（不回 SPA 首页）
    const miss = await app.request("/assets/not-exists.js");
    expect(miss.status).toBe(404);
    expect(miss.headers.get("content-type")).toContain("application/json");

    // 穿越尝试：不落静态、不泄文件、也不回 200 首页
    const res2 = await app.request("/assets/..%2f..%2fpackage.json");
    expect(res2.status).toBe(404);
    expect(await res2.text()).not.toContain('<div id="app">');

    // /../ 在路由层被归一：不落任何真实文件即可
    const res1 = await app.request("/../secret.txt");
    const body1 = await res1.text();
    expect(body1).not.toContain("name\": \"vuagent-monorepo\"");
  });

  it("不传 console：行为不变（/ 与非 API GET 都是 404 JSON）", async () => {
    const app = makeApp(false);
    const root = await app.request("/");
    expect(root.status).toBe(404);
    expect(root.headers.get("content-type")).toContain("application/json");
    const deep = await app.request("/console");
    expect(deep.status).toBe(404);
    expect(deep.headers.get("content-type")).toContain("application/json");
    // API 不受影响
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("immutableAssets=false 时 /assets/* 不带长缓存", async () => {
    const app = createHarnessServer({
      dbPath: ":memory:",
      console: { dir: consoleDir, immutableAssets: false },
    }).app;
    const res = await app.request("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("console.dir 缺 index.html：启动即抛出带路径的错误", () => {
    const empty = path.join(dir, "empty-console");
    fs.mkdirSync(empty, { recursive: true });
    expect(() =>
      createHarnessServer({ dbPath: ":memory:", console: { dir: empty } })
    ).toThrow(/缺少 SPA 入口/);
  });
});
