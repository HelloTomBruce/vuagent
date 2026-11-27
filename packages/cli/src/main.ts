#!/usr/bin/env node
/**
 * vuagent —— 一条命令起「harness 服务 + console」（0.7.0 M1）。
 *
 * 启动时序（确定性，docs/design/cli-data-dir-architecture.md §3.1）：
 *   解析参数 → resolveDataPaths → ensureDataDirs → 抢单实例锁 →（端口预检）→
 *   createHarnessServer（显式 dbPath + console 托管）→ 监听 → 打印横幅 → 挂信号。
 *   退出路径先关库后删锁；锁冲突退出码 3，其余错误 1。
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { serve } from "@hono/node-server";
import {
  createHarnessServer,
  resolveDataPaths,
  ensureDataDirs,
  type DataPaths,
} from "@vuagent/server";
import { acquireLock, type LockInfo } from "./lib/lock.js";
import { resolveConsoleDir } from "./lib/console-resolve.js";
import { openBrowser, shouldAutoOpen } from "./lib/open.js";

const CLI_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
})();

const EXIT_LOCK_HELD = 3;

/* ------------------------------------------------------------------ 参数 */

interface CliArgs {
  command: "start" | "paths" | "version" | "help";
  port: number;
  host: string;
  dataDir?: string;
  dbPath?: string;
  consoleDir?: string;
  workspace?: string;
  open: boolean;
  json: boolean;
}

const HELP = `vuagent ${CLI_VERSION} —— 一条命令起 harness 服务 + console

用法：
  vuagent [start] [选项]     启动服务（默认命令）
  vuagent paths              打印数据路径解析结果（含来源）
  vuagent --version          打印版本
  vuagent --help             本帮助

选项：
  --port <n>          监听端口（默认 6880；0 = 随机可用端口，启动后打印实际值）
  --host <host>       绑定地址（默认 127.0.0.1；对外绑定需 VUAGENT_TOKEN）
  --data-dir <path>   数据目录（默认 ~/.vuagent；也可用 VUAGENT_HOME）
  --db <path>         只覆盖 SQLite 库文件位置（":memory:" = 纯内存试跑）
  --console-dir <p>   console 静态资源目录（默认随包内置；开发期指向 apps/playground/dist）
  --workspace <path>  确保存在以该路径为根的工作区（headless 环境免「选文件夹」）
  --open / --no-open  启动后打开浏览器（默认开；CI/无 TTY 自动关）

环境变量：
  VUAGENT_HOME / DB_PATH / VUAGENT_CONSOLE_DIR / VUAGENT_TOKEN / VUAGENT_ALLOW_SHARED
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: "start",
    port: Number(process.env.PORT) || 6880,
    host: (process.env.VUAGENT_HOST || "127.0.0.1").trim(),
    open: true,
    json: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const [flag, inline] = token.includes("=") ? token.split(/=(.*)/s, 2) : [token, undefined];
    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[++i];
      if (next === undefined) throw new Error(`选项 ${flag} 缺参数`);
      return next;
    };
    switch (flag) {
      case "--port": args.port = Number(takeValue()); break;
      case "--host": args.host = takeValue().trim(); break;
      case "--data-dir": args.dataDir = takeValue(); break;
      case "--db": args.dbPath = takeValue(); break;
      case "--console-dir": args.consoleDir = takeValue(); break;
      case "--workspace": args.workspace = takeValue(); break;
      case "--open": args.open = true; break;
      case "--no-open": args.open = false; break;
      case "--json": args.json = true; break;
      case "--version": case "-v": args.command = "version"; break;
      case "--help": case "-h": args.command = "help"; break;
      default:
        if (flag.startsWith("-")) throw new Error(`未知选项 ${flag}`);
        positional.push(flag);
    }
  }
  if (positional.length > 0) {
    const cmd = positional[0];
    if (cmd === "start") args.command = "start";
    else if (cmd === "paths") args.command = "paths";
    else if (cmd === "--version" || cmd === "version") args.command = "version";
    else throw new Error(`未知命令 ${cmd}`);
  }
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) {
    throw new Error(`--port 非法：${args.port}`);
  }
  return args;
}

/* ------------------------------------------------------------------ paths */

function printPaths(paths: DataPaths, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(paths, null, 2));
    return;
  }
  const rows: Array<[string, string, string]> = [
    ["data", paths.dataDir.path, paths.dataDir.source],
    ["db", paths.dbPath.path, paths.dbPath.source],
    ["pricing", paths.pricingPath.path, paths.pricingPath.source],
    ["logs", paths.logsDir, paths.dataDir.source],
    ["exports", paths.exportsDir, paths.dataDir.source],
    ["lock", paths.lockFile, paths.dataDir.source],
    ["tmp", paths.tmpDir, paths.dataDir.source],
  ];
  for (const [label, p, source] of rows) {
    console.log(`  ${label.padEnd(8)} ${p}   (${source})`);
  }
}

/* ------------------------------------------------------------------ 端口 */

/** --port 0：预占一个随机可用端口（抢占锁需要 port 落盘；微小竞态可接受） */
function pickFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/* ------------------------------------------------------------------ 启动 */

async function start(args: CliArgs): Promise<void> {
  const paths = resolveDataPaths({ dataDir: args.dataDir, dbPath: args.dbPath });
  const inMemory = paths.dbPath.path === ":memory:";
  if (!inMemory) ensureDataDirs(paths);

  // ① 抢锁（先锁后库再监听；:memory: 无数据根，跳过单实例语义）
  let releaseLockFn: (() => void) | null = null;
  if (!inMemory) {
    const port = args.port === 0 ? await pickFreePort(args.host) : args.port;
    args.port = port;
    const info: LockInfo = {
      pid: process.pid,
      startedAt: Date.now(),
      port,
      host: args.host,
      version: CLI_VERSION,
      cwd: process.cwd(),
    };
    const lock = acquireLock(paths.lockFile, info, {
      allowShared: ["1", "true"].includes((process.env.VUAGENT_ALLOW_SHARED || "").trim().toLowerCase()),
    });
    if (!lock.ok) {
      if (lock.reason === "held") {
        const h = lock.holder;
        console.error(`✗ 该数据目录已有实例在运行：pid ${h.pid}, 端口 ${h.port}, 数据目录 ${paths.dataDir.path}`);
        console.error(`  复用： open http://${h.host}:${h.port}/console`);
        console.error(`  另起： vuagent --data-dir ~/.vuagent-alt`);
        console.error(`  清残留： vuagent doctor --fix-lock   （仅在确认进程已死时使用）`);
        process.exit(EXIT_LOCK_HELD);
      }
      console.error(`✗ 抢锁失败：${lock.error}`);
      process.exit(1);
    }
    releaseLockFn = lock.release;
  } else if (args.port === 0) {
    args.port = await pickFreePort(args.host);
  }

  // ② console 静态资源目录（找不到降级 API-only，提示但不阻断）
  const consoleRes = resolveConsoleDir({ consoleDir: args.consoleDir });

  // ③ 建 server（显式 dbPath——库形态缺省是 :memory:，CLI 必须显式给）
  const harness = createHarnessServer({
    dbPath: paths.dbPath.path,
    pricingPath: paths.pricingPath.path,
    ...(consoleRes.dir ? { console: { dir: consoleRes.dir } } : {}),
  });

  // --workspace：headless 环境免「选文件夹」，确保工作区存在
  if (args.workspace) {
    const rootPath = path.resolve(args.workspace);
    const existing = (await harness.workspaceRepo.list()).find((w) => w.rootPath === rootPath);
    if (!existing) {
      await harness.workspaceRepo.create({
        name: path.basename(rootPath),
        rootPath,
        permission: "read-write",
      });
    }
  }

  // ④ 监听
  const server = serve({ fetch: harness.app.fetch, port: args.port, hostname: args.host }, (info) => {
    const actualPort = info.port;
    args.port = actualPort;
    printBanner(args, paths, consoleRes.source);
    if (shouldAutoOpen({ noOpen: !args.open, isTTY: process.stdout.isTTY })) {
      openBrowser(`http://${args.host}:${actualPort}${consoleRes.dir ? "/console" : "/"}`);
    }
  });

  // ⑤ 优雅停机：停受理 → 抽干在途（≤20s）→ 关库 → 删锁 → exit
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`\n[vuagent] 收到 ${signal}：停受理新请求，等待在途轮次抽干（上限 20s）...`);
    server.close();
    const deadline = Date.now() + 20_000;
    while (harness.executionHub.runningCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    await harness.close();
    releaseLockFn?.();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`✗ 端口 ${args.port} 已被占用——可能已有实例在跑；换端口用 --port，或先 vuagent doctor 体检`);
    } else {
      console.error(`✗ 监听失败：${err.message}`);
    }
    releaseLockFn?.();
    process.exit(1);
  });
}

