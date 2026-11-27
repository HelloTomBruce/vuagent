/**
 * CLI start 冒烟（T05）：
 * 起服务 → /api/health 与 console 首页可达 → 锁文件存在 → 第二实例退出码 3 →
 * SIGINT 优雅退出（exit 0、锁删除）。路径全部走 VUAGENT_HOME 临时目录，不碰真实 ~/.vuagent。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pidAlive } from "../src/lib/lock.js";

const CLI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = path.join(CLI_DIR, "src", "main.ts");
const TSX = path.join(CLI_DIR, "node_modules", ".bin", "tsx");

/** 自包含 console 夹具（不依赖 playground dist——root `pnpm test` 不要求先构建） */
function makeConsoleFixture(dir: string): string {
  const consoleDir = path.join(dir, "console");
  fs.mkdirSync(path.join(consoleDir, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(consoleDir, "index.html"),
    `<!doctype html><html><body><div id="app"></div><script src="/assets/app-abc123.js"></script></body></html>`
  );
  fs.writeFileSync(path.join(consoleDir, "assets", "app-abc123.js"), "console.log(1)");
  return consoleDir;
}

interface RunningCli {
  child: ChildProcess;
  logs: () => string;
}

async function waitFor(fn: () => Promise<boolean> | boolean, timeoutMs: number, stepMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`等待超时（${timeoutMs}ms）${lastErr ? `：${String(lastErr)}` : ""}`);
}

function startCli(home: string, consoleDir: string, extraArgs: string[] = []): RunningCli {
  let output = "";
  const child = spawn(
    TSX,
    [MAIN, "--port", "0", "--no-open", "--console-dir", consoleDir, ...extraArgs],
    {
      cwd: CLI_DIR,
      env: { ...process.env, VUAGENT_HOME: home, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  child.stdout?.on("data", (d) => (output += String(d)));
  child.stderr?.on("data", (d) => (output += String(d)));
  return { child, logs: () => output };
}

/** 从启动横幅解析实际监听端口（--port 0 随机分配，避免测试间端口冲突） */
async function waitForBanner(running: RunningCli, timeoutMs = 20_000): Promise<number> {
  let port = 0;
  await waitFor(() => {
    const m = running.logs().match(/server\s+http:\/\/127\.0\.0\.1:(\d+)/);
    if (m) port = Number(m[1]);
    return port > 0;
  }, timeoutMs);
  return port;
}

async function stopCli(running: RunningCli): Promise<number> {
  if (running.child.exitCode !== null) return running.child.exitCode;
  return await new Promise<number>((resolve) => {
    running.child.once("exit", (code) => resolve(code ?? -1));
    running.child.kill("SIGINT");
  });
}

describe("vuagent start 冒烟", () => {
  let home: string;
  let consoleDir: string;

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "vuagent-cli-smoke-"));
    consoleDir = makeConsoleFixture(home);
  });
  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("起服务 → API 与 console 可达 → 锁冲突退出码 3 → SIGINT 优雅退出", { timeout: 60_000 }, async () => {
    const first = startCli(home, consoleDir);
    try {
      // ① 服务就绪：横幅带实际端口（--port 0 随机分配），/api/health 200
      const port = await waitForBanner(first);
      await waitFor(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/health`);
          return res.status === 200;
        } catch {
          return false;
        }
      }, 20_000);

      // ② console 首页（SPA fallback）与静态资产（immutable）路径语义
      let index: Response;
      try {
        index = await fetch(`http://127.0.0.1:${port}/`);
      } catch (err) {
        throw new Error(`GET / 失败：${String(err)}\n--- 子进程日志 ---\n${first.logs()}`);
      }
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('<div id="app">');
      const deep = await fetch(`http://127.0.0.1:${port}/console`);
      expect(deep.status).toBe(200);
      const asset = await fetch(`http://127.0.0.1:${port}/assets/app-abc123.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

      // ③ 横幅打印了数据路径与来源
      expect(first.logs()).toContain(`data     ${home}`);
      expect(first.logs()).toContain("env:VUAGENT_HOME");
      expect(first.logs()).toContain("/console");

      // ④ 锁文件存在且记录一个存活的服务进程（tsx 是包装进程，服务是孙进程，
      //    pid 必然 != child.pid；断言语义 = 锁持有者活着，而非具体等于谁）
      const lockFile = path.join(home, "run", "harness.lock");
      expect(fs.existsSync(lockFile)).toBe(true);
      const lockPid = JSON.parse(fs.readFileSync(lockFile, "utf8")).pid as number;
      expect(Number.isInteger(lockPid)).toBe(true);
      expect(lockPid).not.toBe(process.pid);
      expect(pidAlive(lockPid)).toBe(true);

      // ⑤ 第二实例：同数据目录必须拒绝（退出码 3 + 三条出路提示）
      const second = startCli(home, consoleDir);
      const secondCode = await new Promise<number>((resolve) => {
        second.child.once("exit", (code) => resolve(code ?? -1));
      });
      expect(secondCode).toBe(3);
      expect(second.logs()).toContain("已有实例在运行");
      expect(second.logs()).toContain("doctor --fix-lock");

      // ⑥ SIGINT 优雅退出：exit 0，锁删除
      const code = await stopCli(first);
      expect(code).toBe(0);
      expect(fs.existsSync(lockFile)).toBe(false);
    } finally {
      // 失败路径也不留僵尸服务（上一轮的教训：残留进程占端口导致后续 run 假通过/假失败）
      if (first.child.exitCode === null && first.child.signalCode === null) {
        first.child.kill("SIGKILL");
      }
    }
  });

  it("vuagent paths 打印解析结果与来源", { timeout: 20_000 }, async () => {
    const out = await new Promise<string>((resolve) => {
      let buf = "";
      const child = spawn(TSX, [MAIN, "paths"], {
        cwd: CLI_DIR,
        env: { ...process.env, VUAGENT_HOME: home },
      });
      child.stdout?.on("data", (d) => (buf += String(d)));
      child.once("exit", () => resolve(buf));
    });
    expect(out).toContain(home);
    expect(out).toContain("env:VUAGENT_HOME");
    expect(out).toContain("harness.db");
  });

  it("vuagent --version 打印版本", { timeout: 20_000 }, async () => {
    const out = await new Promise<string>((resolve) => {
      let buf = "";
      const child = spawn(TSX, [MAIN, "--version"], { cwd: CLI_DIR });
      child.stdout?.on("data", (d) => (buf += String(d)));
      child.once("exit", () => resolve(buf));
    });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
