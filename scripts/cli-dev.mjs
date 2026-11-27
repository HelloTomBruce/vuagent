#!/usr/bin/env node
/**
 * 本地跑 CLI（源码态，不经发布）：改 `packages/cli|server|console` 的代码后立刻看到效果。
 *
 * 用法：
 *   pnpm cli:dev                    # 默认：临时数据目录 + 用本地构建的 console 产物
 *   pnpm cli:dev -- --port 6999     # 追加参数原样透传给 vuagent
 *   pnpm cli:dev -- --data-dir ~/.vuagent   # 用真实数据目录（谨慎）
 *
 * 行为：
 * - console 产物缺失时先构建 `apps/console`（样式/组件改动需重跑，或用 `pnpm console` 热更新路径）；
 * - 默认数据目录落在仓库内 `.tmp/cli-dev-home`（gitignored），不污染 `~/.vuagent`；
 * - 通过 tsx 直接跑 `packages/cli/src/main.ts`：CLI / server / console-app 的改动都无需打包。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_DIR = path.join(ROOT, "packages/cli");
const CONSOLE_DIST = path.join(ROOT, "apps/console/dist");
const DEV_HOME = path.join(ROOT, ".tmp/cli-dev-home");
const TSX = path.join(CLI_DIR, "node_modules/.bin/tsx");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))));
    child.on("error", reject);
  });
}

if (!fs.existsSync(CONSOLE_DIST)) {
  console.log("[cli:dev] 未找到 console 产物，先构建 apps/console ...");
  await run("pnpm", ["--filter", "@vuagent/console", "build"], { cwd: ROOT });
}

if (!fs.existsSync(TSX)) {
  console.error(`[cli:dev] 找不到 tsx（${TSX}）——先在仓库根执行 pnpm install`);
  process.exit(1);
}

fs.mkdirSync(DEV_HOME, { recursive: true });

// pnpm run 可能把分隔符 `--` 也传进来（不同版本行为不一）→ 剥掉
const passthrough = process.argv.slice(2).filter((a, i, arr) => !(i === 0 && a === "--"));
const hasDataDir = passthrough.some((a) => a.startsWith("--data-dir") || a === "--db");
const args = [
  "src/main.ts",
  ...(hasDataDir ? [] : ["--data-dir", DEV_HOME]),
  "--console-dir",
  CONSOLE_DIST,
  ...passthrough,
];

console.log(`[cli:dev] VUAGENT_HOME=${hasDataDir ? "(由参数指定)" : DEV_HOME}`);
console.log(`[cli:dev] console-dir=${CONSOLE_DIST}`);
console.log(`[cli:dev] 执行：tsx ${args.join(" ")}\n`);

const child = spawn(TSX, args, {
  cwd: CLI_DIR,
  stdio: "inherit",
  env: { ...process.env, VUAGENT_HOME: hasDataDir ? process.env.VUAGENT_HOME ?? "" : DEV_HOME },
});
child.on("error", (err) => {
  console.error(`[cli:dev] 启动失败：${err.message}`);
  process.exit(1);
});
const forward = (sig) => () => child.kill(sig);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