function printBanner(args: CliArgs, paths: DataPaths, consoleSource: string): void {
  const base = `http://${args.host}:${args.port}`;
  const hasKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  console.log(`vuagent ${CLI_VERSION}`);
  console.log(`  data     ${paths.dataDir.path}   (${paths.dataDir.source})`);
  console.log(`  db       sqlite  ${paths.dbPath.path}   (${paths.dbPath.source})`);
  console.log(`  server   ${base}`);
  if (consoleSource !== "none") {
    console.log(`  console  ${base}/console   (${consoleSource})`);
  } else {
    console.log(`  console  （未找到 console 资源，API-only；--console-dir 或安装 @vuagent/console）`);
  }
  if (!hasKey) {
    console.log(`  hint     未检测到模型凭据：设置 OPENAI_API_KEY / ANTHROPIC_API_KEY，或在 console → 设置 中添加供应商`);
  }
}

/* ------------------------------------------------------------------ 入口 */

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}\n\n${HELP}`);
    process.exit(2);
  }
  switch (args.command) {
    case "version":
      console.log(CLI_VERSION);
      return;
    case "help":
      console.log(HELP);
      return;
    case "paths": {
      const paths = resolveDataPaths({ dataDir: args.dataDir, dbPath: args.dbPath });
      printPaths(paths, args.json);
      return;
    }
    case "start":
      await start(args);
  }
}

main().catch((err) => {
  console.error(`✗ 启动失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
