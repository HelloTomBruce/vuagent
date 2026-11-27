#!/usr/bin/env node
/**
 * 发布前本地冒烟（**用户视角**）：pack → 装到临时 prefix → 真跑 `vuagent` → 断言
 * 「装出来的东西」能用，包括**样式是否自足**（0.7.0 生产 console 缺 tokens.css 的
 * 事故就属于这类：包能装、服务能起，但页面样式全崩，只有真跑起来才看得见）。
 *
 * 用法：pnpm cli:smoke [--keep]
 *   --keep  保留临时目录（排查用，路径会打印）
 *
 * 断言：
 *  1. 安装后 `vuagent --version` 正常；
 *  2. 起服务后 /api/health 200；
 *  3. /console 返回 SPA 入口；
 *  4. 页面引用的 CSS **含 --va-bg 令牌**（样式自足性，用户视角版本）；
 *  5. 第二实例拒绝（exit 3）；
 *  6. SIGINT 优雅退出（exit 0 且锁删除）。
 * 全过 exit 0，任一失败 exit 1 并打印细节。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const KEEP = process.argv.includes("--keep");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-cli-smoke-"));
const PACKS = path.join(TMP, "packs");
const PREFIX = path.join(TMP, "prefix");
const HOME = path.join(TMP, "home");
const NPM_CACHE = path.join(TMP, "npm-cache");
const PKGS = [
  "packages/protocol",
  "packages/server",
  "packages/ui",
  "packages/cli",
  "apps/console",
];

const log = (msg) => console.log(`[cli:smoke] ${msg}`);

/** 正在跑的服务进程（失败路径必须显式杀掉：父进程退出不会带走子进程，
 *  否则游离子进程占着端口与锁，与之前踩过的僵尸进程是同一类事故） */
let serverChild = null;

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  if (serverChild && serverChild.exitCode === null) {
    try { serverChild.kill("SIGKILL"); } catch { /* 已退出 */ }
  }
  if (KEEP) console.error(`  临时目录保留：${TMP}`);
  else fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
};

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) {
    fail(`${cmd} ${args.join(" ")} 失败：\n${(r.stderr || r.stdout || "").slice(-1500)}`);
  }
  return r;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url);
  return { status: res.status, text: await res.text() };
}

(async () => {
  log(`临时目录 ${TMP}`);
  fs.mkdirSync(PACKS, { recursive: true });

  // 1) 构建 + 打包（pack 会触发 prepublishOnly 里的 build）
  log("构建 + 打包 5 个包 ...");
  for (const pkg of PKGS) {
    sh("pnpm", ["pack", "--pack-destination", PACKS], { cwd: path.join(ROOT, pkg) });
  }
  const tarballs = fs.readdirSync(PACKS).filter((f) => f.endsWith(".tgz")).map((f) => path.join(PACKS, f));
  if (tarballs.length !== 5) fail(`期望 5 个 tarball，实际 ${tarballs.length}`);

  // 2) 装到临时 prefix（模拟 `npm i -g`）
  log("npm i -g --prefix <tmp> ...");
  sh("npm", ["i", "-g", "--prefix", PREFIX, "--cache", NPM_CACHE, ...tarballs]);

  const bin = path.join(PREFIX, "bin", "vuagent");
  if (!fs.existsSync(bin)) fail("安装后没有 vuagent 可执行文件");

  // 3) --version
  const version = sh(bin, ["--version"], { env: { ...process.env, VUAGENT_HOME: HOME } }).stdout.trim();
  log(`vuagent ${version}`);
  if (!/^\d+\.\d+\.\d+/.test(version)) fail(`--version 输出异常：${version}`);

  // 4) 起服务（--port 0 → 从横幅读实际端口）
  let output = "";
  const child = spawn(bin, ["--port", "0", "--no-open"], {
    env: { ...process.env, VUAGENT_HOME: HOME, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverChild = child;
  child.stdout.on("data", (d) => (output += String(d)));
  child.stderr.on("data", (d) => (output += String(d)));

  const cleanup = (code) => {
    if (serverChild && serverChild.exitCode === null) {
      try { serverChild.kill("SIGKILL"); } catch { /* 已退出 */ }
    }
    if (!KEEP) fs.rmSync(TMP, { recursive: true, force: true });
    else log(`临时目录保留：${TMP}`);
    process.exit(code);
  };

  let port = 0;
  for (let i = 0; i < 100 && !port; i++) {
    const m = output.match(/server\s+http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) port = Number(m[1]);
    else await wait(200);
  }
  if (!port) fail("启动横幅里没读到端口");

  // 5) 就绪 + 入口 + 样式
  let health = 0;
  for (let i = 0; i < 60 && health !== 200; i++) {
    try { health = (await fetch(`http://127.0.0.1:${port}/api/health`)).status; } catch { /* 未就绪 */ }
    if (health !== 200) await wait(300);
  }
  if (health !== 200) fail(`/api/health = ${health}`);
  log("✓ /api/health 200");

  const page = await fetchText(`http://127.0.0.1:${port}/console`);
  if (page.status !== 200 || !page.text.includes('<div id="app">')) {
    fail(`/console 异常：status=${page.status}`);
  }
  log("✓ /console 返回 SPA 入口");

  const cssHref = /<link[^>]+href="([^"]+\.css)"/.exec(page.text)?.[1];
  if (!cssHref) fail("入口 HTML 里没有 CSS 链接（样式未参与构建？）");
  const css = await fetchText(`http://127.0.0.1:${port}${cssHref}`);
  if (css.status !== 200) fail(`CSS 取不到：${cssHref} → ${css.status}`);
  const missing = [];
  if (!css.text.includes("--va-bg:")) missing.push("设计令牌 --va-bg（tokens.css 未引入）");
  if (!css.text.includes(".va-console")) missing.push("console 组件样式");
  if (!/height:\s*100%/.test(css.text)) missing.push("满高布局（shell.css 未引入）");
  if (missing.length) fail(`样式不自足 → 缺 ${missing.join("、")}`);
  log(`✓ 样式自足（${cssHref}，含令牌与组件样式）`);

  // 6) 单实例 + 优雅退出
  const second = spawnSync(bin, ["--port", "0", "--no-open"], {
    env: { ...process.env, VUAGENT_HOME: HOME, CI: "1" },
    encoding: "utf8",
    timeout: 20_000,
  });
  if (second.status !== 3) fail(`第二实例退出码 ${second.status}（期望 3）`);
  log("✓ 第二实例按预期拒绝（exit 3）");

  const lockFile = path.join(HOME, "run", "harness.lock");
  if (!fs.existsSync(lockFile)) fail("运行中却没有锁文件");
  const exited = await new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
    child.kill("SIGINT");
    setTimeout(() => resolve(-1), 15_000);
  });
  if (exited !== 0) fail(`SIGINT 退出码 ${exited}（期望 0）`);
  if (fs.existsSync(lockFile)) fail("优雅退出后锁未删除");
  log("✓ SIGINT 优雅退出（exit 0，锁已删除）");

  console.log(`\n✓ 本地冒烟全过（vuagent ${version}，console 样式自足）`);
  cleanup(0);
})().catch((err) => fail(String(err)));
